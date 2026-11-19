#!/usr/bin/env node
// formal-tools — V5 bounded trusted Web bridge (issue #185, OUTPUT_LABEL=FORMAL_TOOLS_I180_V5_WEB_UI)
//
// Scope of this round (V5-a): the execution engine is MOCKED. Plans and receipts use the
// pinned V0 contract shapes exactly ("formal-tools/execution-plan/1.0" and
// "formal-tools/execution-receipt/1.0"), but no real solver process is launched:
//   * no child_process is imported anywhere in this file
//   * every simulated stream is prefixed "# [SIMULATED]"
//   * GET /api/meta advertises mocked_contracts:true and the UI shows a MOCKED badge
// Master wires the real V2/V3 engine behind the same endpoints in V5-b.
//
// Security posture:
//   * binds 127.0.0.1 by default; optional bearer token via FORMAL_WEB_TOKEN
//   * request bodies are capped (413 over the limit), plans are validated against a
//     strict tool/operation allowlist (422 fail-closed on any violation)
//   * max 2 concurrent runs, per-run wall clock <= 120s, plan steps <= 8
//   * fs writes only inside the runs directory; run ids are strictly validated
//   * no CORS headers at all (same-origin only)

import http from 'node:http';
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const PLAN_SCHEMA = 'formal-tools/execution-plan/1.0';
const RECEIPT_SCHEMA = 'formal-tools/execution-receipt/1.0';

// Tool -> the single operation each tool may perform. Anything else is fail-closed.
const TOOL_ALLOWLIST = {
  z3: 'solve-smt',
  cvc5: 'solve-smt',
  highs: 'solve-lp',
  compare: 'cross-check',
};

// Simulated tool versions. Clearly suffixed so no output can be mistaken for a real run.
const TOOL_VERSIONS_SIMULATED = {
  z3: '4.13.0-SIMULATED',
  cvc5: '1.2.1-SIMULATED',
  highs: '1.11.0-SIMULATED',
  compare: '0.1.0-mock-bridge',
};

const STEP_STATUSES = ['EXECUTED', 'NOT_RUN', 'TIMEOUT', 'ERROR', 'SKIPPED_DOWNSTREAM'];
const PROCESS_OUTCOMES = ['OK', 'PARTIAL', 'FAILED', 'ABORTED'];
const CROSS_VERDICTS = ['AGREE_SAT', 'AGREE_UNSAT', 'CONTRADICTION', 'UNKNOWN', 'NOT_APPLICABLE'];

const STEP_STATUS_ENUM = new Set(STEP_STATUSES);

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function defaultRunsDir() {
  return path.join(REPO_ROOT, 'apps', 'web-tests', '.runs');
}

// ---------------------------------------------------------------------------
// Problem kind detection + deterministic plan builder (mocked "planner")
// ---------------------------------------------------------------------------

const SMT_MARKERS = ['(set-logic', '(declare-fun', '(declare-const', '(assert', '(check-sat'];
const LP_KEYS = ['objective', 'constraints', 'variables', 'sense', 'optimize', 'subject_to', 'minimize', 'maximize'];

function failClosed(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  err.status = 422;
  err.failClosed = true;
  if (extra) err.extra = extra;
  return err;
}

function detectProblemKind(text) {
  const trimmed = text.trim();
  if (!trimmed) throw failClosed('EMPTY_PROBLEM', 'fail-closed: problem input is empty.');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw failClosed('MALFORMED_LP_JSON', 'fail-closed: input looks like JSON but does not parse; not accepted as any known problem kind.');
    }
    const isObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    const hasLpKey = isObject && Object.keys(parsed).some((k) => LP_KEYS.includes(k));
    if (!hasLpKey) {
      throw failClosed('UNSUPPORTED_JSON', 'fail-closed: parsed JSON carries no known LP model keys (objective/constraints/variables/...).');
    }
    return 'lp-json';
  }
  if (SMT_MARKERS.some((m) => trimmed.includes(m))) return 'smt2';
  throw failClosed(
    'UNSUPPORTED_PROBLEM',
    'fail-closed: input is neither SMT-LIB2 text (needs (assert / (check-sat ...) forms) nor an LP JSON model with objective/constraints keys.',
  );
}

const DEFAULT_ASSUMPTIONS = {
  smt2: [
    'Input is UTF-8 SMT-LIB2 text intended for QF_LIA-style solving.',
    'Solvers may return "unknown" within the per-step timeout; that is an honest outcome, not an error.',
  ],
  'lp-json': [
    'LP JSON model is well-formed and interpreted with standard HiGHS linear-programming semantics.',
    'Numerical tolerance for optimality follows the solver default.',
  ],
};

