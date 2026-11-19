// formal-tools V5 — bridge API conformance tests (node --test, no browser, no deps).
// Exercises every endpoint, the hard caps, auth mode, and receipt-shape conformance to
// the pinned V0 contracts ("formal-tools/execution-plan/1.0", "formal-tools/execution-receipt/1.0").
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { startServer } from '../web/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_SCHEMA = 'formal-tools/execution-plan/1.0';
const RECEIPT_SCHEMA = 'formal-tools/execution-receipt/1.0';
const STEP_STATUS_ENUM = new Set(['EXECUTED', 'NOT_RUN', 'TIMEOUT', 'ERROR', 'SKIPPED_DOWNSTREAM']);
const PROCESS_OUTCOME_ENUM = new Set(['OK', 'PARTIAL', 'FAILED', 'ABORTED']);
const CROSS_VERDICT_ENUM = new Set(['AGREE_SAT', 'AGREE_UNSAT', 'CONTRADICTION', 'UNKNOWN', 'NOT_APPLICABLE']);

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const SMT_SAT = SAMPLE_SMT();
function SAMPLE_SMT() {
  return `(set-logic QF_LIA)
(declare-const x Int)
(declare-const y Int)
(assert (>= x 0))
(assert (>= y 0))
(assert (= (+ x y) 10))
(assert (= (- x y) 2))
(check-sat)
(exit)
`;
}
const SMT_UNKNOWN = SMT_SAT.replace('(set-logic QF_LIA)', '(set-logic QF_NIA)\n;; @expect: unknown');
const SMT_ERROR = SMT_SAT.replace('(check-sat)', ';; @expect: error\n(check-sat)');
const SMT_TIMEOUT = SMT_SAT.replace('(check-sat)', ';; @expect: timeout\n(check-sat)');
const LP_MODEL = JSON.stringify({
  objective: { direction: 'minimize', coeffs: { x: 2, y: 3 } },
  variables: { x: { lower: 0 }, y: { lower: 0 } },
  constraints: [{ name: 'demand', expr: 'x + y >= 10' }],
});

// --- shared servers ----------------------------------------------------------
let base; // no token, fast mock delays
let slow; // concurrency test server
let tokened; // token-auth server
let runsDir;

