// formal-tools i180/R3 — NL lane bridge tests (node --test, no browser, no deps,
// FULLY OFFLINE: the NL provider is a deterministic stub injected through the
// bridge's nlProviderImpl test seam; no API key is read and no network call is
// made by this file).
//
// Covered contract (apps/web/server.mjs NL lane):
//   POST /api/nl/propose {text}      -> {proposal: MODEL_PROPOSED|NEEDS_CLARIFICATION|UNKNOWN, warnings}
//   POST /api/nl/revise  {proposal, edited} -> {preview} (server re-validation + re-render)
//   POST /api/nl/approve {proposal, approved, edited?} -> USER_REJECTED | {plan, plan_sha256, approval}
//   POST /api/runs {plan, approval:{plan_sha256, approved_sha256}} — approval hash binding
// Honesty invariants asserted here: no auto-approval, NEEDS_CLARIFICATION is a
// dead end (nothing approvable, nothing executable), edited models are
// re-validated server-side and bound into the approval hash, tampered
// proposals/plans are refused, "optimize" is disclosed as CONTINUOUS LP
// RELAXATION (never an integer optimum), and a missing key fails closed with
// BLOCKED_PROVIDER. Real-DeepSeek journeys live in the R3 browser acceptance
// (agent-surrogate evidence) and tests/nl-model.driver.mjs (trusted host).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { startServer } from '../web/server.mjs';
import { sha256Canonical, validateExecutionPlan } from '../../packages/runner/js/workflow-plan.mjs';
import {
  NL_LP_RELAXATION_ASSUMPTION,
  nlLpRelaxationPlanAssumption,
} from '../../packages/runner/js/nl-model.mjs';

// --- deterministic stub provider (single dispatching provider for all cases) --
const SAT_MODEL = {
  variables: [
    { name: 'x', integer: true, lower: 3, upper: 50 },
    { name: 'y', integer: true, lower: 1, upper: 50 },
    { name: 'k', integer: true, lower: 1, upper: 14 },
  ],
  constraints: [
    { coefficients: { x: 1, y: 1, k: -7 }, op: '==', rhs: 0 },
    { coefficients: { y: 1, x: -1 }, op: '<=', rhs: 0 },
  ],
  question: 'sat',
  assumptions: ['auxiliary k: x+y = 7*k', 'k bounded because 4 <= x+y <= 100'],
};
const OPT_MODEL = {
  variables: [
    { name: 'x', integer: true, lower: 0, upper: 3 },
    { name: 'y', integer: true, lower: 0, upper: 4 },
  ],
  constraints: [
    { coefficients: { x: 1, y: 1 }, op: '<=', rhs: 4 },
    { coefficients: { x: 1 }, op: '<=', rhs: 3 },
  ],
  question: 'optimize',
  objective: { direction: 'maximize', coefficients: { x: 3, y: 2 } },
  assumptions: ['x in [0,3] because x <= 3', 'y in [0,4] implied by x+y <= 4 and x >= 0'],
};
const CLARIFY_REPLY = {
  variables: [],
  constraints: [],
  question: 'sat',
  assumptions: [],
  clarification_needed: [
    'Which concrete quantities define "safe", and what are their numeric bounds?',
    'What linear thresholds (e.g. failure-rate <= X) with which numeric values?',
  ],
};

const stubProvider = {
  model: 'stub-nl-model',
  // Dispatch on the problem text — deterministic, offline, no key.
  generate: async (prompt) => {
    const t = String(prompt?.original_text || '');
    if (t.includes('最大化')) return structuredClone(OPT_MODEL);
    if (t.includes('证明我们的系统')) return structuredClone(CLARIFY_REPLY);
    if (t.includes('BADREPLY')) return { totally: 'not the schema', foo: 1 };
    return structuredClone(SAT_MODEL);
  },
};

const SAT_TEXT = '找出整数 x 和 y：x 至少是 3，y 至少是 1，两个都不超过 50，x+y 恰好是 7 的倍数，并且 y 不超过 x。这样的整数对存在吗？';
const OPT_TEXT = '最大化 3x+2y，其中 x 和 y 都是非负整数，x+y 不超过 4，并且 x 不超过 3。';
const VAGUE_TEXT = '证明我们的系统总体上是安全的。';

