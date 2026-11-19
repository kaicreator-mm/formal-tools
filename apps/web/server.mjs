#!/usr/bin/env node
// formal-tools — V5-b bounded trusted Web bridge (issue #185, OUTPUT_LABEL=FORMAL_TOOLS_I180_V5B_LIVE_ENGINE)
//
// Scope of this round (V5-b): the execution engine is REAL. The mocked planner /
// executor of V5-a is replaced by the actual engine modules:
//   * planning  — packages/runner/js/workflow-plan.mjs (V2): normalizeUserProblem,
//     stepsFromMethod, buildExecutionPlan; compilePlan (workflow-compiler.mjs)
//     backfills the real compiled hashes.
//   * execution — packages/runner/js/workflow-executor.mjs (V3): executeWorkflowPlan
//     re-validates the plan as data and runs the typed DAG. On machines without the
//     trusted portable tool bundle (FORMAL_PORTABLE_ROOT) the executor fails closed
//     BEFORE any step and returns an honest ABORTED receipt with
//     fail_closed_reason=BLOCKED_TOOL_MISSING. That receipt is a REAL result and is
//     served/displayed as-is — nothing is simulated anywhere.
//   * provider  — provider:"deepseek" plans through makeDeepSeekChatProvider +
//     proposeMethod; the LLM proposal is UNTRUSTED DATA that only enters a plan via
//     the static V2 gates (assessMethod + buildExecutionPlan). No key ⇒ honest
//     BLOCKED_PROVIDER. The key travels only in the Authorization header.
//
// Security posture:
//   * binds 127.0.0.1 by default; optional bearer token via FORMAL_WEB_TOKEN;
//     a NON-loopback bind REQUIRES FORMAL_WEB_TOKEN (fail-closed at startup —
//     anonymous execution beyond loopback is impossible)
//   * request bodies are capped (413 over the limit); plans are re-validated by the
//     executor's own validator plus bridge hard caps (422 fail-closed)
//   * max 2 concurrent runs, per-run wall clock <= 120s (budgets), plan steps <= 8
//   * this file imports no child_process and spawns nothing; the only process launch
//     path lives inside the V3 executor (spawn argv with shell:false) and is
//     unreachable without the trusted bundle; fs writes go only to the runs directory
//     (per-run receipts/artifacts) and the executor's own temp workspace is removed
//     after each run
//   * no CORS headers at all (same-origin only)
//
// Evidence honesty (i180/R2-D): receipt.steps[].stdout_sha256 / stderr_sha256
// hash the FULL captured streams. The executor's display copies are capped at
// BOUNDED_BYTES (4096) and the V3 workspace does NOT retain full stream bytes,
// so persisted log artifacts are always NAMED bounded (logs/<step>.stdout.bounded.txt)
// with their OWN sha256 in the manifest. A plain-named logs/<step>.stdout.txt
// ("full-stream") artifact exists only when its bytes verify against the
// receipt's full-stream hash: either full bytes were retained via the
// executorCaptureImpl test seam, or the bounded copy is provably the whole
// stream (< BOUNDED_BYTES). bounded_matches_full_stream is null (never claimed)
// whenever the two cannot be verified against each other.
//
// NL lane (i180/R3, additive): POST /api/nl/propose (natural language -> real
// DeepSeek translation proposal via packages/runner/js/nl-model.mjs —
// UNTRUSTED data, never auto-approved), POST /api/nl/revise (server-side
// re-validation + re-render preview of user edits), POST /api/nl/approve
// (explicit approve/reject gate; approve builds the typed ExecutionPlan and
// registers its exact sha256), and an OPTIONAL approval hash binding on
// POST /api/runs: a submitted approval executes only the exact plan sha256 it
// covered (tamper/substitution -> 422, nothing runs). NEEDS_CLARIFICATION
// proposals are not approvable; "optimize" questions are disclosed as
// CONTINUOUS LP RELAXATION results, never as integer optima.

import http from 'node:http';
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAPS,
  WorkflowError,
  normalizeUserProblem,
  makeDeepSeekChatProvider,
  stepsFromMethod,
  buildExecutionPlan,
  sha256Canonical,
} from '../../packages/runner/js/workflow-plan.mjs';
import {
  NL_LP_RELAXATION_ASSUMPTION,
  proposeConstraintModel,
  approveModel,
  buildPlanFromApprovedModel,
  validateStructuredModel,
  renderSmtArtifact,
  renderLpModel,
} from '../../packages/runner/js/nl-model.mjs';
import { proposeMethod } from '../../packages/runner/js/method-planner.mjs';
import { compilePlan } from '../../packages/runner/js/workflow-compiler.mjs';
import {
  executeWorkflowPlan,
  validateExecutionPlan as validateExecutorPlan,
  WorkflowBlockedError,
  WorkflowPlanError,
} from '../../packages/runner/js/workflow-executor.mjs';
import {
  writeExecutionReceiptArtifacts,
  ARTIFACT_MANIFEST_SCHEMA,
  BOUNDED_BYTES,
  sha256Hex,
} from '../../packages/runner/js/workflow-evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const PLAN_SCHEMA = 'formal-tools/execution-plan/1.0';
const RECEIPT_SCHEMA = 'formal-tools/execution-receipt/1.0';

// Tool -> the single operation each tool may perform. Anything else is fail-closed
// at plan validation (the frozen V2 allowlist is enforced again by the executor).
const TOOL_ALLOWLIST = {
  z3: 'solve-smt',
  cvc5: 'solve-smt',
  highs: 'solve-lp',
  compare: 'cross-check',
};

// Bridge hard caps (mirror CAPS and the executor's assumption bound; enforced here
// in addition to the engine's own validation — defense in depth).
const BRIDGE_MAX_STEPS = 8;
const BRIDGE_MAX_TOTAL_TIMEOUT_S = 120;
const BRIDGE_MAX_ASSUMPTION_CHARS = 256; // executor re-validates at 256

// ---------------------------------------------------------------------------
// NL lane (i180/R3): natural language -> nl-model.mjs proposal -> explicit
// user approval -> typed ExecutionPlan -> the EXISTING restricted /api/runs.
// The server is stateless across propose/revise (the browser carries the
// hash-bound proposal); approveModel/buildPlanFromApprovedModel re-verify the
// hashes (NL_TAMPERED) so a mutated proposal can never reach a plan. The ONLY
// new execution authority is an in-memory approval registry: /api/runs accepts
// an optional `approval` binding and executes an NL plan only when its exact
// sha256 was produced by a real approveModel USER_APPROVED record in THIS
// server process. Everything else about the lane is honest data:
// NEEDS_CLARIFICATION proposals carry no model/rendering and are not
// approvable (NL_NOT_APPROVABLE); optimize questions are disclosed as
// CONTINUOUS LP RELAXATION results (integrality dropped), never as integer
// optima; the DeepSeek key travels only in the Authorization header upstream
// and never reaches the browser.
// ---------------------------------------------------------------------------

const NL_LP_WARNING =
  'LP RELAXATION ONLY: this question is "optimize", so the executed plan solves the ' +
  'CONTINUOUS LP relaxation (HiGHS) with integrality dropped. The answer bounds the ' +
  'relaxation and is NOT proven to be the integer optimum.';