function sanitizeAssumptions(input, kind) {
  if (input === undefined || input === null) {
    return (DEFAULT_ASSUMPTIONS[kind] || []).map((text, i) => ({ id: `a${i + 1}`, text }));
  }
  if (!Array.isArray(input) || input.length > 12) {
    throw failClosed('INVALID_ASSUMPTIONS', 'fail-closed: assumptions must be an array of at most 12 strings.');
  }
  const out = [];
  for (const item of input) {
    const text = typeof item === 'string' ? item : item && typeof item === 'object' ? item.text : null;
    if (typeof text !== 'string' || !text.trim() || text.length > 500) {
      throw failClosed('INVALID_ASSUMPTIONS', 'fail-closed: each assumption must be a non-empty string of at most 500 characters.');
    }
    out.push({ id: `a${out.length + 1}`, text: text.trim() });
  }
  return out;
}

function buildMethodDag(kind) {
  if (kind === 'smt2') {
    return [
      { id: 'parse', kind: 'parse', depends_on: [] },
      { id: 'solve-z3', kind: 'solve', depends_on: ['parse'] },
      { id: 'solve-cvc5', kind: 'solve', depends_on: ['parse'] },
      { id: 'cross-check', kind: 'verify', depends_on: ['solve-z3', 'solve-cvc5'] },
    ];
  }
  return [
    { id: 'parse', kind: 'parse', depends_on: [] },
    { id: 'solve-highs', kind: 'solve', depends_on: ['parse'] },
  ];
}

function buildPlan(problemText, assumptionsInput) {
  const kind = detectProblemKind(problemText);
  const assumptions = sanitizeAssumptions(assumptionsInput, kind);
  const canonicalCore = stableStringify({ problem_sha256: sha256(problemText), kind });

  let steps;
  if (kind === 'smt2') {
    const compareInput = stableStringify({ compare_steps: ['s1', 's2'], strategy: 'sat-unsat-agreement' });
    steps = [
      { id: 's1', tool: 'z3', operation: 'solve-smt', depends_on: [], input: problemText, input_sha256: sha256(problemText), timeout_s: 30, expected_output_kind: 'solver_result' },
      { id: 's2', tool: 'cvc5', operation: 'solve-smt', depends_on: [], input: problemText, input_sha256: sha256(problemText), timeout_s: 30, expected_output_kind: 'solver_result' },
      { id: 's3', tool: 'compare', operation: 'cross-check', depends_on: ['s1', 's2'], input: compareInput, input_sha256: sha256(compareInput), timeout_s: 15, expected_output_kind: 'comparison' },
    ];
  } else {
    steps = [
      { id: 's1', tool: 'highs', operation: 'solve-lp', depends_on: [], input: problemText, input_sha256: sha256(problemText), timeout_s: 60, expected_output_kind: 'solver_result' },
    ];
  }

  const budgets = { max_steps: 8, max_total_timeout_s: 120 };
  const canonical = stableStringify({ schema: PLAN_SCHEMA, source: { problem_sha256: sha256(problemText), problem_kind: kind }, steps, budgets });
  return {
    plan: {
      schema: PLAN_SCHEMA,
      plan_id: 'plan-' + sha256(canonicalCore + canonical).slice(0, 16),
      source: { problem_sha256: sha256(problemText), problem_kind: kind },
      assumptions,
      method_dag: buildMethodDag(kind),
      steps,
      budgets,
      compiled: {
        launcher_sha256: sha256('launcher:' + canonical),
        manifest_sha256: sha256('manifest:' + canonical),
      },
    },
    assumptions,
    mocked_contracts: true,
  };
}

// ---------------------------------------------------------------------------
// Plan validation for POST /api/runs (trusted bridge; allowlist + fail-closed)
// ---------------------------------------------------------------------------