const BLOCKED_ENV = Object.freeze({ ...process.env, FORMAL_PORTABLE_ROOT: '' });

let base; // stub-provider NL server (also serves the untouched direct lane)
let noKey; // NL provider = real DeepSeek path with an explicitly empty key
let tokened; // bearer-auth server (NL routes must be protected too)
let runsDir;

async function start(opts) {
  const handle = await startServer({ port: 0, runsDir, executorEnv: BLOCKED_ENV, ...opts });
  return { ...handle, origin: `http://127.0.0.1:${handle.port}` };
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

async function propose(origin, text) {
  const { res, body } = await postJson(origin, '/api/nl/propose', { text });
  assert.equal(res.status, 200, `propose failed: ${JSON.stringify(body)}`);
  return body;
}

async function approve(origin, proposal, extra = {}) {
  return postJson(origin, '/api/nl/approve', { proposal, approved: true, ...extra });
}

before(async () => {
  runsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formal-web-nl-test-runs-'));
  base = await start({ nlProviderImpl: stubProvider });
  noKey = await start({ deepseekApiKey: '' }); // no nlProviderImpl: real path, no key
  tokened = await start({ token: 'nl-test-token', nlProviderImpl: stubProvider });
});

after(async () => {
  for (const h of [base, noKey, tokened]) {
    if (h) await new Promise((r) => h.server.close(r));
  }
  await fsp.rm(runsDir, { recursive: true, force: true });
});

// --- meta ---------------------------------------------------------------------
describe('GET /api/meta — nl_lane advertised', () => {
  test('nl_lane documents the endpoints, provider and LP disclosure', async () => {
    const { res, body } = await jget(base.origin, '/api/meta');
    assert.equal(res.status, 200);
    assert.equal(body.nl_lane.module, 'packages/runner/js/nl-model.mjs');
    assert.match(body.nl_lane.propose, /\/api\/nl\/propose/);
    assert.match(body.nl_lane.approve, /\/api\/nl\/approve/);
    assert.match(body.nl_lane.execution_binding, /NL_APPROVAL_UNKNOWN|approval/);
    assert.match(body.nl_lane.lp_relaxation_disclosure, /integrality constraints are dropped/);
    assert.equal(body.nl_lane.provider, 'injected (test seam)');
    assert.equal(body.nl_lane.provider_configured, true);
  });
});

// --- propose -------------------------------------------------------------------
describe('POST /api/nl/propose (stub provider)', () => {
  test('happy path: MODEL_PROPOSED with full provenance, rendering and empty warnings', async () => {
    const { proposal, warnings } = await propose(base.origin, SAT_TEXT);
    assert.equal(proposal.schema, 'formal-tools/nl-model-proposal/0.1');
    assert.equal(proposal.status, 'MODEL_PROPOSED');
    assert.equal(proposal.original_text, SAT_TEXT, 'original text preserved verbatim (canonical)');
    assert.equal(proposal.provider.name, 'injected');
    assert.equal(proposal.provider.model, 'stub-nl-model');
    assert.match(proposal.prompt_sha256, /^[a-f0-9]{64}$/);
    assert.match(proposal.response_sha256, /^[a-f0-9]{64}$/);
    assert.match(proposal.proposal_sha256, /^[a-f0-9]{64}$/);
    assert.equal(proposal.review.approved, false, 'never auto-approved');
    // the browser sees: original request, variables, constraints, assumptions, SMT-LIB, provenance
    assert.equal(proposal.model.variables.length, 3);
    assert.equal(proposal.model.constraints.length, 2);
    assert.ok(Array.isArray(proposal.model.assumptions) && proposal.model.assumptions.length >= 1);
    assert.equal(proposal.rendering.kind, 'smt-lib2');
    assert.match(proposal.rendering.text, /\(set-logic QF_LIA\)/);
    assert.match(proposal.rendering.text, /\(check-sat\)/);
    assert.ok(!proposal.rendering.text.includes('get-model'));
    assert.equal(proposal.rendering.semantic_status, 'TRANSLATION_PROPOSAL_NOT_VERIFIED_AGAINST_TEXT');
    assert.match(proposal.honesty_note, /TRANSLATION PROPOSAL/);
    assert.deepEqual(warnings, [], 'sat questions carry no LP warning');
  });

  test('NEEDS_CLARIFICATION: questions returned, model/rendering null, no execution path', async () => {
    const { proposal } = await propose(base.origin, VAGUE_TEXT);
    assert.equal(proposal.status, 'NEEDS_CLARIFICATION');
    assert.ok(Array.isArray(proposal.clarification_needed) && proposal.clarification_needed.length >= 1);
    assert.equal(proposal.model, null);
    assert.equal(proposal.rendering, null);
    assert.equal(proposal.proposal_sha256, null);
    // approval attempt must be refused server-side (the UI cannot talk itself
    // into an execution path from a clarification record)
    const approveTry = await approve(base.origin, proposal);
    assert.equal(approveTry.res.status, 422);
    assert.equal(approveTry.body.error.code, 'NL_NOT_APPROVABLE');
    // explicit rejection IS allowed (terminal)
    const reject = await postJson(base.origin, '/api/nl/approve', { proposal, approved: false });
    assert.equal(reject.res.status, 200);
    assert.equal(reject.body.decision, 'USER_REJECTED');
    assert.equal(reject.body.record.status, 'USER_REJECTED');
    assert.equal(reject.body.record.review.status_was, 'NEEDS_CLARIFICATION');
    // revise is refused too: there is no model to edit
    const reviseTry = await postJson(base.origin, '/api/nl/revise', {
      proposal,
      edited: { variables: SAT_MODEL.variables, constraints: [], question: 'sat', assumptions: [] },
    });
    assert.equal(reviseTry.res.status, 422);
    assert.equal(reviseTry.body.error.code, 'NL_NOT_APPROVABLE');
  });

  test('hostile provider reply -> UNKNOWN with recorded issues (never rendered)', async () => {
    const { res, body } = await postJson(base.origin, '/api/nl/propose', { text: 'BADREPLY please' });
    assert.equal(res.status, 200, 'UNKNOWN is an honest 200 status record, not a server error');
    assert.equal(body.proposal.status, 'UNKNOWN');
    assert.equal(body.proposal.model, null);
    assert.equal(body.proposal.rendering, null);
    assert.ok(body.proposal.issues.length >= 1);
  });

  test('input validation: empty text 422 NL_TEXT_INVALID; oversized 422 NL_TEXT_OVERSIZED; bad body 422', async () => {
    const empty = await postJson(base.origin, '/api/nl/propose', { text: '   ' });
    assert.equal(empty.res.status, 422);
    assert.equal(empty.body.error.code, 'NL_TEXT_INVALID');
    const oversize = await postJson(base.origin, '/api/nl/propose', { text: 'x'.repeat(9000) });
    assert.equal(oversize.res.status, 422);
    assert.equal(oversize.body.error.code, 'NL_TEXT_OVERSIZED');
    const bad = await postJson(base.origin, '/api/nl/propose', { hello: 1 });
    assert.equal(bad.res.status, 422);
    assert.equal(bad.body.error.code, 'NL_TEXT_INVALID');
    const wrongMethod = await jget(base.origin, '/api/nl/propose');
    assert.equal(wrongMethod.res.status, 405);
  });
});

// --- no key -> honest BLOCKED_PROVIDER -----------------------------------------
describe('NL propose without DEEPSEEK_API_KEY (real provider path)', () => {
  test('fail-closed 422 BLOCKED_PROVIDER, no proposal', async () => {
    const { res, body } = await postJson(noKey.origin, '/api/nl/propose', { text: SAT_TEXT });
    assert.equal(res.status, 422);
    assert.equal(body.error.code, 'BLOCKED_PROVIDER');
    assert.match(body.error.message, /DEEPSEEK_API_KEY/);
    assert.equal(body.proposal, undefined);
  });
});

// --- revise (edit -> re-validate -> re-render; hashes unchanged) ----------------
describe('POST /api/nl/revise (structured edit preview)', () => {
  async function satProposal() {
    return (await propose(base.origin, SAT_TEXT)).proposal;
  }

  test('valid bounds edit: preview re-validates, rendering changes, warnings for optimize appear', async () => {
    const proposal = await satProposal();
    const edited = structuredClone(proposal.model);
    edited.variables[0].upper = 40; // x: [3, 50] -> [3, 40]
    const { res, body } = await postJson(base.origin, '/api/nl/revise', { proposal, edited });
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.preview.model.variables[0].upper, 40);
    assert.notEqual(body.preview.rendering.text, proposal.rendering.text, 're-rendered SMT differs');
    assert.notEqual(body.preview.rendering.sha256, proposal.rendering.sha256);
    assert.match(body.note, /preview only/);
    // the proposal itself is untouched: hashes are bound at approve time
    assert.equal(proposal.model.variables[0].upper, 50);
    const tampered = structuredClone(proposal);
    tampered.model.variables[0].upper = 40;
    const tamperTry = await postJson(base.origin, '/api/nl/revise', { proposal: tampered, edited });
    assert.equal(tamperTry.res.status, 422);
    assert.equal(tamperTry.body.error.code, 'NL_TAMPERED', 'mutating the carried proposal is refused');
  });

  test('invalid edit (crossed bounds) -> 422 NL_MODEL_INVALID with issues; malformed coefficients 422', async () => {
    const proposal = await satProposal();
    const crossed = structuredClone(proposal.model);
    crossed.variables[0].lower = 60;
    crossed.variables[0].upper = 40;
    const bad = await postJson(base.origin, '/api/nl/revise', { proposal, edited: crossed });
    assert.equal(bad.res.status, 422);
    assert.equal(bad.body.error.code, 'NL_MODEL_INVALID');
    assert.ok(bad.body.error.details.issues.some((i) => String(i).includes('bounds_crossed')));

    const undeclared = structuredClone(proposal.model);
    undeclared.constraints.push({ coefficients: { zzz: 1 }, op: '<=', rhs: 1 });
    const bad2 = await postJson(base.origin, '/api/nl/revise', { proposal, edited: undeclared });
    assert.equal(bad2.res.status, 422);
    assert.equal(bad2.body.error.code, 'NL_MODEL_INVALID');
    assert.ok(bad2.body.error.details.issues.some((i) => String(i).includes('undeclared')));
  });
});