/** Server-side honesty warnings for an NL question kind (defensive: additive). */
function nlServerWarnings(question) {
  return question === 'optimize' ? [NL_LP_WARNING] : [];
}

/**
 * Integrity guard for a client-carried proposal: recompute the canonical core
 * hash exactly like nl-model.mjs does. Throws NL_TAMPERED on any mismatch.
 */
function assertProposalIntegrity(proposal) {
  const core = {
    original_text: proposal.original_text,
    provider: proposal.provider,
    prompt_sha256: proposal.prompt_sha256,
    response_sha256: proposal.response_sha256,
    model: proposal.model,
    rendering: proposal.rendering,
  };
  if (proposal.proposal_sha256 !== sha256Canonical(core)) {
    throw new WorkflowError('NL_TAMPERED', 'proposal_sha256 does not cover the recorded proposal core');
  }
}

function defaultRunsDir() {
  return path.join(REPO_ROOT, 'apps', 'web-tests', '.runs');
}

// ---------------------------------------------------------------------------
// Evidence persistence: bounded copies are labeled, full-stream artifacts are
// verified against the receipt hashes before they may carry a plain name.
// ---------------------------------------------------------------------------

const EVIDENCE_LABELING_NOTE =
  'receipt steps[].stdout_sha256 / stderr_sha256 hash the FULL captured streams. ' +
  'logs/<step>.<part>.bounded.txt are display copies capped at ' + BOUNDED_BYTES + ' bytes and carry their OWN sha256. ' +
  'A plain-named logs/<step>.<part>.txt exists only when its bytes were verified against the receipt full-stream hash. ' +
  'bounded_matches_full_stream=null means the two were NOT verifiable against each other on this host — never claim byte identity across them.';

/**
 * Persist receipt.json + hash-bound log artifacts + manifest.json under `dir`.
 *
 * Splits full vs bounded honestly (i180/R2-D):
 *   * bounded display copies (<= BOUNDED_BYTES) are ALWAYS persisted and named
 *     `logs/<step>.<part>.bounded.txt` with their own sha256 + scope
 *     "bounded-copy" in the manifest;
 *   * a plain-named `logs/<step>.<part>.txt` (scope "full-stream") is written
 *     ONLY when its bytes verify against the receipt's full-stream hash —
 *     from retained full bytes (`fullStreams`, keyed "<step_id>:<part>") or,
 *     provably, from the bounded copy itself when it is shorter than the cap
 *     (boundText is the identity below the cap);
 *   * the manifest maps every stream to its authoritative full-stream hash and
 *     states `bounded_matches_full_stream: true|false|null` — null when the
 *     identity cannot be verified (never guessed).
 *
 * Re-uses writeExecutionReceiptArtifacts for the canonical receipt.json bytes
 * and its verified-hash log writing, then relabels its unqualified log names
 * (its contract only knows bounded copies). Returns the rewritten manifest.
 */
export async function persistRunEvidence(dir, receipt, fullStreams = null) {
  if (receipt === null || typeof receipt !== 'object' || receipt.schema !== 'formal-tools/execution-receipt/1.0') {
    throw new TypeError('persistRunEvidence requires a built execution receipt');
  }
  if (fullStreams !== null && typeof fullStreams !== 'object') {
    throw new TypeError('fullStreams must be null or a Map keyed "<step_id>:<part>"');
  }
  const getFull = (stepId, part) => {
    if (!fullStreams || typeof fullStreams.get !== 'function') return null;
    const raw = fullStreams.get(`${stepId}:${part}`);
    return typeof raw === 'string' ? raw : null;
  };

  // 1. Bounded raw streams exactly as captured for display (<= BOUNDED_BYTES,
  //    the writeExecutionReceiptArtifacts contract).
  const rawStreams = [];
  const boundedByStream = new Map(); // "<step_id>:<part>" -> bounded string
  for (const s of receipt.steps) {
    const stdout = typeof s.stdout_bounded === 'string' ? s.stdout_bounded : '';
    const stderr = typeof s.stderr_bounded === 'string' ? s.stderr_bounded : '';
    if (stdout) boundedByStream.set(`${s.step_id}:stdout`, stdout);
    if (stderr) boundedByStream.set(`${s.step_id}:stderr`, stderr);
    if (stdout || stderr) rawStreams.push({ step_id: s.step_id, stdout, stderr });
  }
  // 2. receipt.json + unqualified bounded logs + base manifest (verified hashes).
  const base = await writeExecutionReceiptArtifacts(dir, receipt, rawStreams);

  // 3. Relabel: bounded copies get ".bounded.txt"; plain names are reserved for
  //    verified full-stream bytes. Compute the final artifact list ourselves.
  const streamEntries = [];
  const artifacts = [{ name: 'receipt.json', sha256: base.manifest.receipt_sha256, bytes: null }];
  for (const [key, boundedText] of boundedByStream) {
    const [stepId, part] = key.split(':');
    const boundedName = `logs/${stepId}.${part}.bounded.txt`;
    const fullName = `logs/${stepId}.${part}.txt`;
    const boundedBuf = Buffer.from(boundedText, 'utf8');
    const boundedSha = sha256Hex(boundedBuf);
    const step = receipt.steps.find((st) => st.step_id === stepId);
    const fullSha = step ? (part === 'stdout' ? step.stdout_sha256 : step.stderr_sha256) : null;
    if (fullSha === null || fullSha === undefined) {
      throw new Error(`persistRunEvidence: receipt has a bounded ${part} copy for step "${stepId}" but no ${part}_sha256`);
    }

    // Rename the module's unqualified bounded log to the honest bounded name.
    await fsp.rename(path.join(dir, 'logs', `${stepId}.${part}.txt`), path.join(dir, boundedName));

    // Full-stream artifact: only from bytes that VERIFY against the receipt hash.
    let fullBuf = null;
    let identity = null;
    const teed = getFull(stepId, part);
    if (teed !== null && teed.length > 0) {
      const buf = Buffer.from(teed, 'utf8');
      if (sha256Hex(buf) === fullSha) {
        fullBuf = buf;
        identity = boundedSha === fullSha;
      }
      // else: retained bytes do not match the receipt hash — refuse to publish
      // them as the full stream (honest degrade to bounded-only, identity null).
    }
    if (fullBuf === null && boundedBuf.length < BOUNDED_BYTES && boundedSha === fullSha) {
      // Provable identity: a display copy shorter than the cap IS the full stream.
      fullBuf = boundedBuf;
      identity = true;
    }
    if (fullBuf !== null) await fsp.writeFile(path.join(dir, fullName), fullBuf);

    artifacts.push({ name: boundedName, sha256: boundedSha, bytes: boundedBuf.length, scope: 'bounded-copy' });
    if (fullBuf !== null) {
      artifacts.push({ name: fullName, sha256: sha256Hex(fullBuf), bytes: fullBuf.length, scope: 'full-stream' });
    }
    streamEntries.push({
      step_id: stepId,
      stream: part,
      full_stream_sha256: fullSha,
      full_stream_bytes_retained: fullBuf !== null,
      full_artifact: fullBuf !== null ? fullName : null,
      full_artifact_sha256: fullBuf !== null ? sha256Hex(fullBuf) : null,
      bounded_artifact: boundedName,
      bounded_sha256: boundedSha,
      bounded_bytes: boundedBuf.length,
      bounded_matches_full_stream: identity,
    });
  }

  // 4. Receipt.json byte length for the manifest entry.
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  artifacts[0].bytes = receiptBytes.length;
  artifacts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // 5. Rewrite the manifest with scope labels + the full-vs-bounded stream map.
  const manifest = {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    run_id: receipt.run_id,
    plan_id: receipt.plan_id,
    receipt_sha256: base.manifest.receipt_sha256,
    stream_cap_bytes: BOUNDED_BYTES,
    artifacts,
    streams: streamEntries.sort((a, b) => (a.step_id + a.stream < b.step_id + b.stream ? -1 : 1)),
    labeling_note: EVIDENCE_LABELING_NOTE,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await fsp.writeFile(path.join(dir, 'manifest.json'), manifestBytes);
  return { manifest, receipt_sha256: base.manifest.receipt_sha256 };
}

// ---------------------------------------------------------------------------
// Problem kind detection (deterministic, fail-closed)
// ---------------------------------------------------------------------------

const SMT_MARKERS = ['(set-logic', '(declare-fun', '(declare-const', '(assert', '(check-sat'];
const LP_MODEL_KEYS = ['sense', 'objective', 'variables', 'constraints'];

function failClosed(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  err.status = 422;
  err.failClosed = true;
  if (extra) err.extra = extra;
  return err;
}

function canonicalProblemTextLocal(text) {
  return String(text).normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

/** Exactly the LP model shape the frozen contract admits (docs §4). */
function isLpModelShape(parsed) {
  return Boolean(
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
    LP_MODEL_KEYS.every((k) => Object.prototype.hasOwnProperty.call(parsed, k)) &&
    (parsed.sense === 'min' || parsed.sense === 'max'),
  );
}

function detectProblemKind(rawText) {
  const text = canonicalProblemTextLocal(rawText);
  if (!text) throw failClosed('EMPTY_PROBLEM', 'fail-closed: problem input is empty.');
  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw failClosed('MALFORMED_LP_JSON', 'fail-closed: input looks like JSON but does not parse; not accepted as any known problem kind.');
    }
    if (!isLpModelShape(parsed)) {
      throw failClosed(
        'UNSUPPORTED_LP_MODEL',
        'fail-closed: parsed JSON is not an LP model with exactly the keys sense ("min"|"max"), objective, variables, constraints (frozen HiGHS model shape).',
      );
    }
    return { kind: 'lp-json', lpModel: parsed, canonicalText: text };
  }
  if (SMT_MARKERS.some((m) => text.includes(m))) {
    return { kind: 'smt2', lpModel: null, canonicalText: text };
  }
  throw failClosed(
    'UNSUPPORTED_PROBLEM',
    'fail-closed: input is neither SMT-LIB2 text (needs (assert / (check-sat ...) forms) nor an LP JSON model with exactly sense/objective/variables/constraints keys.',
  );
}