function isHex64(s) {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw failClosed('PLAN_NOT_OBJECT', 'fail-closed: plan must be a JSON object.');
  }
  if (plan.schema !== PLAN_SCHEMA) {
    throw failClosed('PLAN_SCHEMA_MISMATCH', `fail-closed: plan.schema must be exactly "${PLAN_SCHEMA}".`);
  }
  if (typeof plan.plan_id !== 'string' || !plan.plan_id) {
    throw failClosed('PLAN_ID_INVALID', 'fail-closed: plan.plan_id must be a non-empty string.');
  }
  const src = plan.source;
  if (!src || !isHex64(src.problem_sha256) || typeof src.problem_kind !== 'string') {
    throw failClosed('PLAN_SOURCE_INVALID', 'fail-closed: plan.source must carry problem_sha256 (sha256 hex) and problem_kind.');
  }
  if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 8) {
    throw failClosed('PLAN_STEPS_COUNT', 'fail-closed: plan.steps must contain between 1 and 8 steps.');
  }
  const ids = new Set();
  for (const step of plan.steps) {
    if (!step || typeof step !== 'object') throw failClosed('STEP_INVALID', 'fail-closed: every step must be an object.');
    if (typeof step.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(step.id)) {
      throw failClosed('STEP_ID_INVALID', 'fail-closed: step.id must match [A-Za-z0-9_-]{1,32}.');
    }
    if (ids.has(step.id)) throw failClosed('STEP_ID_DUPLICATE', `fail-closed: duplicate step id "${step.id}".`);
    ids.add(step.id);
    const expectedOp = TOOL_ALLOWLIST[step.tool];
    if (!expectedOp) {
      throw failClosed('UNKNOWN_TOOL', `fail-closed: tool "${String(step.tool)}" is not in the allowlist (${Object.keys(TOOL_ALLOWLIST).join(', ')}).`);
    }
    if (step.operation !== expectedOp) {
      throw failClosed('OPERATION_MISMATCH', `fail-closed: tool "${step.tool}" only allows operation "${expectedOp}", got "${String(step.operation)}".`);
    }
    if (!Array.isArray(step.depends_on)) throw failClosed('STEP_DEPS_INVALID', `fail-closed: step "${step.id}" depends_on must be an array.`);
    if (typeof step.input !== 'string' || step.input.length === 0 || step.input.length > 200000) {
      throw failClosed('STEP_INPUT_INVALID', `fail-closed: step "${step.id}" input must be a non-empty string of at most 200000 chars.`);
    }
    if (!isHex64(step.input_sha256) || step.input_sha256 !== sha256(step.input)) {
      throw failClosed('STEP_INPUT_HASH_MISMATCH', `fail-closed: step "${step.id}" input_sha256 does not match sha256(input).`);
    }
    if (typeof step.timeout_s !== 'number' || !Number.isFinite(step.timeout_s) || step.timeout_s < 1 || step.timeout_s > 120) {
      throw failClosed('STEP_TIMEOUT_INVALID', `fail-closed: step "${step.id}" timeout_s must be a number in [1, 120].`);
    }
    if (typeof step.expected_output_kind !== 'string' || !step.expected_output_kind) {
      throw failClosed('STEP_OUTPUT_KIND_INVALID', `fail-closed: step "${step.id}" expected_output_kind must be a non-empty string.`);
    }
  }
  for (const step of plan.steps) {
    for (const dep of step.depends_on) {
      if (!ids.has(dep)) throw failClosed('STEP_DEP_UNKNOWN', `fail-closed: step "${step.id}" depends on unknown step "${dep}".`);
      if (dep === step.id) throw failClosed('STEP_DEP_SELF', `fail-closed: step "${step.id}" depends on itself.`);
    }
  }
  // cycle check (DFS with colors)
  const color = new Map();
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const visit = (id) => {
    const c = color.get(id);
    if (c === 1) throw failClosed('PLAN_CYCLE', `fail-closed: dependency cycle detected at step "${id}".`);
    if (c === 2) return;
    color.set(id, 1);
    for (const dep of byId.get(id).depends_on) visit(dep);
    color.set(id, 2);
  };
  for (const s of plan.steps) visit(s.id);

  const budgets = plan.budgets;
  if (!budgets || typeof budgets !== 'object') throw failClosed('BUDGETS_INVALID', 'fail-closed: plan.budgets must be an object.');
  if (budgets.max_steps !== 8 || budgets.max_total_timeout_s !== 120) {
    throw failClosed('BUDGETS_EXCEEDED', 'fail-closed: budgets must be max_steps=8, max_total_timeout_s=120 (bridge hard caps).');
  }
  const compiled = plan.compiled;
  if (!compiled || !isHex64(compiled.launcher_sha256) || !isHex64(compiled.manifest_sha256)) {
    throw failClosed('COMPILED_INVALID', 'fail-closed: plan.compiled must carry launcher_sha256 and manifest_sha256 (sha256 hex).');
  }
  return true;
}

// ---------------------------------------------------------------------------
// MOCKED execution engine — deterministic simulated progression
// ---------------------------------------------------------------------------

function parseExpectMarker(text) {
  const m = text.match(/(?:^|\n)\s*;;\s*@expect:\s*(sat|unsat|unknown|contradiction|error|timeout)\s*(?:\n|$)/);
  return m ? m[1] : null;
}

function deterministicObjective(inputText) {
  const h = sha256(inputText);
  return ((parseInt(h.slice(0, 8), 16) % 1000000) / 100).toFixed(2);
}