// --- approve -> plan hash binding -> existing run lane --------------------------
describe('POST /api/nl/approve + approval-bound execution', () => {
  async function approvedSat() {
    const proposal = (await propose(base.origin, SAT_TEXT)).proposal;
    const { res, body } = await approve(base.origin, proposal);
    assert.equal(res.status, 200, JSON.stringify(body));
    return { proposal, body };
  }

  test('approve builds a typed plan bound to the approved record; plan_sha256 matches', async () => {
    const { body } = await approvedSat();
    assert.equal(body.decision, 'USER_APPROVED');
    assert.equal(body.question, 'sat');
    assert.equal(body.target, 'smt');
    const plan = body.plan;
    assert.equal(plan.schema, 'formal-tools/execution-plan/1.0');
    assert.equal(plan.source.problem_kind, 'nl_model');
    assert.equal(body.plan_sha256, sha256Canonical(plan), 'plan_sha256 binds the exact plan bytes');
    assert.deepEqual(plan.assumptions, SAT_MODEL.assumptions, 'model assumptions carried verbatim');
    assert.deepEqual(plan.steps.map((s) => s.tool), ['z3', 'cvc5', 'compare']);
    assert.match(plan.steps[0].input.smt_lib, /\(set-logic QF_LIA\)/, 'step input is the rendered SMT artifact');
    assert.match(body.approved.approved_sha256, /^[a-f0-9]{64}$/);
    assert.equal(body.approval.plan_sha256, body.plan_sha256);
    validateExecutionPlan(plan);
  });

  test('approval-bound run executes through the EXISTING /api/runs (honest BLOCKED receipt locally)', async () => {
    const { body } = await approvedSat();
    const { res, body: started } = await postJson(base.origin, '/api/runs', {
      plan: body.plan,
      approval: { plan_sha256: body.approval.plan_sha256, approved_sha256: body.approval.approved_sha256 },
    });
    assert.equal(res.status, 200, JSON.stringify(started));
    const view = await waitForRun(base.origin, started.run_id);
    assert.equal(view.receipt.overall.process_outcome, 'ABORTED');
    assert.equal(view.receipt.overall.fail_closed_reason, 'BLOCKED_TOOL_MISSING', 'honest local fail-closed, nothing simulated');
    assert.equal(view.receipt.overall.solver_answer.value, null, 'no solver answer claimed');
    assert.equal(view.nl_approval_binding.verified, true, 'run view discloses the verified approval binding');
    assert.equal(view.nl_approval_binding.approved_sha256, body.approved.approved_sha256);
  });

  test('TAMPER: approve model A, submit plan B with approval A -> refused (binding violated)', async () => {
    const { body } = await approvedSat();
    const planB = structuredClone(body.plan);
    planB.steps[0].input.smt_lib = planB.steps[0].input.smt_lib.replace('(check-sat)', '(assert (> x 100))\n(check-sat)');
    const { res, body: err } = await postJson(base.origin, '/api/runs', {
      plan: planB,
      approval: { plan_sha256: body.approval.plan_sha256, approved_sha256: body.approved.approved_sha256 },
    });
    assert.equal(res.status, 422);
    assert.equal(err.error.code, 'NL_PLAN_APPROVAL_MISMATCH');
    assert.match(err.error.message, /binding violated/);
    // self-consistent approval over an UNREGISTERED plan is refused too
    const ghost = await postJson(base.origin, '/api/runs', {
      plan: planB,
      approval: { plan_sha256: sha256Canonical(planB), approved_sha256: body.approved.approved_sha256 },
    });
    assert.equal(ghost.res.status, 422);
    assert.equal(ghost.body.error.code, 'NL_APPROVAL_UNKNOWN');
    // malformed approval shape refused
    const badShape = await postJson(base.origin, '/api/runs', { plan: body.plan, approval: { foo: 1 } });
    assert.equal(badShape.res.status, 422);
    assert.equal(badShape.body.error.code, 'NL_APPROVAL_INVALID');
  });

  test('TAMPER: mutated proposal (hash mismatch) -> 422 NL_TAMPERED, nothing approved', async () => {
    const proposal = (await propose(base.origin, SAT_TEXT)).proposal;
    const mutated = structuredClone(proposal);
    mutated.model.variables[0].upper = 42; // proposal_sha256 no longer covers the core
    const { res, body } = await approve(base.origin, mutated);
    assert.equal(res.status, 422);
    assert.equal(body.error.code, 'NL_TAMPERED');
  });

  test('edited approval: edit is re-validated, re-rendered and changes the approval hash + plan', async () => {
    const proposal = (await propose(base.origin, SAT_TEXT)).proposal;
    const edited = structuredClone(proposal.model);
    edited.variables[0].upper = 40;
    const { res, body } = await approve(base.origin, proposal, { edited });
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.decision, 'USER_APPROVED');
    assert.equal(body.approved.review.edited, true, 'the edit is recorded in the approval');
    assert.ok(body.plan.steps[0].input.smt_lib.includes('(assert (<= x 40))'), 'plan input carries the edited bound');
    assert.ok(!body.plan.steps[0].input.smt_lib.includes('(assert (<= x 50))'));
    // different content -> different approval + plan hashes (hash update proof)
    const plain = await approvedSat();
    assert.notEqual(body.approved.approved_sha256, plain.body.approved.approved_sha256);
    assert.notEqual(body.plan_sha256, plain.body.plan_sha256);
  });

  test('reject is terminal: USER_REJECTED record, no plan, no approval registered', async () => {
    const proposal = (await propose(base.origin, SAT_TEXT)).proposal;
    const { res, body } = await postJson(base.origin, '/api/nl/approve', { proposal, approved: false });
    assert.equal(res.status, 200);
    assert.equal(body.decision, 'USER_REJECTED');
    assert.equal(body.record.status, 'USER_REJECTED');
    assert.equal(body.record.proposal_sha256, proposal.proposal_sha256, 'rejection cites the proposal hash');
    assert.equal(body.plan, undefined);
    assert.equal(body.approval, undefined);
    // the rejected proposal cannot be approved afterwards in the same process:
    const late = await approve(base.origin, proposal);
    assert.equal(late.res.status, 200, 'approveModel is pure: the reject did not mutate server state');
    assert.equal(late.body.decision, 'USER_APPROVED', 'approveModel has no session side effects (approval is explicit per call)');
    // ...but an approval whose plan was never registered cannot execute:
    const ghostRun = await postJson(base.origin, '/api/runs', {
      plan: late.body.plan,
      approval: { plan_sha256: 'f'.repeat(64), approved_sha256: late.body.approved.approved_sha256 },
    });
    assert.equal(ghostRun.res.status, 422);
    assert.equal(ghostRun.body.error.code, 'NL_APPROVAL_UNKNOWN');
  });
});