async function start(opts) {
  const handle = await startServer({ port: 0, stepDelayMs: 40, runsDir, ...opts });
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

async function makePlan(origin, problemText, assumptions) {
  const { res, body } = await postJson(origin, '/api/plan', { problem_text: problemText, assumptions });
  assert.equal(res.status, 200, `plan build failed: ${JSON.stringify(body)}`);
  return body.plan;
}

async function waitForRun(origin, runId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { res, body } = await jget(origin, `/api/runs/${runId}`);
    assert.equal(res.status, 200);
    if (body.status !== 'running') return body;
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.fail(`run ${runId} did not finish within ${timeoutMs}ms`);
}

before(async () => {
  runsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formal-web-test-runs-'));
  base = await start({ stepDelayMs: 30 });
  slow = await start({ stepDelayMs: 900 });
  tokened = await start({ stepDelayMs: 30, token: 'test-token-123' });
});

after(async () => {
  for (const h of [base, slow, tokened]) {
    if (h) await new Promise((r) => h.server.close(r));
  }
  await fsp.rm(runsDir, { recursive: true, force: true });
});

// --- meta / static -----------------------------------------------------------
describe('GET /api/meta + static', () => {
  test('meta: local-only mode, mocked_contracts, versions, caps, allowlist', async () => {
    const { res, body } = await jget(base.origin, '/api/meta');
    assert.equal(res.status, 200);
    assert.equal(body.mode, 'local-only');
    assert.equal(body.mocked_contracts, true);
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

  test('static UI files served; unknown static route -> 404 JSON', async () => {
    const index = await fetch(base.origin + '/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(index.headers.get('x-content-type-options'), /nosniff/);
    const html = await index.text();
    assert.match(html, /<title>formal-tools — task console<\/title>/);
    assert.match(html, /MOCKED CONTRACTS/);
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

// --- POST /api/plan ----------------------------------------------------------
describe('POST /api/plan (pinned ExecutionPlan shape)', () => {
  test('scenario A: SMT cross-check plan conforms to pinned shape', async () => {
    const { res, body } = await postJson(base.origin, '/api/plan', { problem_text: SMT_SAT });
    assert.equal(res.status, 200);
    assert.equal(body.mocked_contracts, true);
    const plan = body.plan;
    assert.equal(plan.schema, PLAN_SCHEMA);
    for (const key of ['plan_id', 'source', 'assumptions', 'method_dag', 'steps', 'budgets', 'compiled']) {
      assert.ok(key in plan, `missing plan key ${key}`);
    }
    assert.equal(plan.source.problem_kind, 'smt2');
    assert.match(plan.source.problem_sha256, /^[0-9a-f]{64}$/);
    assert.equal(plan.source.problem_sha256, sha256(SMT_SAT));
    assert.equal(plan.steps.length, 3);
    const [s1, s2, s3] = plan.steps;
    assert.equal(s1.tool, 'z3');
    assert.equal(s1.operation, 'solve-smt');
    assert.deepEqual(s1.depends_on, []);
    assert.equal(s1.input_sha256, sha256(s1.input));
    assert.equal(s2.tool, 'cvc5');
    assert.deepEqual(s3.depends_on, ['s1', 's2']);
    assert.equal(s3.tool, 'compare');
    assert.equal(s3.operation, 'cross-check');
    for (const s of plan.steps) {
      assert.equal(typeof s.timeout_s, 'number');
      assert.ok(s.timeout_s <= 120);
      assert.equal(typeof s.expected_output_kind, 'string');
    }
    assert.equal(plan.budgets.max_steps, 8);
    assert.equal(plan.budgets.max_total_timeout_s, 120);
    assert.match(plan.compiled.launcher_sha256, /^[0-9a-f]{64}$/);
    assert.match(plan.compiled.manifest_sha256, /^[0-9a-f]{64}$/);
    assert.ok(Array.isArray(plan.assumptions) && plan.assumptions.length >= 1);
  });

  test('scenario B: LP JSON plan uses highs solve-lp', async () => {
    const plan = await makePlan(base.origin, LP_MODEL);
    assert.equal(plan.source.problem_kind, 'lp-json');
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].tool, 'highs');
    assert.equal(plan.steps[0].operation, 'solve-lp');
  });

  test('explicit assumptions are editable pass-through in the plan', async () => {
    const plan = await makePlan(base.origin, SMT_SAT, ['my assumption one']);
    assert.deepEqual(plan.assumptions, [{ id: 'a1', text: 'my assumption one' }]);
  });

  test('negatives: garbage / malformed JSON / empty are fail-closed 422', async () => {
    const garbage = await postJson(base.origin, '/api/plan', { problem_text: 'just prose !!!' });
    assert.equal(garbage.res.status, 422);
    assert.equal(garbage.body.error.code, 'UNSUPPORTED_PROBLEM');
    assert.match(garbage.body.error.message, /fail-closed/);

    const badJson = await postJson(base.origin, '/api/plan', { problem_text: '{"objective": nope' });
    assert.equal(badJson.res.status, 422);
    assert.equal(badJson.body.error.code, 'MALFORMED_LP_JSON');

    const empty = await postJson(base.origin, '/api/plan', { problem_text: '   ' });
    assert.equal(empty.res.status, 422);
    assert.equal(empty.body.error.code, 'EMPTY_PROBLEM');

    const badAssumptions = await postJson(base.origin, '/api/plan', { problem_text: SMT_SAT, assumptions: 'nope' });
    assert.equal(badAssumptions.res.status, 422);
    assert.equal(badAssumptions.body.error.code, 'INVALID_ASSUMPTIONS');

    const missing = await postJson(base.origin, '/api/plan', { hello: 1 });
    assert.equal(missing.res.status, 422);
    assert.equal(missing.body.error.code, 'MISSING_PROBLEM');
  });
});

// --- POST /api/runs: validation ----------------------------------------------
describe('POST /api/runs plan validation (fail-closed)', () => {
  const expect422 = async (mutator, code) => {
    const plan = await makePlan(base.origin, SMT_SAT);
    mutator(plan);
    const { res, body } = await postJson(base.origin, '/api/runs', { plan });
    assert.equal(res.status, 422, `expected 422 ${code}`);
    if (code) assert.equal(body.error.code, code);
    assert.match(body.error.message, /fail-closed/);
  };

  test('unknown tool', () => expect422((p) => { p.steps[0].tool = 'bash'; }, 'UNKNOWN_TOOL'));
  test('tool/operation mismatch', () => expect422((p) => { p.steps[0].operation = 'solve-lp'; }, 'OPERATION_MISMATCH'));
  test('tampered input hash', () => expect422((p) => { p.steps[0].input_sha256 = '0'.repeat(64); }, 'STEP_INPUT_HASH_MISMATCH'));
  test('wrong schema string', () => expect422((p) => { p.schema = 'formal-tools/execution-plan/0.9'; }, 'PLAN_SCHEMA_MISMATCH'));
  test('9 steps over cap', () => expect422((p) => {
    p.steps = Array.from({ length: 9 }, (_, i) => ({ ...p.steps[0], id: `s${i + 1}` }));
  }, 'PLAN_STEPS_COUNT'));
  test('cycle', () => expect422((p) => { p.steps[0].depends_on = ['s3']; }, 'PLAN_CYCLE'));
  test('budgets over cap', () => expect422((p) => { p.budgets.max_total_timeout_s = 999; }, 'BUDGETS_EXCEEDED'));
  test('step timeout over cap', () => expect422((p) => { p.steps[0].timeout_s = 150; }, 'STEP_TIMEOUT_INVALID'));

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

// --- POST /api/runs + polling + receipt conformance ---------------------------
describe('run lifecycle + pinned ExecutionReceipt shape', () => {
  async function runPlan(origin, plan) {
    const { res, body } = await postJson(origin, '/api/runs', { plan });
    assert.equal(res.status, 200);
    assert.equal(body.status, 'running');
    assert.ok(body.run_id);
    return waitForRun(origin, body.run_id);
  }

  test('scenario A sat: AGREE_SAT, receipt conforms to pinned shape, stream hashes match evidence', async () => {
    const plan = await makePlan(base.origin, SMT_SAT);
    const view = await runPlan(base.origin, plan);
    assert.equal(view.status, 'complete');
    const r = view.receipt;
    assert.equal(r.schema, RECEIPT_SCHEMA);
    for (const key of ['run_id', 'plan_id', 'plan_sha256', 'source_sha', 'created_at', 'tool_versions', 'steps', 'overall', 'environment']) {
      assert.ok(key in r, `missing receipt key ${key}`);
    }
    assert.equal(r.plan_id, plan.plan_id);
    assert.equal(r.source_sha, plan.source.problem_sha256);
    assert.match(r.plan_sha256, /^[0-9a-f]{64}$/);
    assert.ok(r.tool_versions.z3.includes('SIMULATED'));
    assert.ok(r.tool_versions.cvc5.includes('SIMULATED'));
    assert.equal(r.steps.length, 3);
    for (const s of r.steps) {
      for (const key of ['step_id', 'tool', 'operation', 'status', 'exit_code', 'elapsed_ms', 'stdout_sha256', 'stderr_sha256', 'stdout_bounded', 'stderr_bounded', 'result', 'artifacts']) {
        assert.ok(key in s, `missing step key ${key}`);
      }
      assert.ok(STEP_STATUS_ENUM.has(s.status), `status ${s.status} not in enum`);
    }
    assert.equal(r.steps[0].status, 'EXECUTED');
    assert.equal(r.steps[0].exit_code, 0);
    assert.equal(r.overall.process_outcome, 'OK');
    assert.equal(r.overall.solver_answer, 'sat');
    assert.equal(r.overall.cross_tool_verdict, 'AGREE_SAT');
    assert.ok(PROCESS_OUTCOME_ENUM.has(r.overall.process_outcome));
    assert.ok(CROSS_VERDICT_ENUM.has(r.overall.cross_tool_verdict));
    assert.ok(r.environment.simulated === true, 'environment must disclose simulation');
    // simulated streams are labeled
    assert.match(view.streams.s1.stdout, /\[SIMULATED\]/);
    assert.equal(r.steps[0].stdout_sha256, sha256(view.streams.s1.stdout));
    assert.equal(r.steps[0].stdout_bounded, false);
  });

  test('scenario B LP: optimal, cross_tool_verdict NOT_APPLICABLE', async () => {
    const plan = await makePlan(base.origin, LP_MODEL);
    const view = await runPlan(base.origin, plan);
    assert.equal(view.receipt.overall.process_outcome, 'OK');
    assert.equal(view.receipt.overall.solver_answer, 'optimal');
    assert.equal(view.receipt.overall.cross_tool_verdict, 'NOT_APPLICABLE');
    assert.equal(view.receipt.steps[0].tool, 'highs');
    assert.match(view.streams.s1.stdout, /Optimal/);
  });

  test('UNKNOWN negative: honest unknown verdict', async () => {
    const plan = await makePlan(base.origin, SMT_UNKNOWN);
    const view = await runPlan(base.origin, plan);
    assert.equal(view.receipt.overall.process_outcome, 'OK');
    assert.equal(view.receipt.overall.solver_answer, 'unknown');
    assert.equal(view.receipt.overall.cross_tool_verdict, 'UNKNOWN');
  });

  test('ERROR negative: fail-closed FAILED + SKIPPED_DOWNSTREAM + reason', async () => {
    const plan = await makePlan(base.origin, SMT_ERROR);
    const view = await runPlan(base.origin, plan);
    const r = view.receipt;
    assert.equal(r.overall.process_outcome, 'FAILED');
    assert.match(r.overall.fail_closed_reason, /fail-closed/);
    assert.equal(r.overall.cross_tool_verdict, 'NOT_APPLICABLE', 'cross-check never ran, must not claim UNKNOWN');
    const statuses = r.steps.map((s) => s.status);
    assert.ok(statuses.includes('ERROR'));
    assert.equal(r.steps.find((s) => s.step_id === 's3').status, 'SKIPPED_DOWNSTREAM');
    assert.equal(r.steps.find((s) => s.step_id === 's1').exit_code, 1);
    assert.match(view.streams.s1.stderr, /\[SIMULATED\]/);
  });

  test('TIMEOUT negative: TIMEOUT status, exit_code null, fail-closed', async () => {
    const plan = await makePlan(base.origin, SMT_TIMEOUT);
    const view = await runPlan(base.origin, plan);
    const r = view.receipt;
    assert.equal(r.overall.process_outcome, 'FAILED');
    assert.ok(r.steps.some((s) => s.status === 'TIMEOUT'));
    assert.equal(r.steps.find((s) => s.step_id === 's1').exit_code, null);
    assert.ok(r.steps.some((s) => s.status === 'SKIPPED_DOWNSTREAM'));
  });

  test('partial receipt visible mid-run (step states progress)', async () => {
    const plan = await makePlan(slow.origin, SMT_SAT);
    const { res, body } = await postJson(slow.origin, '/api/runs', { plan });
    assert.equal(res.status, 200);
    const runId = body.run_id;
    const { body: mid } = await jget(slow.origin, `/api/runs/${runId}`);
    assert.equal(mid.status, 'running');
    assert.ok(mid.receipt, 'mid-run partial receipt exists');
    assert.ok(mid.receipt.steps.every((s) => STEP_STATUS_ENUM.has(s.status)));
    assert.ok(mid.step_states && mid.step_states.s1);
    await waitForRun(slow.origin, runId);
  });
});

// --- evidence ----------------------------------------------------------------
describe('GET /api/runs/:id/evidence (downloadable attachments)', () => {
  test('full evidence JSON: Content-Disposition attachment, receipt + streams inside', async () => {
    const plan = await makePlan(base.origin, SMT_SAT);
    const { body: started } = await postJson(base.origin, '/api/runs', { plan });
    await waitForRun(base.origin, started.run_id);
    const res = await fetch(`${base.origin}/api/runs/${started.run_id}/evidence`);
    assert.equal(res.status, 200);
    const cd = res.headers.get('content-disposition');
    assert.match(cd, /attachment/);
    assert.match(cd, new RegExp(started.run_id));
    const payload = await res.json();
    assert.equal(payload.receipt.schema, RECEIPT_SCHEMA);
    assert.ok(payload.streams && payload.streams.s1.stdout.includes('[SIMULATED]'));
    // evidence stream hashes must equal receipt hashes (same bounded bytes)
    assert.equal(payload.receipt.steps.find((s) => s.step_id === 's1').stdout_sha256, sha256(payload.streams.s1.stdout));
  });

  test('per-step stream attachments with headers', async () => {
    const plan = await makePlan(base.origin, SMT_SAT);
    const { body: started } = await postJson(base.origin, '/api/runs', { plan });
    await waitForRun(base.origin, started.run_id);
    const res = await fetch(`${base.origin}/api/runs/${started.run_id}/evidence?part=stdout&step=s2`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="stdout-.*-s2\.txt"/);
    const text = await res.text();
    assert.match(text, /cvc5/);
    const { body: ev } = await jget(base.origin, `/api/runs/${started.run_id}/evidence`);
    assert.equal(text, ev.streams.s2.stdout);
  });

  test('evidence for unknown run / bad part -> 404/422; receipt persisted in runs dir', async () => {
    const none = await fetch(`${base.origin}/api/runs/run-does-not-exist/evidence`);
    assert.equal(none.status, 404);
    const plan = await makePlan(base.origin, SMT_SAT);
    const { body: started } = await postJson(base.origin, '/api/runs', { plan });
    await waitForRun(base.origin, started.run_id);
    const badPart = await fetch(`${base.origin}/api/runs/${started.run_id}/evidence?part=nope&step=s1`);
    assert.equal(badPart.status, 422);
    const persisted = await fsp.readFile(path.join(runsDir, `${started.run_id}.json`), 'utf8');
    assert.ok(persisted.includes(RECEIPT_SCHEMA));
  });
});

// --- caps --------------------------------------------------------------------
describe('hard caps', () => {
  test('413 on >1MB request body', async () => {
    const big = { problem_text: SMT_SAT + ' '.repeat(1100000) };
    const { res, body } = await postJson(base.origin, '/api/plan', big);
    assert.equal(res.status, 413);
    assert.equal(body.error.code, 'BODY_TOO_LARGE');
  });

  test('429 concurrency cap: third simultaneous run is refused, later accepted', async () => {
    const plan = await makePlan(slow.origin, SMT_SAT);
    const r1 = await postJson(slow.origin, '/api/runs', { plan });
    const r2 = await postJson(slow.origin, '/api/runs', { plan });
    assert.equal(r1.res.status, 200);
    assert.equal(r2.res.status, 200);
    const r3 = await postJson(slow.origin, '/api/runs', { plan });
    assert.equal(r3.res.status, 429);
    assert.equal(r3.body.error.code, 'CONCURRENCY_LIMIT');
    assert.match(r3.body.error.message, /fail-closed/);
    await waitForRun(slow.origin, r1.body.run_id);
    await waitForRun(slow.origin, r2.body.run_id);
    const r4 = await postJson(slow.origin, '/api/runs', { plan });
    assert.equal(r4.res.status, 200);
    await waitForRun(slow.origin, r4.body.run_id);
  });

  test('404 for unknown run id', async () => {
    const { res } = await jget(base.origin, '/api/runs/run-missing');
    assert.equal(res.status, 404);
  });
});

// --- token auth mode ----------------------------------------------------------
describe('token-auth mode (FORMAL_WEB_TOKEN)', () => {
  test('meta stays public and reports token-auth; protected routes need bearer', async () => {
    const meta = await jget(tokened.origin, '/api/meta');
    assert.equal(meta.res.status, 200);
    assert.equal(meta.body.mode, 'token-auth');

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