function simulatedStreams(tool, expectation, objectiveValue) {
  const banner = '# [SIMULATED] mock engine output — no real solver process was executed.';
  switch (expectation) {
    case 'error':
      return {
        stdout: '',
        stderr: `${banner}\n(error "line 5 column 3: illegal literal - unsupported sort")\n`,
        exit_code: 1,
      };
    case 'timeout':
      return {
        stdout: `${banner}\n...search still incomplete after budget...\n`,
        stderr: '',
        exit_code: null,
        timedOut: true,
      };
    default:
      break;
  }
  if (tool === 'z3') {
    const answer = expectation === 'unsat' ? 'unsat' : expectation === 'unknown' ? 'unknown' : expectation === 'contradiction' ? 'sat' : 'sat';
    return { stdout: `${banner}\nz3 4.13.0-SIMULATED\n${answer}\n`, stderr: '', exit_code: 0, answer };
  }
  if (tool === 'cvc5') {
    const answer = expectation === 'unsat' ? 'unsat' : expectation === 'unknown' ? 'unknown' : expectation === 'contradiction' ? 'unsat' : 'sat';
    return { stdout: `${banner}\ncvc5 1.2.1-SIMULATED\n${answer}\n`, stderr: '', exit_code: 0, answer };
  }
  if (tool === 'highs') {
    return {
      stdout: `${banner}\nRunning HiGHS 1.11.0-SIMULATED ...\nOptimal: objective value = ${objectiveValue}\n`,
      stderr: '',
      exit_code: 0,
      answer: 'optimal',
    };
  }
  // compare
  return { stdout: `${banner}\ncompare 0.1.0-mock-bridge: agreement computed from simulated solver answers\n`, stderr: '', exit_code: 0, answer: null };
}

function topoOrder(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const order = [];
  const done = new Set();
  let remaining = [...steps.map((s) => s.id)];
  while (remaining.length) {
    const ready = remaining.filter((id) => byId.get(id).depends_on.every((d) => done.has(d)));
    if (!ready.length) {
      // validated acyclic earlier; defensive fallback
      for (const id of remaining) order.push(byId.get(id));
      break;
    }
    for (const id of ready) {
      order.push(byId.get(id));
      done.add(id);
    }
    remaining = remaining.filter((id) => !done.has(id));
  }
  return order;
}

function failDependents(steps, failedIds, receiptSteps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const skipped = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of steps) {
      if (skipped.has(s.id) || failedIds.has(s.id)) continue;
      if (s.depends_on.some((d) => skipped.has(d) || failedIds.has(d))) {
        skipped.add(s.id);
        changed = true;
      }
    }
  }
  for (const s of steps) {
    if (skipped.has(s.id)) {
      const rs = receiptSteps.get(s.id);
      rs.status = 'SKIPPED_DOWNSTREAM';
      rs.exit_code = null;
      rs.stdout_sha256 = sha256('');
      rs.stderr_sha256 = sha256('');
      rs.stdout_bounded = false;
      rs.stderr_bounded = false;
      rs.result = { kind: 'skipped', reason: 'upstream step failed; step not run (fail-closed)' };
    }
  }
  return skipped;
}

