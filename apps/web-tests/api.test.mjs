// formal-tools V5-b — bridge API conformance tests against the REAL engine
// (node --test, no browser, no deps).
// Plans are built by the V2 planner (normalizeUserProblem + stepsFromMethod +
// buildExecutionPlan + compilePlan) and runs go through the V3 executor
// (executeWorkflowPlan). The test environment forces FORMAL_PORTABLE_ROOT:''
// for the executor, so every run honestly fails closed BEFORE any tool starts:
// the receipt is ABORTED with fail_closed_reason=BLOCKED_TOOL_MISSING. That is
// the real fail-closed behavior of a binary-less machine — asserted here as
// such, never simulated. The real-solver happy path is exercised on the
// trusted tool host (V6).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { startServer } from '../web/server.mjs';
import {
  validateExecutionPlan,
  sha256Canonical,
  normalizeUserProblem,
} from '../../packages/runner/js/workflow-plan.mjs';
import { compilePlan } from '../../packages/runner/js/workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_SCHEMA = 'formal-tools/execution-plan/1.0';
const RECEIPT_SCHEMA = 'formal-tools/execution-receipt/1.0';
const ARTIFACT_MANIFEST_SCHEMA = 'formal-tools/execution-artifacts/1.0';
const STEP_STATUS_ENUM = new Set(['EXECUTED', 'NOT_RUN', 'TIMEOUT', 'ERROR', 'SKIPPED_DOWNSTREAM']);
const PROCESS_OUTCOME_ENUM = new Set(['OK', 'PARTIAL', 'FAILED', 'ABORTED']);
const CROSS_VERDICT_ENUM = new Set(['AGREE_SAT', 'AGREE_UNSAT', 'CONTRADICTION', 'UNKNOWN', 'NOT_APPLICABLE']);
const EXPECTED_KINDS = new Set(['smt-answer', 'lp-status', 'cross-tool-verdict']);

const SMT_SAT = `(set-logic QF_LIA)
(declare-const x Int)
(declare-const y Int)
(assert (>= x 0))
(assert (>= y 0))
(assert (= (+ x y) 10))
(assert (= (- x y) 2))
(check-sat)
(exit)
`;
// canonical problem text = NFC -> CRLF/CR->LF -> trim (workflow-plan.mjs rule)
const SMT_CANONICAL = SMT_SAT.normalize('NFC').replace(/\r\n?/g, '\n').trim();

const LP_MODEL = {
  sense: 'min',
  objective: [2, 3],
  variables: [{ lower: 0, upper: null }, { lower: 0, upper: null }],
  constraints: [
    { lower: 10, upper: null, coefficients: [1, 1] },
    { lower: null, upper: 4, coefficients: [1, -1] },
  ],
};
const LP_TEXT = JSON.stringify(LP_MODEL);

// Executor env used by every server under test: forces the honest fail-closed
// path deterministically on any machine (no portable bundle -> BLOCKED_TOOL_MISSING).
const BLOCKED_ENV = Object.freeze({ ...process.env, FORMAL_PORTABLE_ROOT: '' });

// --- shared servers ----------------------------------------------------------
let base; // deterministic template plans
let gated; // concurrency-cap test server (testRunGate holds runs before executing)
let tokened; // token-auth server
let noKeyProvider; // provider:"deepseek" with an explicitly empty key
let runsDir;

async function start(opts) {
  const handle = await startServer({ port: 0, runsDir, executorEnv: BLOCKED_ENV, ...opts });
  const origin = `http://127.0.0.1:${handle.port}`;
  return { ...handle, origin };
}

const jget = async (origin, pathname, init) => {
  const res = await fetch(origin + pathname, init);
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { res, body };
};