// ---------------------------------------------------------------------------
// Deterministic method templates + typed steps (mirror the frozen fixture
// shapes of tests/workflow-plan.test.mjs; never guessed)
// ---------------------------------------------------------------------------

const CAPABILITY_BY_KIND = { smt2: ['logic.smt'], 'lp-json': ['opt.numerical'] };
const TEMPLATE_BY_KIND = { smt2: 'smt-cross-check@v1', 'lp-json': 'highs-lp@v1' };

const DEFAULT_ASSUMPTIONS = {
  smt2: [
    'Input is UTF-8 SMT-LIB2 text intended for QF-style solving.',
    'Solvers may return "unknown" within the per-step timeout; that is an honest outcome, not an error.',
  ],
  'lp-json': [
    'LP model is well-formed and interpreted with standard HiGHS linear-programming semantics.',
    'Numerical tolerance for optimality follows the solver default.',
  ],
};

function sanitizeAssumptions(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > CAPS.assumptionItems) {
    throw failClosed('INVALID_ASSUMPTIONS', `fail-closed: assumptions must be an array of at most ${CAPS.assumptionItems} strings.`);
  }
  for (const text of input) {
    if (typeof text !== 'string' || !text.trim() || text.length > BRIDGE_MAX_ASSUMPTION_CHARS) {
      throw failClosed('INVALID_ASSUMPTIONS', `fail-closed: each assumption must be a non-empty string of at most ${BRIDGE_MAX_ASSUMPTION_CHARS} characters (executor bound).`);
    }
  }
  return input.map((t) => t.trim());
}

function deterministicMethod(kind, problem) {
  if (kind === 'smt2') {
    return {
      schema: 'formal-tools/method-proposal/0.1',
      method_id: 'template-smt-cross-check',
      problem_id: problem.problem_id,
      goal_claim_ids: ['claim1'],
      oracle_ids: ['heldout'],
      semantic_review: 'PENDING',
      steps: [
        { id: 'step-z3', tool_id: 'z3', operation: 'solve', claim_ids: ['claim1'], provides: ['logic.smt'],
          depends_on: [], source_refs: ['user-problem-text'], estimated_cost_units: 1, timeout_ms: 30000,
          destination: 'LOCAL', output_classification: 'PUBLIC' },
        { id: 'step-cvc5', tool_id: 'cvc5', operation: 'solve', claim_ids: ['claim1'], provides: ['logic.smt'],
          depends_on: ['step-z3'], source_refs: [], estimated_cost_units: 1, timeout_ms: 30000,
          destination: 'LOCAL', output_classification: 'PUBLIC' },
      ],
    };
  }
  return {
    schema: 'formal-tools/method-proposal/0.1',
    method_id: 'template-highs-lp',
    problem_id: problem.problem_id,
    goal_claim_ids: ['claim1'],
    oracle_ids: ['heldout'],
    semantic_review: 'PENDING',
    steps: [
      { id: 'step-highs', tool_id: 'highs', operation: 'UNRESOLVED', claim_ids: ['claim1'],
        provides: ['opt.numerical'], depends_on: [], source_refs: ['user-problem-text'],
        estimated_cost_units: 1, timeout_ms: 30000, destination: 'LOCAL', output_classification: 'PUBLIC' },
    ],
  };
}

/** Trusted caller inputs for stepsFromMethod, keyed by method step id. */
function trustedInputsForMethod(method, canonicalText, lpModel) {
  const inputs = {};
  for (const s of method.steps) {
    if (s.tool_id === 'z3' || s.tool_id === 'cvc5') inputs[s.id] = { smt_lib: canonicalText };
    else if (s.tool_id === 'highs') inputs[s.id] = lpModel;
  }
  return inputs;
}

/**
 * Executor-side compare step appended after the typed solver steps (compare has
 * no method counterpart; docs/mvp/EXECUTION_PLAN_CONTRACT.md §3). Applied when
 * at least two solver steps exist so a cross-tool verdict is always attempted.
 */
function compareStepFor(solverStepIds) {
  return {
    id: 'step-agree',
    tool: 'compare',
    operation: 'cross-check',
    depends_on: [...solverStepIds],
    input: { left_step: solverStepIds[0], right_step: solverStepIds[1], agree_on: ['sat', 'unsat'] },
    timeout_s: 5,
    expected_output_kind: 'cross-tool-verdict',
  };
}