function makeRunExecutor(state) {
  const { plan, runId, opts } = state;
  const stepDelayMs = opts.stepDelayMs;
  const toolsUsed = [...new Set(plan.steps.map((s) => s.tool))];
  const expectation = parseExpectMarker(plan.steps[0].input) || (plan.source.problem_kind === 'lp-json' ? 'optimal' : 'sat');
  const objectiveValue = deterministicObjective(plan.steps[0].input);

  const receipt = {
    schema: RECEIPT_SCHEMA,
    run_id: runId,
    plan_id: plan.plan_id,
    plan_sha256: sha256(stableStringify(plan)),
    source_sha: plan.source.problem_sha256,
    created_at: new Date().toISOString(),
    tool_versions: Object.fromEntries(toolsUsed.map((t) => [t, TOOL_VERSIONS_SIMULATED[t]])),
    steps: plan.steps.map((s) => ({
      step_id: s.id,
      tool: s.tool,
      operation: s.operation,
      status: 'NOT_RUN',
      exit_code: null,
      elapsed_ms: 0,
      stdout_sha256: sha256(''),
      stderr_sha256: sha256(''),
      stdout_bounded: false,
      stderr_bounded: false,
      result: { kind: 'pending', note: 'step has not run yet' },
      artifacts: [],
    })),
    overall: {
      process_outcome: 'ABORTED',
      solver_answer: null,
      cross_tool_verdict: 'NOT_APPLICABLE',
      claim_verdict: 'NOT_APPLICABLE',
    },
    environment: {
      engine: 'mock-v1',
      simulated: true,
      node: process.version,
      platform: process.platform,
      host: '127.0.0.1',
      note: 'mocked engine round (V5-a); real V2/V3 wiring pending',
    },
  };
  const receiptSteps = new Map(receipt.steps.map((rs) => [rs.step_id, rs]));
  const streams = new Map(); // step_id -> {stdout, stderr}
  for (const s of plan.steps) streams.set(s.id, { stdout: '', stderr: '' });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function executeStep(step) {
    state.stepStates.set(step.id, 'running');
    await sleep(stepDelayMs * (step.operation === 'cross-check' ? 1.5 : 1));
    const sim = simulatedStreams(step.tool, expectation, objectiveValue);
    const rs = receiptSteps.get(step.id);
    const bounded = (s) => (s.length > 2000 ? s.slice(0, 2000) : s);
    const stdout = bounded(sim.stdout);
    const stderr = bounded(sim.stderr);
    streams.set(step.id, { stdout, stderr });
    rs.stdout_sha256 = sha256(stdout);
    rs.stderr_sha256 = sha256(stderr);
    rs.stdout_bounded = stdout.length < sim.stdout.length;
    rs.stderr_bounded = stderr.length < sim.stderr.length;
    rs.elapsed_ms = step.tool === 'z3' ? 520 : step.tool === 'cvc5' ? 640 : step.tool === 'highs' ? 900 : 380;
    if (sim.timedOut) {
      rs.status = 'TIMEOUT';
      rs.exit_code = null;
      rs.result = { kind: 'timeout', note: `simulated timeout after ${step.timeout_s}s budget` };
      return 'TIMEOUT';
    }
    rs.exit_code = sim.exit_code;
    if (sim.exit_code !== 0) {
      rs.status = 'ERROR';
      rs.result = { kind: 'error', note: 'simulated solver error (fail-closed)' };
      return 'ERROR';
    }
    rs.status = 'EXECUTED';
    if (step.tool === 'highs') {
      rs.result = { kind: 'solver_result', answer: 'optimal', objective: Number(objectiveValue) };
    } else if (step.tool === 'compare') {
      // filled after both solvers; computed below
      rs.result = { kind: 'comparison', note: 'computed below' };
    } else {
      rs.result = { kind: 'solver_result', answer: sim.answer };
    }
    state.stepStates.set(step.id, 'done');
    return 'EXECUTED';
  }

  async function run() {
    state.status = 'running';
    const order = topoOrder(plan.steps);
    const failures = new Set();
    const answers = new Map(); // tool -> answer

    for (const step of order) {
      const rs = receiptSteps.get(step.id);
      if (rs.status === 'SKIPPED_DOWNSTREAM') {
        state.stepStates.set(step.id, 'skipped');
        continue;
      }
      const outcome = await executeStep(step);
      if (outcome === 'ERROR' || outcome === 'TIMEOUT') {
        failures.add(step.id);
        state.stepStates.set(step.id, outcome === 'ERROR' ? 'error' : 'timeout');
      } else {
        const sim = simulatedStreams(step.tool, expectation, objectiveValue);
        if (sim.answer) answers.set(step.tool, sim.answer);
        state.stepStates.set(step.id, 'done');
      }
      failDependents(plan.steps, failures, receiptSteps);
    }

    // cross-check result
    const compareStep = plan.steps.find((s) => s.tool === 'compare');
    let crossVerdict = 'NOT_APPLICABLE';
    let solverAnswer = null;
    if (plan.source.problem_kind === 'smt2') {
      const z3 = answers.get('z3');
      const cvc5 = answers.get('cvc5');
      if (z3 && cvc5) {
        if (z3 === cvc5) crossVerdict = z3 === 'sat' ? 'AGREE_SAT' : z3 === 'unsat' ? 'AGREE_UNSAT' : 'UNKNOWN';
        else crossVerdict = 'CONTRADICTION';
        solverAnswer = z3 === cvc5 ? z3 : `conflicting (z3: ${z3}, cvc5: ${cvc5})`;
      } else {
        // a cross-check that never executed must not claim an UNKNOWN verdict
        const compareExecuted = compareStep && receiptSteps.get(compareStep.id).status === 'EXECUTED';
        crossVerdict = compareExecuted ? 'UNKNOWN' : 'NOT_APPLICABLE';
        solverAnswer = answers.get('z3') || answers.get('cvc5') || null;
      }
      if (expectation === 'unknown') solverAnswer = 'unknown';
      if (compareStep) {
        const crs = receiptSteps.get(compareStep.id);
        if (crs.status === 'EXECUTED') {
          const agree = crossVerdict === 'AGREE_SAT' || crossVerdict === 'AGREE_UNSAT';
          const agreeUnknown = crossVerdict === 'UNKNOWN';
          crs.result = {
            kind: 'comparison',
            agree,
            agree_unknown: agreeUnknown,
            verdict: crossVerdict,
            z3: answers.get('z3') || 'not-run',
            cvc5: answers.get('cvc5') || 'not-run',
          };
          const cs = streams.get(compareStep.id);
          const line = `z3=${answers.get('z3') || 'not-run'} cvc5=${answers.get('cvc5') || 'not-run'} -> ${crossVerdict}`;
          cs.stdout = `${cs.stdout}${line}\n`;
          crs.stdout_sha256 = sha256(cs.stdout);
        } else if (crs.status === 'SKIPPED_DOWNSTREAM') {
          crs.result = { kind: 'skipped', reason: 'solver steps failed or timed out; cross-check not run (fail-closed)' };
        }
      }
    } else if (plan.source.problem_kind === 'lp-json') {
      const highs = answers.get('highs');
      solverAnswer = highs || null;
    }

    // overall
    const statuses = [...receiptSteps.values()].map((r) => r.status);
    let process_outcome = 'OK';
    let fail_closed_reason;
    if (statuses.every((s) => s === 'EXECUTED')) {
      process_outcome = crossVerdict === 'CONTRADICTION' ? 'PARTIAL' : 'OK';
    } else if (statuses.includes('ERROR') || statuses.includes('TIMEOUT')) {
      process_outcome = 'FAILED';
      const failed = [...receiptSteps.values()].filter((r) => r.status === 'ERROR' || r.status === 'TIMEOUT').map((r) => r.step_id);
      fail_closed_reason = `fail-closed: steps ${failed.join(', ')} did not produce a trusted result (${statuses.includes('ERROR') ? 'solver error' : 'timeout'}); downstream comparison refused.`;
    }
    receipt.overall = {
      process_outcome,
      solver_answer: solverAnswer,
      cross_tool_verdict: crossVerdict,
      claim_verdict: 'NOT_APPLICABLE',
    };
    if (fail_closed_reason) receipt.overall.fail_closed_reason = fail_closed_reason;
    if (expectation === 'unknown' && process_outcome === 'OK') {
      receipt.overall.fail_closed_reason = undefined;
      delete receipt.overall.fail_closed_reason;
    }

    state.receipt = receipt;
    state.streams = streams;
    state.status = 'complete';
    state.finishedAt = Date.now();

    // persist to the runs dir (only fs writes the bridge performs)
    try {
      await state.opts.ensureRunsDir();
      const payload = { receipt, streams: Object.fromEntries(streams.entries()) };
      await fsp.writeFile(path.join(state.opts.runsDir, `${runId}.json`), JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.error(`[formal-web] failed to persist run ${runId}: ${err.message}`);
    }
  }

  const hardTimer = setTimeout(() => {
    if (state.status === 'running') {
      receipt.overall = {
        process_outcome: 'ABORTED',
        solver_answer: null,
        cross_tool_verdict: 'NOT_APPLICABLE',
        claim_verdict: 'NOT_APPLICABLE',
        fail_closed_reason: `fail-closed: run exceeded ${120}s wall-clock budget; aborted.`,
      };
      state.receipt = receipt;
      state.streams = streams;
      state.status = 'aborted';
    }
  }, 120000);
  hardTimer.unref?.();

  run()
    .catch((err) => {
      state.status = 'aborted';
      receipt.overall = {
        process_outcome: 'ABORTED',
        solver_answer: null,
        cross_tool_verdict: 'NOT_APPLICABLE',
        claim_verdict: 'NOT_APPLICABLE',
        fail_closed_reason: `fail-closed: internal engine error: ${err.message}`,
      };
      state.receipt = receipt;
      state.streams = streams;
    })
    .finally(() => {
      clearTimeout(hardTimer);
      state.opts.onFinished(runId);
    });

  return { receipt, streams };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

export function startServer(options = {}) {
  const opts = {
    host: options.host || '127.0.0.1',
    port: options.port !== undefined ? Number(options.port) : 8788,
    bodyLimitBytes: options.bodyLimitBytes || 1000000,
    maxConcurrentRuns: options.maxConcurrentRuns || 2,
    maxPlanSteps: options.maxPlanSteps || 8,
    token: options.token !== undefined ? options.token : process.env.FORMAL_WEB_TOKEN || '',
    runsDir: options.runsDir || defaultRunsDir(),
    stepDelayMs: options.stepDelayMs !== undefined ? Number(options.stepDelayMs) : Number(process.env.FORMAL_WEB_STEP_DELAY_MS || 600),
    publicDir: options.publicDir || path.join(__dirname, 'public'),
  };
  let ensureRunsDirDone = false;
  const ensureRunsDir = async () => {
    if (!ensureRunsDirDone) {
      await fsp.mkdir(opts.runsDir, { recursive: true });
      ensureRunsDirDone = true;
    }
  };

  const runs = new Map(); // run_id -> state
  const activeRuns = new Set();

  const STATIC_FILES = new Map([
    ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
    ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
    ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
    ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ]);

  function sendJson(res, status, obj, extraHeaders = {}) {
    const body = JSON.stringify(obj, null, 2);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    res.end(body);
  }

  function sendError(res, status, code, message, extra) {
    sendJson(res, status, { error: { code, message, ...(extra ? { details: extra } : {}) } });
  }

  function requireAuth(req, res) {
    if (!opts.token) return true;
    const header = req.headers.authorization || '';
    if (!header) {
      sendError(res, 401, 'UNAUTHORIZED', 'fail-closed: missing Authorization: Bearer token (server runs in token-auth mode).');
      return false;
    }
    if (header !== `Bearer ${opts.token}`) {
      sendError(res, 403, 'FORBIDDEN', 'fail-closed: invalid bearer token.');
      return false;
    }
    return true;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let overLimit = false;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (!overLimit && size > opts.bodyLimitBytes) {
          overLimit = true;
          reject(Object.assign(new Error('request body exceeds 1MB cap'), { code: 'BODY_TOO_LARGE' }));
          // keep draining (without accumulating) so the client can finish sending
          // and still receive the 413 response instead of a connection reset
        }
        if (!overLimit) chunks.push(chunk);
      });
      req.on('end', () => {
        if (!overLimit) resolve(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', () => { /* after a limit rejection the response path handles it */ });
    });
  }

  function runSummaryView(state) {
    return {
      run_id: state.runId,
      plan_id: state.plan.plan_id,
      status: state.status,
      created_at: state.createdAt,
      plan_summary: {
        steps: state.plan.steps.map((s) => ({ id: s.id, tool: s.tool, operation: s.operation, depends_on: s.depends_on, timeout_s: s.timeout_s })),
      },
      step_states: Object.fromEntries(state.stepStates.entries()),
      receipt: state.receipt,
      streams: state.streams ? Object.fromEntries(state.streams.entries()) : {},
      mocked: true,
    };
  }

  async function handleApi(req, res, pathname, query) {
    if (pathname === '/api/meta') {
      if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'use GET /api/meta.');
      return sendJson(res, 200, {
        mode: opts.token ? 'token-auth' : 'local-only',
        mocked_contracts: true,
        engine: { kind: 'mock-v1', note: 'execution engine is MOCKED this round (V5-a); no real solver is launched. Real V2/V3 wiring pending.' },
        versions: { bridge: '0.5.0', engine: 'mock-v1', plan_schema: PLAN_SCHEMA, receipt_schema: RECEIPT_SCHEMA },
        caps: {
          body_limit_bytes: opts.bodyLimitBytes,
          max_concurrent_runs: opts.maxConcurrentRuns,
          run_wall_clock_s: 120,
          max_plan_steps: opts.maxPlanSteps,
          max_step_timeout_s: 120,
        },
        allowlist: Object.fromEntries(Object.entries(TOOL_ALLOWLIST).map(([t, o]) => [t, [o]])),
      });
    }

    // every other API route requires auth when a token is configured
    if (!requireAuth(req, res)) return;

    if (pathname === '/api/plan') {
      if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'use POST /api/plan.');
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err.code === 'BODY_TOO_LARGE') return sendError(res, 413, 'BODY_TOO_LARGE', 'fail-closed: request body exceeds the 1MB cap.');
        return sendError(res, 400, 'BAD_JSON', 'fail-closed: request body is not valid JSON.');
      }
      if (!body || typeof body !== 'object' || typeof body.problem_text !== 'string') {
        return sendError(res, 422, 'MISSING_PROBLEM', 'fail-closed: body must be {problem_text: string, assumptions?: string[]}.');
      }
      try {
        const result = buildPlan(body.problem_text, body.assumptions);
        return sendJson(res, 200, result);
      } catch (err) {
        if (err.failClosed) return sendError(res, err.status, err.code, err.message);
        return sendError(res, 500, 'PLAN_BUILDER_ERROR', `internal error: ${err.message}`);
      }
    }

    if (pathname === '/api/runs' && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err.code === 'BODY_TOO_LARGE') return sendError(res, 413, 'BODY_TOO_LARGE', 'fail-closed: request body exceeds the 1MB cap.');
        return sendError(res, 400, 'BAD_JSON', 'fail-closed: request body is not valid JSON.');
      }
      try {
        validatePlan(body && body.plan ? body.plan : body);
      } catch (err) {
        if (err.failClosed) return sendError(res, err.status, err.code, err.message);
        return sendError(res, 500, 'VALIDATOR_ERROR', `internal error: ${err.message}`);
      }
      const plan = body.plan || body;
      if (activeRuns.size >= opts.maxConcurrentRuns) {
        return sendError(res, 429, 'CONCURRENCY_LIMIT', `fail-closed: max ${opts.maxConcurrentRuns} concurrent runs; wait for a run to finish.`);
      }
      const runId = `run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
      const state = {
        runId,
        plan,
        status: 'running',
        createdAt: new Date().toISOString(),
        stepStates: new Map(plan.steps.map((s) => [s.id, 'queued'])),
        receipt: null,
        streams: null,
        opts: { ...opts, ensureRunsDir, onFinished: (id) => activeRuns.delete(id) },
      };
      runs.set(runId, state);
      activeRuns.add(runId);
      const executor = makeRunExecutor(state);
      state.receipt = executor.receipt;
      state.streams = executor.streams;
      return sendJson(res, 200, { run_id: runId, status: 'running', poll: `/api/runs/${runId}`, mocked: true });
    }

    let m = pathname.match(/^\/api\/runs\/([A-Za-z0-9-]+)$/);
    if (m) {
      if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'use GET /api/runs/:id.');
      const state = runs.get(m[1]);
      if (!state) return sendError(res, 404, 'RUN_NOT_FOUND', `fail-closed: no run with id "${m[1]}".`);
      return sendJson(res, 200, runSummaryView(state));
    }

    m = pathname.match(/^\/api\/runs\/([A-Za-z0-9-]+)\/evidence$/);
    if (m) {
      if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'use GET /api/runs/:id/evidence.');
      const state = runs.get(m[1]);
      if (!state || !state.receipt) return sendError(res, 404, 'RUN_NOT_FOUND', `fail-closed: no completed run with id "${m[1]}".`);
      const part = query.get('part');
      const stepId = query.get('step');
      if (part || stepId) {
        if (!part || !['stdout', 'stderr'].includes(part) || !stepId) {
          return sendError(res, 422, 'EVIDENCE_PART_INVALID', 'fail-closed: per-stream evidence needs ?part=stdout|stderr&step=<step_id>.');
        }
        const stream = state.streams.get(stepId);
        if (!stream) return sendError(res, 404, 'STEP_NOT_FOUND', `fail-closed: no step "${stepId}" in run.`);
        const body = stream[part];
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Content-Disposition': `attachment; filename="${part}-${state.runId}-${stepId}.txt"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        return res.end(body);
      }
      if (state.status === 'running') {
        return sendError(res, 409, 'RUN_STILL_RUNNING', 'fail-closed: evidence is available once the run completes.');
      }
      const payload = JSON.stringify({ receipt: state.receipt, streams: Object.fromEntries(state.streams.entries()) }, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Content-Disposition': `attachment; filename="receipt-${state.runId}.json"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      return res.end(payload);
    }

    return sendError(res, 404, 'NOT_FOUND', `fail-closed: unknown API route "${pathname}".`);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;
    const query = url.searchParams;
    try {
      if (pathname.startsWith('/api/')) {
        return await handleApi(req, res, pathname, query);
      }
      const staticEntry = STATIC_FILES.get(pathname);
      if (staticEntry && req.method === 'GET') {
        const content = await fsp.readFile(path.join(opts.publicDir, staticEntry.file));
        const headers = {
          'Content-Type': staticEntry.type,
          'Content-Length': content.length,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        };
        if (staticEntry.file === 'index.html') {
          headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
        }
        res.writeHead(200, headers);
        return res.end(content);
      }
      return sendError(res, 404, 'NOT_FOUND', `fail-closed: no route for "${pathname}".`);
    } catch (err) {
      if (!res.headersSent) return sendError(res, 500, 'INTERNAL', `internal error: ${err.message}`);
      res.end();
    }
  });

  return new Promise((resolve) => {
    server.listen(opts.port, opts.host, () => {
      const addr = server.address();
      const line = `FORMAL_WEB_LISTENING host=${opts.host} port=${addr.port} mode=${opts.token ? 'token-auth' : 'local-only'} engine=mock-v1`;
      console.log(line);
      resolve({ server, port: addr.port, opts, runs, activeRuns });
    });
  });
}

// main entry
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 8788);
  startServer({ port }).then(({ port: actual }) => {
    console.log(`[formal-web] UI: http://127.0.0.1:${actual}/  (engine=mock-v1, mocked_contracts=true)`);
  });
}