async function postJson(origin, pathname, payload, headers = {}) {
  return jget(origin, pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

async function makePlan(origin, problemText, assumptions, provider) {
  const payload = { problem_text: problemText };
  if (assumptions !== undefined) payload.assumptions = assumptions;
  if (provider !== undefined) payload.provider = provider;
  const { res, body } = await postJson(origin, '/api/plan', payload);
  assert.equal(res.status, 200, `plan build failed: ${JSON.stringify(body)}`);
  return body;
}

async function waitForRun(origin, runId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { res, body } = await jget(origin, `/api/runs/${runId}`);
    assert.equal(res.status, 200);
    if (body.status !== 'running') return body;
    await new Promise((r) => setTimeout(r, 60));
  }
  assert.fail(`run ${runId} did not finish within ${timeoutMs}ms`);
}

before(async () => {
  runsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formal-web-test-runs-'));
  base = await start({});
  // one shared gate promise: every run start waits on it until released
  let releaseSharedGate;
  const sharedGate = new Promise((resolve) => { releaseSharedGate = resolve; });
  gated = await start({ testRunGate: () => sharedGate });
  gated.release = () => releaseSharedGate();
  tokened = await start({ token: 'test-token-123' });
  noKeyProvider = await start({ deepseekApiKey: '' });
});

after(async () => {
  for (const h of [base, gated, tokened, noKeyProvider]) {
    if (h) await new Promise((r) => h.server.close(r));
  }
  await fsp.rm(runsDir, { recursive: true, force: true });
});

// --- meta / static -----------------------------------------------------------
describe('GET /api/meta + static (real engine advertised)', () => {
  test('meta: mocked_contracts=false, real engine identity, provider info, caps, allowlist', async () => {
    const { res, body } = await jget(base.origin, '/api/meta');
    assert.equal(res.status, 200);
    assert.equal(body.mode, 'local-only');
    assert.equal(body.mocked_contracts, false, 'the mock flag must be gone');
    assert.equal(body.engine.kind, 'workflow-engine-v2-v3');
    assert.equal(body.engine.real, true);
    assert.match(body.engine.planner, /workflow-plan\.mjs/);
    assert.match(body.engine.executor, /workflow-executor\.mjs/);
    assert.match(body.engine.note, /BLOCKED_TOOL_MISSING/);
    assert.equal(body.provider.deepseek.model, 'deepseek-chat');
    assert.equal(body.versions.engine, 'workflow-v2+v3');
    assert.equal(body.versions.plan_schema, PLAN_SCHEMA);
    assert.equal(body.versions.receipt_schema, RECEIPT_SCHEMA);
    assert.equal(body.caps.max_concurrent_runs, 2);
    assert.equal(body.caps.run_wall_clock_s, 120);
    assert.equal(body.caps.max_plan_steps, 8);
    assert.equal(body.caps.body_limit_bytes, 1000000);
    assert.deepEqual(body.allowlist.z3, ['solve-smt']);
    assert.deepEqual(body.allowlist.highs, ['solve-lp']);
    assert.deepEqual(body.allowlist.compare, ['cross-check']);
  });

  test('static UI served; no MOCKED badge anywhere; unknown route -> 404 JSON', async () => {
    const index = await fetch(base.origin + '/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(index.headers.get('x-content-type-options'), /nosniff/);
    const html = await index.text();
    assert.match(html, /<title>formal-tools — task console<\/title>/);
    assert.ok(!html.includes('MOCKED'), 'the MOCKED badge must be removed from the UI');
    assert.match(html, /engine-badge/);
    assert.match(html, /providerInput/);
    for (const p of ['/app.js', '/styles.css']) {
      const r = await fetch(base.origin + p);
      assert.equal(r.status, 200, p);
    }
    const missing = await fetch(base.origin + '/nope.txt');
    assert.equal(missing.status, 404);
    const missingBody = await missing.json();
    assert.equal(missingBody.error.code, 'NOT_FOUND');
  });
});

// --- POST /api/plan (deterministic template): pinned ExecutionPlan shape ------
describe('POST /api/plan — real V2 plan shape (execution-plan/1.0)', () => {
  test('scenario A: SMT cross-check plan conforms to the frozen contract', async () => {
    const { res, body } = await postJson(base.origin, '/api/plan', { problem_text: SMT_SAT });
    assert.equal(res.status, 200);
    assert.deepEqual(body.plan_source, { kind: 'deterministic-template', template: 'smt-cross-check@v1' });
    const plan = body.plan;
    assert.equal(plan.schema, PLAN_SCHEMA);
    assert.match(plan.plan_id, /^wf-[a-f0-9]{32}$/);
    assert.equal(plan.source.problem_kind, 'smt2');
    // source.problem_sha256 = sha256Canonical(problem) over the normalized
    // ProblemSpec (frozen contract §2), deterministic for the same text
    assert.equal(plan.source.problem_sha256, sha256Canonical(normalizeUserProblem(SMT_CANONICAL).problem));
    assert.ok(Array.isArray(plan.assumptions) && plan.assumptions.length >= 1, 'engine injects default assumptions');
    for (const a of plan.assumptions) assert.equal(typeof a, 'string');
    // steps: z3 + cvc5 solve-smt, executor-side compare cross-check
    assert.equal(plan.steps.length, 3);
    const [s1, s2, s3] = plan.steps;
    assert.deepEqual(plan.steps.map((s) => s.tool), ['z3', 'cvc5', 'compare']);
    assert.deepEqual(plan.steps.map((s) => s.operation), ['solve-smt', 'solve-smt', 'cross-check']);
    assert.deepEqual(plan.steps.map((s) => s.expected_output_kind), ['smt-answer', 'smt-answer', 'cross-tool-verdict']);
    assert.deepEqual(s1.depends_on, []);
    assert.deepEqual(s2.depends_on, ['step-z3']);
    assert.deepEqual(s3.depends_on, ['step-z3', 'step-cvc5']);
    // inputs are the frozen shapes with canonical-JSON hashes
    assert.deepEqual(s1.input, { smt_lib: SMT_CANONICAL });
    assert.deepEqual(s3.input, { left_step: 'step-z3', right_step: 'step-cvc5', agree_on: ['sat', 'unsat'] });
    for (const s of plan.steps) {
      assert.equal(s.input_sha256, sha256Canonical(s.input), `input_sha256 mismatch on ${s.id}`);
      assert.ok(Number.isInteger(s.timeout_s) && s.timeout_s >= 1 && s.timeout_s <= 120, `timeout_s bounded on ${s.id}`);
      assert.ok(EXPECTED_KINDS.has(s.expected_output_kind));
    }
    assert.ok(plan.steps.reduce((acc, s) => acc + s.timeout_s, 0) <= plan.budgets.max_total_timeout_s);
    assert.deepEqual(plan.budgets, { max_steps: 8, max_total_timeout_s: 120 });
    // compiled hashes are real (compilePlan), planner validator passes
    assert.match(plan.compiled.launcher_sha256, /^[0-9a-f]{64}$/);
    assert.match(plan.compiled.manifest_sha256, /^[0-9a-f]{64}$/);
    validateExecutionPlan(plan);
  });

  test('compiled hashes match a fresh deterministic compilePlan of the same plan', async () => {
    const { plan } = await makePlan(base.origin, SMT_SAT);
    const withoutCompiled = structuredClone(plan);
    withoutCompiled.compiled = { launcher_sha256: null, manifest_sha256: null };
    const { plan: recompiled, manifest } = compilePlan(withoutCompiled);
    assert.equal(plan.compiled.launcher_sha256, recompiled.compiled.launcher_sha256);
    assert.equal(plan.compiled.manifest_sha256, recompiled.compiled.manifest_sha256);
    assert.equal(manifest.plan_id, plan.plan_id);
    assert.equal(manifest.deterministic, true);
  });

  test('scenario B: LP JSON (frozen HiGHS model shape) uses highs solve-lp / lp-status', async () => {
    const { body: planBody } = { body: await makePlan(base.origin, LP_TEXT) };
    assert.deepEqual(planBody.plan_source, { kind: 'deterministic-template', template: 'highs-lp@v1' });
    const plan = planBody.plan;
    assert.equal(plan.source.problem_kind, 'lp-json');
    assert.equal(plan.steps.length, 1);
    assert.deepEqual(plan.steps.map((s) => s.tool + '/' + s.operation), ['highs/solve-lp']);
    assert.equal(plan.steps[0].expected_output_kind, 'lp-status');
    assert.deepEqual(plan.steps[0].input, LP_MODEL);
    assert.equal(plan.steps[0].timeout_s, 30, 'portfolio cap mirrored (max 30s for solve-lp)');
  });

  test('explicit assumptions are verbatim string pass-through in the plan', async () => {
    const { plan } = await makePlan(base.origin, SMT_SAT, ['my assumption one']);
    assert.deepEqual(plan.assumptions, ['my assumption one']);
  });

  test('plan is content-stable: same text -> same plan_id', async () => {
    const a = await makePlan(base.origin, SMT_SAT);
    const b = await makePlan(base.origin, SMT_SAT);
    assert.equal(a.plan.plan_id, b.plan.plan_id);
    assert.equal(a.plan.compiled.launcher_sha256, b.plan.compiled.launcher_sha256);
  });

  test('negatives: garbage / malformed JSON / wrong LP shape / empty / bad assumptions fail closed 422', async () => {
    const garbage = await postJson(base.origin, '/api/plan', { problem_text: 'just prose !!!' });
    assert.equal(garbage.res.status, 422);
    assert.equal(garbage.body.error.code, 'UNSUPPORTED_PROBLEM');
    assert.match(garbage.body.error.message, /fail-closed/);

    const badJson = await postJson(base.origin, '/api/plan', { problem_text: '{"objective": nope' });
    assert.equal(badJson.res.status, 422);
    assert.equal(badJson.body.error.code, 'MALFORMED_LP_JSON');

    const wrongShape = await postJson(base.origin, '/api/plan', { problem_text: JSON.stringify({ objective: { direction: 'min' } }) });
    assert.equal(wrongShape.res.status, 422);
    assert.equal(wrongShape.body.error.code, 'UNSUPPORTED_LP_MODEL');

    const lpShapeError = await postJson(base.origin, '/api/plan', {
      problem_text: JSON.stringify({ ...LP_MODEL, variables: [{ lower: 0, upper: 1 }] }),
    });
    assert.equal(lpShapeError.res.status, 422);
    assert.equal(lpShapeError.body.error.code, 'PLAN_INPUT_INVALID', 'portfolio validator rejects a bad LP model');

    const empty = await postJson(base.origin, '/api/plan', { problem_text: '   ' });
    assert.equal(empty.res.status, 422);
    assert.equal(empty.body.error.code, 'EMPTY_PROBLEM');

    const badAssumptions = await postJson(base.origin, '/api/plan', { problem_text: SMT_SAT, assumptions: 'nope' });
    assert.equal(badAssumptions.res.status, 422);
    assert.equal(badAssumptions.body.error.code, 'INVALID_ASSUMPTIONS');

    const longAssumption = await postJson(base.origin, '/api/plan', { problem_text: SMT_SAT, assumptions: ['x'.repeat(257)] });
    assert.equal(longAssumption.res.status, 422);
    assert.equal(longAssumption.body.error.code, 'INVALID_ASSUMPTIONS', 'executor assumption bound (256 chars) enforced at plan time');

    const oversize = await postJson(base.origin, '/api/plan', { problem_text: '; ' + 'x'.repeat(65536) + '\n(check-sat)' });
    assert.equal(oversize.res.status, 422);
    assert.equal(oversize.body.error.code, 'PLAN_OVERSIZED', '64 KiB canonical problem cap from CAPS');

    const missing = await postJson(base.origin, '/api/plan', { hello: 1 });
    assert.equal(missing.res.status, 422);
    assert.equal(missing.body.error.code, 'MISSING_PROBLEM');

    const badProvider = await postJson(base.origin, '/api/plan', { problem_text: SMT_SAT, provider: 'chatgpt' });
    assert.equal(badProvider.res.status, 422);
    assert.equal(badProvider.body.error.code, 'INVALID_PROVIDER');
  });
});

// --- POST /api/plan provider:"deepseek" --------------------------------------
describe('POST /api/plan provider:"deepseek" (real LLM-as-data path)', () => {
  test('no key -> honest BLOCKED_PROVIDER 422, no plan', async () => {
    const { res, body } = await postJson(noKeyProvider.origin, '/api/plan', { problem_text: SMT_SAT, provider: 'deepseek' });
    assert.equal(res.status, 422);
    assert.equal(body.error.code, 'BLOCKED_PROVIDER');
    assert.match(body.error.message, /DEEPSEEK_API_KEY/);
    assert.ok(!body.plan);
  });

  test('real DeepSeek call when key present: valid plan with honest plan_source; else skip', async () => {
    if (!process.env.DEEPSEEK_API_KEY) {
      console.log('# skip: DEEPSEEK_API_KEY is not set on this machine (honest skip, no fake LLM claims)');
      return;
    }
    const { res, body } = await postJson(base.origin, '/api/plan', { problem_text: SMT_SAT, provider: 'deepseek' });
    if (res.status === 502) {
      // provider transport failure (network/timeout) — honest fail-closed, never fabricated
      assert.equal(body.error.code, 'PROVIDER_FAILED');
      console.log('# provider unavailable this run: ' + body.error.code);
      return;
    }
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.plan_source.kind, 'deepseek');
    assert.equal(body.plan_source.provider, 'deepseek');
    assert.equal(body.plan_source.model, 'deepseek-chat', 'the real model name is disclosed');
    assert.match(body.plan_source.method_sha256, /^[0-9a-f]{64}$/);
    const plan = body.plan;
    validateExecutionPlan(plan); // the LLM proposal only ever enters via the static gates
    assert.equal(plan.schema, PLAN_SCHEMA);
    assert.equal(plan.source.problem_kind, 'smt2');
    const solverSteps = plan.steps.filter((s) => s.tool === 'z3' || s.tool === 'cvc5');
    assert.ok(solverSteps.length >= 1, 'LLM proposed at least one solver step');
    for (const s of plan.steps) {
      assert.ok(['z3', 'cvc5', 'highs', 'compare'].includes(s.tool), 'allowlisted tools only');
      if (s.tool === 'z3' || s.tool === 'cvc5') {
        assert.deepEqual(s.input, { smt_lib: SMT_CANONICAL });
      } else if (s.tool === 'compare') {
        assert.deepEqual(Object.keys(s.input).sort(), ['agree_on', 'left_step', 'right_step']);
      }
      assert.equal(s.input_sha256, sha256Canonical(s.input));
    }
    if (solverSteps.length >= 2) {
      const compare = plan.steps.find((s) => s.tool === 'compare');
      assert.ok(compare, 'two solver steps must be followed by the executor-side cross-check');
      assert.equal(compare.expected_output_kind, 'cross-tool-verdict');
    }
  });
});

// --- POST /api/runs: plan re-validation (executor codes, fail-closed) ---------
describe('POST /api/runs plan validation (executor re-validation, fail-closed 422)', () => {
  const expect422 = async (mutator, code) => {
    const { plan } = await makePlan(base.origin, SMT_SAT);
    mutator(plan);
    const { res, body } = await postJson(base.origin, '/api/runs', { plan });
    assert.equal(res.status, 422, `expected 422 ${code}`);
    if (code) assert.equal(body.error.code, code);
    assert.match(body.error.message, /fail-closed/);
  };

  test('unknown tool', () => expect422((p) => { p.steps[0].tool = 'bash'; }, 'PLAN_TOOL_NOT_ALLOWED'));
  test('tool/operation mismatch', () => expect422((p) => { p.steps[0].operation = 'solve-lp'; }, 'PLAN_OPERATION_MISMATCH'));
  test('tampered input hash', () => expect422((p) => { p.steps[0].input_sha256 = '0'.repeat(64); }, 'PLAN_HASH_MISMATCH'));
  test('wrong schema string', () => expect422((p) => { p.schema = 'formal-tools/execution-plan/0.9'; }, 'PLAN_SCHEMA_INVALID'));
  test('9 steps over cap', () => expect422((p) => {
    const extra = structuredClone(p.steps[2]);
    p.steps = [...p.steps, ...Array.from({ length: 6 }, () => structuredClone(extra))];
  }, 'PLAN_BUDGET_EXCEEDED'));
  test('cycle', () => expect422((p) => {
    p.steps[0].depends_on = ['step-agree'];
    p.method_dag[0].depends_on = ['step-agree'];
  }, 'PLAN_CYCLE'));
  test('budgets over bridge cap', () => expect422((p) => { p.budgets.max_total_timeout_s = 999; }, 'PLAN_BUDGET_EXCEEDED'));
  test('step timeout over cap', () => expect422((p) => { p.steps[0].timeout_s = 150; }, 'PLAN_TIMEOUT_INVALID'));
  test('expected_output_kind drift', () => expect422((p) => { p.steps[0].expected_output_kind = 'sat'; }, 'PLAN_EXPECTED_KIND_INVALID'));

  test('invalid JSON body -> 400; unknown route -> 404 JSON; wrong method -> 405', async () => {
    const bad = await postJson(base.origin, '/api/runs', '{not json');
    assert.equal(bad.res.status, 400);
    const missing = await jget(base.origin, '/api/definitely-not-a-route');
    assert.equal(missing.res.status, 404);
    assert.ok(missing.body.error.code);
    const wrongMethod = await jget(base.origin, '/api/plan');
    assert.equal(wrongMethod.res.status, 405);
  });
});

// --- run lifecycle: honest fail-closed BLOCKED receipt ------------------------
describe('run lifecycle + pinned ExecutionReceipt shape (binary-less host)', () => {
  async function runPlan(origin, plan) {
    const { res, body } = await postJson(origin, '/api/runs', { plan });
    assert.equal(res.status, 200);
    assert.equal(body.status, 'running');
    assert.ok(body.run_id);
    assert.equal(body.poll, `/api/runs/${body.run_id}`);
    return waitForRun(origin, body.run_id);
  }

  test('scenario A: run completes with a REAL ABORTED receipt — BLOCKED_TOOL_MISSING, no solver claims', async () => {
    const { plan } = await makePlan(base.origin, SMT_SAT);
    const view = await runPlan(base.origin, plan);
    assert.equal(view.status, 'complete');
    const r = view.receipt;
    assert.equal(r.schema, RECEIPT_SCHEMA);
    for (const key of ['run_id', 'plan_id', 'plan_sha256', 'source_sha', 'created_at', 'tool_versions', 'steps', 'overall', 'environment']) {
      assert.ok(key in r, `missing receipt key ${key}`);
    }
    assert.equal(r.run_id, view.run_id);
    assert.equal(r.plan_id, plan.plan_id);
    assert.equal(r.source_sha, plan.source.problem_sha256);
    // plan_sha256 = sha256 over the canonical plan JSON as received by the
    // executor (compiled hashes included)
    assert.equal(r.plan_sha256, sha256Canonical(plan));
    assert.match(r.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    // fail-closed preflight: no tool ran, no versions probed
    assert.deepEqual(r.tool_versions, {}, 'no tool version probes without the trusted bundle');
    assert.equal(r.steps.length, 3);
    for (const s of r.steps) {
      for (const key of ['step_id', 'tool', 'operation', 'status', 'exit_code', 'elapsed_ms', 'stdout_sha256', 'stderr_sha256', 'stdout_bounded', 'stderr_bounded', 'result', 'artifacts']) {
        assert.ok(key in s, `missing step key ${key}`);
      }
      assert.ok(STEP_STATUS_ENUM.has(s.status), `status ${s.status} not in enum`);
      assert.equal(s.status, 'NOT_RUN', `step ${s.step_id} never ran`);
      assert.equal(s.exit_code, null);
      assert.equal(s.result, null);
      assert.deepEqual(s.artifacts, []);
    }
    // overall verdict layering: ABORTED + BLOCKED, never a fabricated answer
    assert.equal(r.overall.process_outcome, 'ABORTED');
    assert.ok(PROCESS_OUTCOME_ENUM.has(r.overall.process_outcome));
    assert.equal(r.overall.fail_closed_reason, 'BLOCKED_TOOL_MISSING');
    assert.deepEqual(r.overall.solver_answer, { kind: 'none', value: null, by_step: [] });
    assert.equal(r.overall.solver_answer.value, null, 'no solver answer is claimed');
    assert.equal(r.overall.cross_tool_verdict, 'NOT_APPLICABLE');
    assert.ok(CROSS_VERDICT_ENUM.has(r.overall.cross_tool_verdict));
    assert.equal(r.overall.claim_verdict, 'BLOCKED');
    // environment is honest about the host
    assert.equal(r.environment.host, '127.0.0.1');
    assert.equal(r.environment.formal_portable_root_sha, null);
    assert.equal(typeof r.environment.node, 'string');
    // no streams exist — nothing was executed, nothing simulated
    assert.deepEqual(view.streams, {});
  });

  test('scenario B (LP): same honest ABORTED / BLOCKED_TOOL_MISSING receipt', async () => {
    const { plan } = await makePlan(base.origin, LP_TEXT);
    const view = await runPlan(base.origin, plan);
    assert.equal(view.receipt.overall.process_outcome, 'ABORTED');
    assert.equal(view.receipt.overall.fail_closed_reason, 'BLOCKED_TOOL_MISSING');
    assert.equal(view.receipt.steps.length, 1);
    assert.equal(view.receipt.steps[0].status, 'NOT_RUN');
  });

  test('run view while gated: running, no receipt yet; step states queued', async () => {
    const { plan } = await makePlan(base.origin, SMT_SAT);
    const { res, body } = await postJson(gated.origin, '/api/runs', { plan });
    assert.equal(res.status, 200);
    const runId = body.run_id;
    const { body: mid } = await jget(gated.origin, `/api/runs/${runId}`);
    assert.equal(mid.status, 'running');
    assert.equal(mid.receipt, null);
    assert.equal(mid.engine, 'workflow-v2+v3');
    assert.ok(mid.plan_summary.steps.length === 3);
    assert.deepEqual(mid.step_states, { 'step-z3': 'queued', 'step-cvc5': 'queued', 'step-agree': 'queued' });
    gated.release();
    const done = await waitForRun(gated.origin, runId);
    assert.equal(done.status, 'complete');
    assert.equal(done.receipt.overall.fail_closed_reason, 'BLOCKED_TOOL_MISSING');
  });

  test('404 for unknown run id', async () => {
    const { res, body } = await jget(base.origin, '/api/runs/run-missing');
    assert.equal(res.status, 404);
    assert.equal(body.error.code, 'RUN_NOT_FOUND');
  });
});

// --- evidence: real persisted receipt + hash manifest -------------------------
describe('GET /api/runs/:id/evidence (real artifact downloads)', () => {
  async function completedRun(origin) {
    const { plan } = await makePlan(origin, SMT_SAT);
    const { body: started } = await postJson(origin, '/api/runs', { plan });
    const view = await waitForRun(origin, started.run_id);
    return { runId: started.run_id, view };
  }

  test('full evidence is the real persisted receipt.json file (byte-identical attachment)', async () => {
    const { runId, view } = await completedRun(base.origin);
    const res = await fetch(`${base.origin}/api/runs/${runId}/evidence`);
    assert.equal(res.status, 200);
    const cd = res.headers.get('content-disposition');
    assert.match(cd, /attachment/);
    assert.match(cd, new RegExp(`receipt-${runId}\\.json`));
    const payload = await res.text();
    const persisted = await fsp.readFile(path.join(runsDir, runId, 'receipt.json'), 'utf8');
    assert.equal(payload, persisted, 'served bytes === persisted receipt file');
    const receipt = JSON.parse(payload);
    assert.equal(receipt.schema, RECEIPT_SCHEMA);
    assert.equal(receipt.run_id, runId);
    assert.equal(receipt.overall.fail_closed_reason, 'BLOCKED_TOOL_MISSING');
    assert.equal(view.receipt.plan_id, receipt.plan_id);
  });

  test('manifest download: hash-bound artifact manifest, receipt entry matches file bytes', async () => {
    const { runId } = await completedRun(base.origin);
    const res = await fetch(`${base.origin}/api/runs/${runId}/evidence?part=manifest`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), new RegExp(`manifest-${runId}\\.json`));
    const manifest = JSON.parse(await res.text());
    assert.equal(manifest.schema, ARTIFACT_MANIFEST_SCHEMA);
    assert.equal(manifest.run_id, runId);
    assert.equal(manifest.plan_id, (await (await fetch(`${base.origin}/api/runs/${runId}`)).json()).receipt.plan_id);
    const receiptEntry = manifest.artifacts.find((a) => a.name === 'receipt.json');
    assert.ok(receiptEntry, 'manifest lists the receipt artifact');
    const persisted = await fsp.readFile(path.join(runsDir, runId, 'receipt.json'));
    const { createHash } = await import('node:crypto');
    assert.equal(receiptEntry.sha256, createHash('sha256').update(persisted).digest('hex'), 'receipt sha256 binds the file bytes');
    assert.equal(receiptEntry.bytes, persisted.length);
  });

  test('blocked runs have no stream artifacts: per-step download is an honest 404; bad part -> 422', async () => {
    const { runId } = await completedRun(base.origin);
    const stepDl = await fetch(`${base.origin}/api/runs/${runId}/evidence?part=stdout&step=step-z3`);
    assert.equal(stepDl.status, 404);
    const stepBody = await stepDl.json();
    assert.equal(stepBody.error.code, 'ARTIFACT_NOT_FOUND');
    assert.match(stepBody.error.message, /never produced a stdout stream/);
    const badPart = await fetch(`${base.origin}/api/runs/${runId}/evidence?part=nope&step=step-z3`);
    assert.equal(badPart.status, 422);
    assert.equal((await badPart.json()).error.code, 'EVIDENCE_PART_INVALID');
    const unknownStep = await fetch(`${base.origin}/api/runs/${runId}/evidence?part=stdout&step=ghost`);
    assert.equal(unknownStep.status, 404);
    assert.equal((await unknownStep.json()).error.code, 'STEP_NOT_FOUND');
    const none = await fetch(`${base.origin}/api/runs/run-does-not-exist/evidence`);
    assert.equal(none.status, 404);
  });
});

// --- caps ---------------------------------------------------------------------
describe('hard caps (413 / 422 / 429 unchanged)', () => {
  test('413 on >1MB request body', async () => {
    const big = { problem_text: SMT_SAT + ' '.repeat(1100000) };
    const { res, body } = await postJson(base.origin, '/api/plan', big);
    assert.equal(res.status, 413);
    assert.equal(body.error.code, 'BODY_TOO_LARGE');
  });

  test('429 concurrency cap: third simultaneous run refused, later accepted (real runs, gated start)', async () => {
    const { plan } = await makePlan(base.origin, SMT_SAT);
    const r1 = await postJson(gated.origin, '/api/runs', { plan });
    const r2 = await postJson(gated.origin, '/api/runs', { plan });
    assert.equal(r1.res.status, 200);
    assert.equal(r2.res.status, 200);
    const r3 = await postJson(gated.origin, '/api/runs', { plan });
    assert.equal(r3.res.status, 429);
    assert.equal(r3.body.error.code, 'CONCURRENCY_LIMIT');
    assert.match(r3.body.error.message, /fail-closed/);
    gated.release();
    const v1 = await waitForRun(gated.origin, r1.body.run_id);
    const v2 = await waitForRun(gated.origin, r2.body.run_id);
    assert.equal(v1.receipt.overall.fail_closed_reason, 'BLOCKED_TOOL_MISSING');
    assert.equal(v2.receipt.overall.fail_closed_reason, 'BLOCKED_TOOL_MISSING');
    const r4 = await postJson(gated.origin, '/api/runs', { plan });
    assert.equal(r4.res.status, 200);
    const v4 = await waitForRun(gated.origin, r4.body.run_id);
    assert.equal(v4.status, 'complete');
  });

  test('engine validation is reachable via the bridge: hostile plan is rejected with the engine code', async () => {
    const { plan } = await makePlan(base.origin, SMT_SAT);
    plan.steps[0].input = { smt_lib: SMT_CANONICAL, attach: '/etc/passwd' };
    const { res, body } = await postJson(base.origin, '/api/runs', { plan });
    assert.equal(res.status, 422);
    assert.equal(body.error.code, 'PLAN_INPUT_INVALID', 'executor rejects unknown input keys');
  });
});

// --- token auth mode ----------------------------------------------------------
describe('token-auth mode (FORMAL_WEB_TOKEN)', () => {
  test('meta stays public and reports token-auth; protected routes need bearer', async () => {
    const meta = await jget(tokened.origin, '/api/meta');
    assert.equal(meta.res.status, 200);
    assert.equal(meta.body.mode, 'token-auth');
    assert.equal(meta.body.mocked_contracts, false);

    const noAuth = await postJson(tokened.origin, '/api/plan', { problem_text: SMT_SAT });
    assert.equal(noAuth.res.status, 401);
    assert.equal(noAuth.body.error.code, 'UNAUTHORIZED');

    const badAuth = await postJson(tokened.origin, '/api/plan', { problem_text: SMT_SAT }, { Authorization: 'Bearer wrong' });
    assert.equal(badAuth.res.status, 403);
    assert.equal(badAuth.body.error.code, 'FORBIDDEN');

    const good = await postJson(tokened.origin, '/api/plan', { problem_text: SMT_SAT }, { Authorization: 'Bearer test-token-123' });
    assert.equal(good.res.status, 200);
    assert.equal(good.body.plan.schema, PLAN_SCHEMA);

    const evDenied = await fetch(`${tokened.origin}/api/runs/whatever/evidence`);
    assert.equal(evDenied.status, 401);
  });
});