/**
 * Shared plan build path: normalize -> stepsFromMethod -> buildExecutionPlan ->
 * compilePlan (real compiled hashes). `method` is either the deterministic
 * template or the DeepSeek proposal (untrusted data already admitted by
 * proposeMethod's assessMethod; buildExecutionPlan re-admits it).
 */
function buildRealPlan({ kind, canonicalText, lpModel, method, problem, assumptions }) {
  const inputs = trustedInputsForMethod(method, canonicalText, lpModel);
  const typed = stepsFromMethod(method, inputs);
  const solverIds = typed.filter((s) => s.tool === 'z3' || s.tool === 'cvc5' || s.tool === 'highs').map((s) => s.id);
  const compareSteps = solverIds.length >= 2 ? [compareStepFor(solverIds)] : [];
  const steps = stepsFromMethod(method, inputs, { compareSteps });
  const plan = buildExecutionPlan({ problem, method, steps, assumptions, problemKind: kind });
  const compiled = compilePlan(plan); // deterministic; never mutates `plan`
  return compiled.plan;
}

async function planWithProvider(kind, canonicalText, lpModel, problem, assumptions, apiKey) {
  const provider = makeDeepSeekChatProvider({ apiKey });
  // Host egress authority: the user explicitly selected provider:"deepseek" for
  // their own problem text in this request, which is the whole approved payload.
  const egressAuthority = { authorizePublicPayload: async () => true };
  const verdict = await proposeMethod(problem, provider.generate, egressAuthority);
  if (verdict.status !== 'STRUCTURALLY_VALID') {
    throw failClosed('PLAN_METHOD_INVALID', 'fail-closed: DeepSeek method proposal rejected by assessMethod.', {
      issues: (verdict.issues || []).slice(0, 8),
    });
  }
  const method = provider.getProposal();
  const plan = buildRealPlan({ kind, canonicalText, lpModel, method, problem, assumptions });
  return {
    plan,
    plan_source: {
      kind: 'deepseek',
      provider: 'deepseek',
      model: provider.model,
      method_sha256: verdict.method_sha256,
    },
  };
}