// --- LP arm (i180/R3 seam, B's fail-closed gate): explicit relaxation ack -------
describe('NL optimize arm — explicit LP-relaxation gate (UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION)', () => {
  test('optimize WITHOUT ack -> restricted record (plan:null), rendered contract, nothing executable', async () => {
    const { proposal, warnings } = await propose(base.origin, OPT_TEXT);
    assert.equal(proposal.model.question, 'optimize');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /LP RELAXATION ONLY/);

    const { res, body } = await approve(base.origin, proposal); // no lpRelaxationAcknowledged
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.decision, 'UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION');
    assert.equal(body.note.includes('lpRelaxationAcknowledged'), true);
    const record = body.record;
    assert.equal(record.schema, 'formal-tools/nl-model-approved/0.1');
    assert.equal(record.status, 'UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION');
    assert.equal(record.plan, null, 'no plan is produced');
    assert.equal(record.question, 'optimize');
    assert.equal(record.unsupported.code, 'UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION');
    assert.equal(record.unsupported.reason, 'LP_RELAXATION_NOT_ACKNOWLEDGED');
    assert.deepEqual(record.unsupported.dropped, ['integrality']);
    assert.equal(record.unsupported.required_decision_field, 'lpRelaxationAcknowledged');
    assert.ok(Array.isArray(record.unsupported.remedies) && record.unsupported.remedies.length >= 1);
    assert.match(record.unsupported.remedies[0], /lpRelaxationAcknowledged: true/);
    assert.match(record.detail, /never presents an LP relaxation optimum as an integer optimum/);
    assert.equal(record.review.unsupported, true);
    assert.equal(body.approval, undefined, 'no approval binding is registered');
    assert.equal(body.warnings.length, 1, 'the restricted result still carries the LP warning');
    // the restricted record is NOT executable: a run submission referencing it fails closed
    const ghost = await postJson(base.origin, '/api/runs', {
      plan: SAT_MODEL, // arbitrary plan; the binding is the point
      approval: { plan_sha256: sha256Canonical(SAT_MODEL), approved_sha256: record.proposal_sha256 },
    });
    assert.equal(ghost.res.status, 422);
    assert.equal(ghost.body.error.code, 'NL_APPROVAL_UNKNOWN', 'restricted approvals never register an execution binding');
  });

  test('gate applies to the FINAL model: sat proposal edited into optimize without ack -> restricted, edited:true', async () => {
    const proposal = (await propose(base.origin, SAT_TEXT)).proposal;
    assert.equal(proposal.model.question, 'sat');
    const { res, body } = await approve(base.origin, proposal, { edited: structuredClone(OPT_MODEL) });
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.decision, 'UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION');
    assert.equal(body.record.edited, true, 'the gate sees the edited model');
    assert.equal(body.record.model.question, 'optimize');
    assert.equal(body.record.plan, null);
  });

  test('optimize WITH ack -> USER_APPROVED: relaxation metadata on the wrapper, marker assumption in the plan, binding still enforced', async () => {
    const proposal = (await propose(base.origin, OPT_TEXT)).proposal;
    const { res, body } = await approve(base.origin, proposal, { lpRelaxationAcknowledged: true });
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.decision, 'USER_APPROVED');
    assert.equal(body.target, 'lp');
    assert.equal(body.warnings.length, 1);
    assert.match(body.warnings[0], /LP RELAXATION ONLY/);
    // frozen wrapper relaxation contract
    const relaxation = body.relaxation;
    assert.equal(relaxation.kind, 'LP_RELAXATION_ONLY');
    assert.deepEqual(relaxation.dropped, ['integrality']);
    assert.equal(relaxation.ack.acknowledged, true);
    assert.equal(relaxation.ack.decision_field, 'lpRelaxationAcknowledged');
    assert.match(relaxation.meaning, /integrality constraints are dropped/);
    assert.match(relaxation.effect, /not its exact optimum/);
    // approved record carries the hash-covered ack review
    assert.equal(body.approved.review.lp_relaxation_ack.acknowledged, true);
    // plan carries BOTH the prose assumption and the canonical JSON marker
    assert.deepEqual(body.plan.steps.map((s) => s.tool), ['highs']);
    assert.ok(body.plan.assumptions.includes(NL_LP_RELAXATION_ASSUMPTION), 'prose integrality-drop assumption');
    assert.ok(body.plan.assumptions.includes(nlLpRelaxationPlanAssumption()), 'canonical JSON relaxation marker');
    assert.equal(body.plan_sha256, sha256Canonical(body.plan));
    validateExecutionPlan(body.plan);
    // the acknowledgement is hash-covered: the binding run still executes
    const { res: runRes, body: started } = await postJson(base.origin, '/api/runs', {
      plan: body.plan,
      approval: { plan_sha256: body.approval.plan_sha256, approved_sha256: body.approval.approved_sha256 },
    });
    assert.equal(runRes.status, 200, JSON.stringify(started));
    const view = await waitForRun(base.origin, started.run_id);
    assert.equal(view.receipt.overall.fail_closed_reason, 'BLOCKED_TOOL_MISSING', 'honest local fail-closed unchanged');
    assert.equal(view.nl_approval_binding.verified, true, 'ack-inclusive approved_sha256 binds the run');
    // tampering with the ack-bearing plan is still refused
    const planB = structuredClone(body.plan);
    planB.steps[0].input.sense = 'min';
    const tamper = await postJson(base.origin, '/api/runs', {
      plan: planB,
      approval: { plan_sha256: body.approval.plan_sha256, approved_sha256: body.approval.approved_sha256 },
    });
    assert.equal(tamper.res.status, 422);
    assert.equal(tamper.body.error.code, 'NL_PLAN_APPROVAL_MISMATCH', 'tamper rejection regression on the ack path');
  });
});

// --- direct lane regression + auth ----------------------------------------------
describe('direct lane + auth regressions', () => {
  test('/api/plan still rejects prose fail-closed (the NL lane is the prose entry, not a plan bypass)', async () => {
    const { res, body } = await postJson(base.origin, '/api/plan', { problem_text: VAGUE_TEXT });
    assert.equal(res.status, 422);
    assert.equal(body.error.code, 'UNSUPPORTED_PROBLEM');
  });

  test('NL routes require the bearer token when the server runs in token-auth mode', async () => {
    const denied = await postJson(tokened.origin, '/api/nl/propose', { text: SAT_TEXT });
    assert.equal(denied.res.status, 401);
    assert.equal(denied.body.error.code, 'UNAUTHORIZED');
    const ok = await postJson(tokened.origin, '/api/nl/propose', { text: SAT_TEXT }, { Authorization: 'Bearer nl-test-token' });
    assert.equal(ok.res.status, 200);
    assert.equal(ok.body.proposal.status, 'MODEL_PROPOSED');
  });
});