function deterministicPlan({ kind, canonicalText, lpModel, problem, assumptions }) {
  const method = deterministicMethod(kind, problem);
  const plan = buildRealPlan({ kind, canonicalText, lpModel, method, problem, assumptions });
  return {
    plan,
    plan_source: { kind: 'deterministic-template', template: TEMPLATE_BY_KIND[kind] },
  };
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
    token: options.token !== undefined ? options.token : process.env.FORMAL_WEB_TOKEN || '',
    runsDir: options.runsDir || defaultRunsDir(),
    publicDir: options.publicDir || path.join(__dirname, 'public'),
    // DeepSeek API key: env by default; explicit '' forces the honest
    // BLOCKED_PROVIDER path (tests); explicit string injects a key (tests).
    deepseekApiKey: options.deepseekApiKey !== undefined ? options.deepseekApiKey : process.env.DEEPSEEK_API_KEY,
    // NL lane provider (i180/R3). Default: the REAL DeepSeek NL provider built
    // from the env key (makeNlModelProvider). Test-only seam: a deterministic
    // generate(payload) function or {generate, model} object injected here is
    // passed straight to proposeConstraintModel as its provider — used by the
    // offline web tests; never set in production.
    nlProviderImpl: options.nlProviderImpl !== undefined ? options.nlProviderImpl : null,
    // Environment handed to the executor (preflight + child env). Tests force
    // FORMAL_PORTABLE_ROOT:'' so the fail-closed path is deterministic everywhere.
    executorEnv: options.executorEnv !== undefined ? options.executorEnv : process.env,
    // Test-only capture seam: (argv, {cwd, timeoutMs, env}) => capture result,
    // passed straight through to executeWorkflowPlan (the executor's own
    // injection point). When set, the bridge tees FULL step streams so the
    // evidence can carry verified full-stream artifacts alongside the bounded
    // copies. Never set in production: the default executor capture retains
    // only the bounded copies, and the artifacts stay honestly bounded-only.
    executorCaptureImpl: typeof options.executorCaptureImpl === 'function' ? options.executorCaptureImpl : null,
    // Test-only: awaited before a run starts executing (stretches wall time for
    // concurrency-cap coverage; receipts are unaffected and fully real).
    testRunGate: options.testRunGate || null,
  };

  // Fail-closed hardening: anonymous execution must be impossible off-loopback.
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
  const bindHost = String(opts.host);
  if (!LOOPBACK_HOSTS.has(bindHost) && !opts.token) {
    throw new Error(
      `fail-closed: non-loopback bind (host=${bindHost}) requires FORMAL_WEB_TOKEN. ` +
      'Anonymous execution beyond 127.0.0.1/localhost/::1 is disabled: set FORMAL_WEB_TOKEN (bearer auth) or bind the loopback interface.',
    );
  }
  let ensureRunsDirDone = false;
  const ensureRunsDir = async () => {
    if (!ensureRunsDirDone) {
      await fsp.mkdir(opts.runsDir, { recursive: true });
      ensureRunsDirDone = true;
    }
  };

  const runs = new Map(); // run_id -> state
  const activeRuns = new Set();
  // NL approval registry (i180/R3): plan_sha256 -> approved record binding.
  // Populated ONLY by POST /api/nl/approve successes; consumed by POST /api/runs
  // when the client submits an `approval` binding. In-memory by design: a
  // server restart forgets approvals and the next bound run fails closed
  // (NL_APPROVAL_UNKNOWN) instead of silently executing.
  const nlApprovals = new Map();
  // Hashes supplied by a browser are not provenance credentials. Remember the
  // FULL model proposals that THIS server actually returned, so callers
  // cannot forge a provider identity by hashing their own JSON. Bounded FIFO:
  // stale proposals must be re-proposed rather than silently trusted.
  const nlIssuedProposals = new Map();
  const MAX_NL_ISSUED_PROPOSALS = 128;

  function rememberIssuedProposal(proposal) {
    if (proposal?.status !== 'MODEL_PROPOSED' || typeof proposal.proposal_sha256 !== 'string') return;
    const key = proposal.proposal_sha256;
    nlIssuedProposals.delete(key);
    nlIssuedProposals.set(key, { fingerprint: sha256Canonical(proposal), rejected: false });
    while (nlIssuedProposals.size > MAX_NL_ISSUED_PROPOSALS) {
      nlIssuedProposals.delete(nlIssuedProposals.keys().next().value);
    }
  }

  function requireIssuedProposal(proposal) {
    const issued = nlIssuedProposals.get(proposal.proposal_sha256);
    if (!issued) {
      throw new WorkflowError('NL_PROPOSAL_UNKNOWN',
        'the submitted NL proposal was not issued by this server (or has expired); request a fresh proposal');
    }
    if (issued.fingerprint !== sha256Canonical(proposal)) {
      throw new WorkflowError('NL_TAMPERED',
        'the submitted NL proposal differs from the originally issued server proposal');
    }
    if (issued.rejected) {
      throw new WorkflowError('NL_PROPOSAL_REJECTED',
        'this NL proposal was explicitly rejected; request a new proposal to reconsider');
    }
    return issued;
  }

  /** NL provider for proposeConstraintModel (real DeepSeek, or the test seam). */
  const nlProvider = () => (opts.nlProviderImpl !== null
    ? opts.nlProviderImpl
    : 'deepseek');

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

  // Real engine error -> honest HTTP mapping.
  function engineError(res, err) {
    if (err instanceof WorkflowError) {
      // BLOCKED_PROVIDER is an honest 4xx; provider transport failures are 502.
      const status = err.code === 'PROVIDER_FAILED' ? 502 : 422;
      return sendError(res, status, err.code, `fail-closed: ${err.message}`, err.details ? err.details : undefined);
    }
    if (err instanceof WorkflowPlanError) {
      return sendError(res, 422, err.code, `fail-closed: ${err.message}`);
    }
    return sendError(res, 500, 'ENGINE_ERROR', `internal engine error: ${err.message}`);
  }

  /** Receipt step records -> bounded display streams for the run view. */
  function streamsFromReceipt(receipt) {
    const streams = {};
    for (const s of receipt.steps) {
      const stdout = typeof s.stdout_bounded === 'string' ? s.stdout_bounded : '';
      const stderr = typeof s.stderr_bounded === 'string' ? s.stderr_bounded : '';
      if (stdout || stderr) streams[s.step_id] = { stdout, stderr };
    }
    return streams;
  }

  /**
   * Test-seam capture wrapper: mirrors the executor's exact stream semantics
   * (String(p?.stdout ?? '')) and tees the FULL solve-step streams, keyed
   * "<step_id>:<part>". Step runs are identifiable by argv[1] === 'input.smt2'
   * with cwd === <workspace>/steps/<step_id>; version probes ('--version') are
   * not streams of record and are not teed.
   */
  function makeTeeingCapture(impl, teed) {
    return async (argv, runOpts) => {
      const result = await impl(argv, runOpts);
      if (Array.isArray(argv) && argv[1] === 'input.smt2' && runOpts && typeof runOpts.cwd === 'string') {
        const stepId = path.basename(runOpts.cwd);
        if (/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(stepId)) {
          teed.set(`${stepId}:stdout`, String(result?.stdout ?? ''));
          teed.set(`${stepId}:stderr`, String(result?.stderr ?? ''));
        }
      }
      return result;
    };
  }

  function startRun(plan, approvalBinding = null) {
    const runId = `run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const state = {
      runId,
      plan,
      status: 'running',
      createdAt: new Date().toISOString(),
      receipt: null,
      streams: {},
      workspaceDir: null,
      approvalBinding,
    };
    runs.set(runId, state);
    activeRuns.add(runId);

    (async () => {
      if (opts.testRunGate) await opts.testRunGate();
      // Per-run tee for retained full streams (empty unless the test seam is set).
      const teedFullStreams = new Map();
      const captureImpl = opts.executorCaptureImpl ? makeTeeingCapture(opts.executorCaptureImpl, teedFullStreams) : null;
      let outcome;
      try {
        const { receipt, workspaceDir } = await executeWorkflowPlan(plan, {
          runId,
          sourceSha: plan.source.problem_sha256,
          host: '127.0.0.1',
          env: opts.executorEnv,
          ...(captureImpl ? { captureImpl } : {}),
        });
        outcome = { receipt, workspaceDir };
      } catch (err) {
        if (err instanceof WorkflowBlockedError && err.receipt) {
          // Honest fail-closed result (e.g. trusted bundle absent): the executor
          // produced a REAL ABORTED receipt before any step ran. Return it as-is.
          outcome = { receipt: err.receipt, workspaceDir: err.workspaceDir, blocked: err.code };
        } else {
          state.status = 'aborted';
          state.error = `engine error: ${err.message}`;
          return;
        }
      }
      state.receipt = outcome.receipt;
      state.streams = streamsFromReceipt(outcome.receipt);
      state.workspaceDir = outcome.workspaceDir;
      try {
        await ensureRunsDir();
        await persistRunEvidence(path.join(opts.runsDir, runId), outcome.receipt, teedFullStreams);
      } catch (err) {
        console.error(`[formal-web] failed to persist run ${runId}: ${err.message}`);
      }
      state.status = 'complete';
    })()
      .catch((err) => {
        state.status = 'aborted';
        state.error = `internal error: ${err.message}`;
      })
      .finally(() => {
        activeRuns.delete(runId);
        // The executor workspace (tmp) is no longer needed; its artifacts live
        // under the runs dir. Best-effort cleanup.
        if (state.workspaceDir) {
          fsp.rm(state.workspaceDir, { recursive: true, force: true }).catch(() => {});
        }
      });

    return state;
  }

  function runSummaryView(state) {
    const stepStates = {};
    if (state.receipt) {
      for (const s of state.receipt.steps) stepStates[s.step_id] = s.status;
    } else {
      for (const s of state.plan.steps) stepStates[s.id] = 'queued';
    }
    return {
      run_id: state.runId,
      plan_id: state.plan.plan_id,
      status: state.status,
      created_at: state.createdAt,
      engine: 'workflow-v2+v3',
      nl_approval_binding: state.approvalBinding ? {
        plan_sha256: state.approvalBinding.plan_sha256,
        approved_sha256: state.approvalBinding.approved_sha256,
        verified: true,
      } : null,
      plan_summary: {
        steps: state.plan.steps.map((s) => ({ id: s.id, tool: s.tool, operation: s.operation, depends_on: s.depends_on, timeout_s: s.timeout_s })),
      },
      step_states: stepStates,
      receipt: state.receipt,
      streams: state.streams,
    };
  }

  async function handleApi(req, res, pathname, query) {
    if (pathname === '/api/meta') {
      if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'use GET /api/meta.');
      return sendJson(res, 200, {
        mode: opts.token ? 'token-auth' : 'local-only',
        mocked_contracts: false,
        engine: {
          kind: 'workflow-engine-v2-v3',
          real: true,
          planner: 'packages/runner/js/workflow-plan.mjs (V2: normalizeUserProblem + buildExecutionPlan) + workflow-compiler.mjs (compilePlan)',
          executor: 'packages/runner/js/workflow-executor.mjs (V3: executeWorkflowPlan, fail-closed preflight)',
          note: 'Solver binaries live on the trusted tool host only. Without the portable bundle (FORMAL_PORTABLE_ROOT) a run fails closed before any step: the receipt is ABORTED with fail_closed_reason=BLOCKED_TOOL_MISSING. Nothing is simulated.',
        },
        provider: {
          deepseek: { configured: typeof opts.deepseekApiKey === 'string' && opts.deepseekApiKey.length > 0, model: 'deepseek-chat' },
        },
        nl_lane: {
          module: 'packages/runner/js/nl-model.mjs',
          propose: 'POST /api/nl/propose {text} -> {proposal: MODEL_PROPOSED | NEEDS_CLARIFICATION | UNKNOWN, warnings}',
          revise: 'POST /api/nl/revise {proposal, edited} -> {preview} (server re-validation + re-render; hashes unchanged)',
          approve: 'POST /api/nl/approve {proposal, approved, edited?, lpRelaxationAcknowledged?: true} -> USER_REJECTED | UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION (restricted record, plan:null) | {plan, plan_sha256, approval, relaxation}',
          execution_binding: 'POST /api/runs accepts {plan, approval:{plan_sha256, approved_sha256}}; the plan sha must match a real approval of this process or the run is refused (NL_APPROVAL_UNKNOWN / NL_PLAN_APPROVAL_MISMATCH)',
          lp_relaxation_disclosure: NL_LP_RELAXATION_ASSUMPTION,
          provider: opts.nlProviderImpl !== null ? 'injected (test seam)' : 'deepseek via makeNlModelProvider (env key, header-only)',
          provider_configured: opts.nlProviderImpl !== null || (typeof opts.deepseekApiKey === 'string' && opts.deepseekApiKey.length > 0),
        },
        versions: { bridge: '0.7.0', engine: 'workflow-v2+v3', plan_schema: PLAN_SCHEMA, receipt_schema: RECEIPT_SCHEMA },
        caps: {
          body_limit_bytes: opts.bodyLimitBytes,
          max_concurrent_runs: opts.maxConcurrentRuns,
          run_wall_clock_s: BRIDGE_MAX_TOTAL_TIMEOUT_S,
          max_plan_steps: BRIDGE_MAX_STEPS,
          max_step_timeout_s: 120,
        },
        evidence: {
          stream_cap_bytes: BOUNDED_BYTES,
          full_stream_hashes: 'receipt steps[].stdout_sha256/stderr_sha256 hash the FULL captured streams',
          artifacts: 'manifest labels each artifact scope "full-stream" (verified against the receipt hash) or "bounded-copy" (display excerpt with its own sha256)',
          identity_claim: 'bounded_matches_full_stream is true only when verified or provable (< cap); null means never claimed',
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
        return sendError(res, 422, 'MISSING_PROBLEM', 'fail-closed: body must be {problem_text: string, assumptions?: string[], provider?: "deepseek"}.');
      }
      if (body.provider !== undefined && body.provider !== 'deepseek') {
        return sendError(res, 422, 'INVALID_PROVIDER', 'fail-closed: provider, when present, must be "deepseek" (omit for the deterministic template).');
      }
      let assumptions;
      try {
        assumptions = sanitizeAssumptions(body.assumptions);
      } catch (err) {
        return sendError(res, err.status, err.code, err.message);
      }
      try {
        const detected = detectProblemKind(body.problem_text);
        const normalized = normalizeUserProblem(detected.canonicalText, {
          assumptions: assumptions.length ? assumptions : DEFAULT_ASSUMPTIONS[detected.kind],
          problemKind: detected.kind,
          capabilityIds: CAPABILITY_BY_KIND[detected.kind],
        });
        const useProvider = body.provider === 'deepseek';
        if (useProvider && !(typeof opts.deepseekApiKey === 'string' && opts.deepseekApiKey.length > 0)) {
          return sendError(res, 422, 'BLOCKED_PROVIDER', 'fail-closed: provider "deepseek" requested but DEEPSEEK_API_KEY is not set on this machine; no plan is produced.');
        }
        const result = useProvider
          ? await planWithProvider(detected.kind, detected.canonicalText, detected.lpModel, normalized.problem, normalized.assumptions, opts.deepseekApiKey)
          : deterministicPlan({ kind: detected.kind, canonicalText: detected.canonicalText, lpModel: detected.lpModel, problem: normalized.problem, assumptions: normalized.assumptions });
        return sendJson(res, 200, result);
      } catch (err) {
        if (err.failClosed) return sendError(res, err.status, err.code, err.message, err.extra);
        return engineError(res, err);
      }
    }

    // ------------------------------------------------------------------
    // NL lane (i180/R3): propose / revise / approve. All routes fail closed;
    // a WorkflowError from nl-model.mjs maps through engineError (422, or 502
    // for PROVIDER_FAILED transport failures). No endpoint here ever returns
    // or accepts an API key, and nothing on this lane executes by itself:
    // execution happens only through the existing restricted POST /api/runs,
    // which additionally verifies the approval hash binding when present.
    // ------------------------------------------------------------------

    if (pathname === '/api/nl/propose') {
      if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'use POST /api/nl/propose.');
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err.code === 'BODY_TOO_LARGE') return sendError(res, 413, 'BODY_TOO_LARGE', 'fail-closed: request body exceeds the 1MB cap.');
        return sendError(res, 400, 'BAD_JSON', 'fail-closed: request body is not valid JSON.');
      }
      if (!body || typeof body !== 'object' || typeof body.text !== 'string' || body.text.trim().length === 0) {
        return sendError(res, 422, 'NL_TEXT_INVALID', 'fail-closed: body must be {text: string} — the natural-language problem text (<= 8 KiB after canonicalization).');
      }
      // Honest provider naming + fail-closed key handling: the production path
      // passes the provider string "deepseek" so the proposal provenance names
      // the REAL provider ({name:"deepseek", model:"deepseek-chat"}); with no
      // key configured the request is refused here, before any provider is
      // built. Only the explicit test seam (nlProviderImpl) may inject a
      // deterministic provider.
      if (opts.nlProviderImpl === null && !(typeof opts.deepseekApiKey === 'string' && opts.deepseekApiKey.length > 0)) {
        return sendError(res, 422, 'BLOCKED_PROVIDER', 'fail-closed: DEEPSEEK_API_KEY is not set on this machine; no model proposal is made.');
      }
      try {
        // The reply is an UNTRUSTED translation proposal: MODEL_PROPOSED |
        // NEEDS_CLARIFICATION | UNKNOWN — never executed here, never
        // auto-approved.
        const proposal = await proposeConstraintModel({ text: body.text, provider: nlProvider() });
        rememberIssuedProposal(proposal);
        return sendJson(res, 200, { proposal, warnings: nlServerWarnings(proposal?.model?.question) });
      } catch (err) {
        return engineError(res, err);
      }
    }

    if (pathname === '/api/nl/revise') {
      if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'use POST /api/nl/revise.');
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err.code === 'BODY_TOO_LARGE') return sendError(res, 413, 'BODY_TOO_LARGE', 'fail-closed: request body exceeds the 1MB cap.');
        return sendError(res, 400, 'BAD_JSON', 'fail-closed: request body is not valid JSON.');
      }
      const { proposal, edited } = body && typeof body === 'object' ? body : {};
      if (!proposal || typeof proposal !== 'object' || proposal.schema !== 'formal-tools/nl-model-proposal/0.1') {
        return sendError(res, 422, 'NL_PROPOSAL_INVALID', 'fail-closed: body must be {proposal: <proposeConstraintModel result>, edited: <structured model>}.');
      }
      try {
        // The browser-carried proposal is untrusted: status gate first (only
        // MODEL_PROPOSED has an editable model — NEEDS_CLARIFICATION is a dead
        // end), then verify the hash, then re-validate + re-render the EDITED
        // model. This endpoint only produces a PREVIEW for review — hashes are
        // unchanged; the edit itself is bound into the approval hash by
        // POST /api/nl/approve (decision.edited).
        if (proposal.status !== 'MODEL_PROPOSED' || !proposal.model) {
          throw new WorkflowError('NL_NOT_APPROVABLE', 'only MODEL_PROPOSED proposals have an editable model', { status: proposal.status ?? null });
        }
        assertProposalIntegrity(proposal);
        requireIssuedProposal(proposal);
        if (edited === undefined || edited === null || typeof edited !== 'object') {
          throw new WorkflowError('NL_MODEL_INVALID', 'edited structured model required', { issues: ['edited_missing'] });
        }
        const model = validateStructuredModel(edited);
        const rendering = renderSmtArtifact(model, 'plan');
        let lpModel = null;
        let lpRenderError = null;
        if (model.question === 'optimize') {
          try {
            lpModel = renderLpModel(model);
          } catch (e) {
            lpRenderError = e instanceof WorkflowError ? { code: e.code, message: e.message } : { code: 'NL_RENDER_INVALID', message: String(e && e.message || e) };
          }
        }
        return sendJson(res, 200, {
          preview: {
            model,
            rendering,
            ...(model.question === 'optimize' ? { lp_model: lpModel, lp_render_error: lpRenderError } : {}),
          },
          warnings: nlServerWarnings(model.question),
          note: 'preview only: re-validated and re-rendered server-side; the proposal hashes are unchanged and the edit is bound into the approval hash at approve time',
        });
      } catch (err) {
        return engineError(res, err);
      }
    }

    if (pathname === '/api/nl/approve') {
      if (req.method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'use POST /api/nl/approve.');
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err.code === 'BODY_TOO_LARGE') return sendError(res, 413, 'BODY_TOO_LARGE', 'fail-closed: request body exceeds the 1MB cap.');
        return sendError(res, 400, 'BAD_JSON', 'fail-closed: request body is not valid JSON.');
      }
      const { proposal, approved, edited, reviewer, note, lpRelaxationAcknowledged } = body && typeof body === 'object' ? body : {};
      if (!proposal || typeof proposal !== 'object' || proposal.schema !== 'formal-tools/nl-model-proposal/0.1' || typeof approved !== 'boolean') {
        return sendError(res, 422, 'NL_APPROVAL_INVALID', 'fail-closed: body must be {proposal: <proposeConstraintModel result>, approved: boolean, edited?: <structured model>, reviewer?: string, note?: string, lpRelaxationAcknowledged?: true}.');
      }
      try {
        // A client-generated SHA verifies internal bytes, NOT that the LLM
        // provider or this bridge actually issued the proposal.
        if (proposal.status === 'MODEL_PROPOSED') {
          assertProposalIntegrity(proposal);
          requireIssuedProposal(proposal);
        }
        const decision = { approved };
        if (edited !== undefined) decision.edited = edited;
        if (reviewer !== undefined) decision.reviewer = reviewer;
        if (note !== undefined) decision.note = note;
        // R3 LP gate (docs/mvp/NL_MODEL.md §3): passed through verbatim; only a
        // strict true unlocks optimize approvals — anything else lets
        // approveModel return the fail-closed restricted record below.
        if (lpRelaxationAcknowledged === true) decision.lpRelaxationAcknowledged = true;
        const record = approveModel(proposal, decision); // NL_TAMPERED / NL_NOT_APPROVABLE / NL_MODEL_INVALID fail closed
        if (record.status === 'USER_REJECTED') {
          // Rejection is a real terminal decision for this issued proposal,
          // not just a disabled browser button.
          if (proposal.status === 'MODEL_PROPOSED') nlIssuedProposals.get(proposal.proposal_sha256).rejected = true;
          return sendJson(res, 200, { decision: 'USER_REJECTED', record, warnings: [] });
        }
        if (record.status === 'UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION') {
          // Fail-closed restricted result (i180/R3 seam): the optimize model was
          // approved WITHOUT the explicit LP-relaxation acknowledgement. No
          // plan, no approval registered, nothing executable — the response
          // carries the frozen unsupported contract (reason/dropped/remedies)
          // so the UI can render a clear restricted outcome, never a generic
          // error and never a silent relaxation.
          return sendJson(res, 200, {
            decision: record.status,
            record,
            warnings: nlServerWarnings(record.question),
            note: 'restricted record: no plan was produced; re-approve with lpRelaxationAcknowledged:true to explicitly accept the continuous LP relaxation, or wait for an integer MIP adapter',
          });
        }
        const built = buildPlanFromApprovedModel(record); // re-checks approved_sha256 + render drift + ack shape
        const compiled = compilePlan(built.plan); // real compiled hashes, like the direct lane
        const plan = compiled.plan;
        const planSha = sha256Canonical(plan);
        const approval = {
          plan_sha256: planSha,
          approved_sha256: record.approved_sha256,
          proposal_sha256: record.proposal_sha256,
          question: built.question,
          target: built.target,
          created_at: new Date().toISOString(),
        };
        nlApprovals.set(planSha, approval);
        return sendJson(res, 200, {
          decision: 'USER_APPROVED',
          plan,
          plan_sha256: planSha,
          approval,
          question: built.question,
          target: built.target,
          // R3 seam: wrapper relaxation metadata (null for smt; for lp it is the
          // frozen LP_RELAXATION_ONLY contract incl. the hash-covered ack) —
          // the plan itself also carries the canonical JSON assumption string.
          relaxation: built.relaxation,
          warnings: nlServerWarnings(built.question),
          approved: { approved_sha256: record.approved_sha256, review: record.review },
          note: 'the plan embeds the approved model provenance (problem requirement r2); submit it with the approval binding to POST /api/runs',
        });
      } catch (err) {
        return engineError(res, err);
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
      const plan = body && body.plan ? body.plan : body;
      // NL approval binding (i180/R3, additive): when the client submits an
      // approval, the plan's exact sha256 must (a) match the submitted binding
      // and (b) be the product of a real USER_APPROVED record in this process.
      // Anything else is refused BEFORE any validation of the plan proceeds —
      // a tampered or substituted plan can never ride an approval.
      let approvalBinding = null;
      // All NL plans require an actual approval; omitting the optional
      // binding must not bypass the user-review gate.
      if (plan?.source?.problem_kind === 'nl_model' && (body?.approval === undefined || body?.approval === null)) {
        return sendError(res, 422, 'NL_APPROVAL_REQUIRED',
          'fail-closed: NL model execution requires a valid user-approval binding issued by this server.');
      }
      if (body && typeof body === 'object' && body.approval !== undefined && body.approval !== null) {
        const ap = body.approval;
        if (!ap || typeof ap !== 'object' ||
            typeof ap.plan_sha256 !== 'string' || typeof ap.approved_sha256 !== 'string') {
          return sendError(res, 422, 'NL_APPROVAL_INVALID', 'fail-closed: approval must be {plan_sha256, approved_sha256} as returned by POST /api/nl/approve.');
        }
        const actualPlanSha = sha256Canonical(plan);
        const recorded = nlApprovals.get(ap.plan_sha256);
        if (!recorded) {
          return sendError(res, 422, 'NL_APPROVAL_UNKNOWN', `fail-closed: no NL approval is registered in this server for plan sha256 ${ap.plan_sha256.slice(0, 12)}…; the binding is refused and nothing runs.`);
        }
        if (actualPlanSha !== ap.plan_sha256 || recorded.approved_sha256 !== ap.approved_sha256) {
          return sendError(res, 422, 'NL_PLAN_APPROVAL_MISMATCH', `fail-closed: the submitted plan (sha256 ${actualPlanSha.slice(0, 12)}…) does not match the approved plan covered by this approval (${ap.plan_sha256.slice(0, 12)}…) — approval/plan hash binding violated, refusing to execute.`);
        }
        approvalBinding = ap;
      }
      try {
        // Bridge hard caps first (fail-closed, mirror the frozen budget caps)…
        if (!plan || typeof plan !== 'object') throw new WorkflowPlanError('PLAN_SCHEMA_INVALID', 'plan must be a JSON object');
        if (!plan.budgets || typeof plan.budgets !== 'object' ||
            plan.budgets.max_steps !== BRIDGE_MAX_STEPS ||
            plan.budgets.max_total_timeout_s !== BRIDGE_MAX_TOTAL_TIMEOUT_S) {
          throw new WorkflowPlanError('PLAN_BUDGET_EXCEEDED', `bridge hard caps: budgets must be max_steps=${BRIDGE_MAX_STEPS}, max_total_timeout_s=${BRIDGE_MAX_TOTAL_TIMEOUT_S}`);
        }
        // …then the executor's own re-validation (the same gate it applies
        // immediately before executing; identical codes).
        validateExecutorPlan(plan);
      } catch (err) {
        if (err instanceof WorkflowPlanError) return sendError(res, 422, err.code, `fail-closed: ${err.message}`);
        return sendError(res, 500, 'VALIDATOR_ERROR', `internal error: ${err.message}`);
      }
      if (activeRuns.size >= opts.maxConcurrentRuns) {
        return sendError(res, 429, 'CONCURRENCY_LIMIT', `fail-closed: max ${opts.maxConcurrentRuns} concurrent runs; wait for a run to finish.`);
      }
      const state = startRun(plan, approvalBinding);
      return sendJson(res, 200, { run_id: state.runId, status: state.status, poll: `/api/runs/${state.runId}` });
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
      const runId = m[1];
      const state = runs.get(runId);
      if (!state) return sendError(res, 404, 'RUN_NOT_FOUND', `fail-closed: no run with id "${runId}".`);
      if (state.status === 'running') {
        return sendError(res, 409, 'RUN_STILL_RUNNING', 'fail-closed: evidence is available once the run completes.');
      }
      if (!state.receipt) {
        return sendError(res, 404, 'NO_RECEIPT', `fail-closed: run "${runId}" produced no receipt (${state.error || 'engine error'}).`);
      }
      const part = query.get('part');
      const stepId = query.get('step');
      const runDir = path.join(opts.runsDir, runId);

      if (part === 'manifest') {
        const bytes = await fsp.readFile(path.join(runDir, 'manifest.json'), 'utf8').catch(() => null);
        if (bytes === null) return sendError(res, 404, 'ARTIFACT_NOT_FOUND', 'fail-closed: manifest.json was not persisted for this run.');
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(bytes),
          'Content-Disposition': `attachment; filename="manifest-${runId}.json"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        return res.end(bytes);
      }

      if (part || stepId) {
        if (!part || !['stdout', 'stderr'].includes(part) || !stepId) {
          return sendError(res, 422, 'EVIDENCE_PART_INVALID', 'fail-closed: per-stream evidence needs ?part=stdout|stderr&step=<step_id>[&scope=full|bounded] (or ?part=manifest).');
        }
        const scope = query.get('scope');
        if (scope !== null && scope !== 'full' && scope !== 'bounded') {
          return sendError(res, 422, 'EVIDENCE_SCOPE_INVALID', 'fail-closed: scope, when present, must be "full" (verified full-stream bytes) or "bounded" (the <=4096-byte display copy).');
        }
        const step = state.receipt.steps.find((s) => s.step_id === stepId);
        const fullStreamSha = step ? (part === 'stdout' ? step.stdout_sha256 : step.stderr_sha256) : null;
        const wantFull = scope === null || scope === 'full'; // default prefers full when verified bytes exist
        const wantBounded = scope === null || scope === 'bounded';
        const readArtifact = async (rel) => fsp.readFile(path.join(runDir, rel)).catch(() => null);

        let served = null; // { bytes, rel, scopeLabel, filename }
        if (wantFull) {
          const bytes = await readArtifact(path.join('logs', `${stepId}.${part}.txt`));
          if (bytes !== null) {
            served = { bytes, rel: `logs/${stepId}.${part}.txt`, scopeLabel: 'full-stream', filename: `${part}-${runId}-${stepId}.txt` };
          }
        }
        if (served === null && wantBounded) {
          const bytes = await readArtifact(path.join('logs', `${stepId}.${part}.bounded.txt`));
          if (bytes !== null) {
            served = { bytes, rel: `logs/${stepId}.${part}.bounded.txt`, scopeLabel: 'bounded-copy', filename: `${part}-${runId}-${stepId}.bounded.txt` };
          }
        }
        if (served === null) {
          if (!step) return sendError(res, 404, 'STEP_NOT_FOUND', `fail-closed: no step "${stepId}" in run.`);
          if (scope === 'full' &&
              (await readArtifact(path.join('logs', `${stepId}.${part}.bounded.txt`))) !== null) {
            return sendError(res, 404, 'ARTIFACT_NOT_FOUND',
              `fail-closed: full ${part} bytes were not retained for step "${stepId}" on this host; ` +
              `only the bounded <=${BOUNDED_BYTES}-byte display copy exists (scope=bounded). ` +
              `The receipt's ${part}_sha256 (${fullStreamSha || 'unavailable'}) hashes the full stream.`);
          }
          return sendError(res, 404, 'ARTIFACT_NOT_FOUND', `fail-closed: step "${stepId}" never produced a ${part} stream on this host (status ${step.status}); no log artifact exists.`);
        }
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': served.bytes.length,
          'Content-Disposition': `attachment; filename="${served.filename}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
          'X-Formal-Evidence-Scope': served.scopeLabel,
          // The receipt's hash over the FULL captured stream — authoritative and
          // distinct from the served artifact's own bytes when scope is bounded-copy.
          'X-Formal-Full-Stream-Sha256': fullStreamSha || 'unavailable',
        });
        return res.end(served.bytes);
      }

      // full receipt: the real persisted receipt.json bytes
      const bytes = await fsp.readFile(path.join(runDir, 'receipt.json'), 'utf8').catch(() => null);
      if (bytes === null) return sendError(res, 404, 'ARTIFACT_NOT_FOUND', 'fail-closed: receipt.json was not persisted for this run.');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(bytes),
        'Content-Disposition': `attachment; filename="receipt-${runId}.json"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      return res.end(bytes);
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
      const line = `FORMAL_WEB_LISTENING host=${opts.host} port=${addr.port} mode=${opts.token ? 'token-auth' : 'local-only'} engine=workflow-v2+v3`;
      console.log(line);
      resolve({ server, port: addr.port, opts, runs, activeRuns });
    });
  });
}

// main entry
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 8788);
  const host = process.env.HOST || '127.0.0.1'; // non-loopback HOST requires FORMAL_WEB_TOKEN (fail-closed in startServer)
  startServer({ host, port }).then(({ port: actual }) => {
    console.log(`[formal-web] UI: http://127.0.0.1:${actual}/  (engine=workflow-v2+v3, mocked_contracts=false)`);
  });
}
