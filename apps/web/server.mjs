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
//   * binds 127.0.0.1 by default; optional bearer token via FORMAL_WEB_TOKEN
//   * request bodies are capped (413 over the limit); plans are re-validated by the
//     executor's own validator plus bridge hard caps (422 fail-closed)
//   * max 2 concurrent runs, per-run wall clock <= 120s (budgets), plan steps <= 8
//   * this file imports no child_process and spawns nothing; the only process launch
//     path lives inside the V3 executor (spawn argv with shell:false) and is
//     unreachable without the trusted bundle; fs writes go only to the runs directory
//     (per-run receipts/artifacts) and the executor's own temp workspace is removed
//     after each run
//   * no CORS headers at all (same-origin only)

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
} from '../../packages/runner/js/workflow-plan.mjs';
import { proposeMethod } from '../../packages/runner/js/method-planner.mjs';
import { compilePlan } from '../../packages/runner/js/workflow-compiler.mjs';
import {
  executeWorkflowPlan,
  validateExecutionPlan as validateExecutorPlan,
  WorkflowBlockedError,
  WorkflowPlanError,
} from '../../packages/runner/js/workflow-executor.mjs';
import { writeExecutionReceiptArtifacts } from '../../packages/runner/js/workflow-evidence.mjs';

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

function defaultRunsDir() {
  return path.join(REPO_ROOT, 'apps', 'web-tests', '.runs');
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
    // Environment handed to the executor (preflight + child env). Tests force
    // FORMAL_PORTABLE_ROOT:'' so the fail-closed path is deterministic everywhere.
    executorEnv: options.executorEnv !== undefined ? options.executorEnv : process.env,
    // Test-only: awaited before a run starts executing (stretches wall time for
    // concurrency-cap coverage; receipts are unaffected and fully real).
    testRunGate: options.testRunGate || null,
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

  // Real engine error -> honest HTTP mapping.
  function engineError(res, err) {
    if (err instanceof WorkflowError) {
      // BLOCKED_PROVIDER is an honest 4xx; provider transport failures are 502.
      const status = err.code === 'PROVIDER_FAILED' ? 502 : 422;
      return sendError(res, status, err.code, `fail-closed: ${err.message}`, err.details ? { details: err.details } : undefined);
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

  /** Persist the real receipt + hash-bound artifacts under the runs dir. */
  async function persistRunArtifacts(runId, receipt) {
    await ensureRunsDir();
    const dir = path.join(opts.runsDir, runId);
    const rawStreams = [];
    for (const s of receipt.steps) {
      const stdout = typeof s.stdout_bounded === 'string' ? s.stdout_bounded : '';
      const stderr = typeof s.stderr_bounded === 'string' ? s.stderr_bounded : '';
      if (stdout || stderr) rawStreams.push({ step_id: s.step_id, stdout, stderr });
    }
    // Re-derives receipt.json + manifest.json + logs/* with verified hashes
    // (identical bytes to the executor's own workspace artifacts).
    return writeExecutionReceiptArtifacts(dir, receipt, rawStreams);
  }

  function startRun(plan) {
    const runId = `run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const state = {
      runId,
      plan,
      status: 'running',
      createdAt: new Date().toISOString(),
      receipt: null,
      streams: {},
      workspaceDir: null,
    };
    runs.set(runId, state);
    activeRuns.add(runId);

    (async () => {
      if (opts.testRunGate) await opts.testRunGate();
      let outcome;
      try {
        const { receipt, workspaceDir } = await executeWorkflowPlan(plan, {
          runId,
          sourceSha: plan.source.problem_sha256,
          host: '127.0.0.1',
          env: opts.executorEnv,
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
        await persistRunArtifacts(runId, outcome.receipt);
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
        versions: { bridge: '0.6.0', engine: 'workflow-v2+v3', plan_schema: PLAN_SCHEMA, receipt_schema: RECEIPT_SCHEMA },
        caps: {
          body_limit_bytes: opts.bodyLimitBytes,
          max_concurrent_runs: opts.maxConcurrentRuns,
          run_wall_clock_s: BRIDGE_MAX_TOTAL_TIMEOUT_S,
          max_plan_steps: BRIDGE_MAX_STEPS,
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

    if (pathname === '/api/runs' && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err.code === 'BODY_TOO_LARGE') return sendError(res, 413, 'BODY_TOO_LARGE', 'fail-closed: request body exceeds the 1MB cap.');
        return sendError(res, 400, 'BAD_JSON', 'fail-closed: request body is not valid JSON.');
      }
      const plan = body && body.plan ? body.plan : body;
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
      const state = startRun(plan);
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
          return sendError(res, 422, 'EVIDENCE_PART_INVALID', 'fail-closed: per-stream evidence needs ?part=stdout|stderr&step=<step_id> (or ?part=manifest).');
        }
        const bytes = await fsp.readFile(path.join(runDir, 'logs', `${stepId}.${part}.txt`), 'utf8').catch(() => null);
        if (bytes === null) {
          const step = state.receipt.steps.find((s) => s.step_id === stepId);
          if (!step) return sendError(res, 404, 'STEP_NOT_FOUND', `fail-closed: no step "${stepId}" in run.`);
          return sendError(res, 404, 'ARTIFACT_NOT_FOUND', `fail-closed: step "${stepId}" never produced a ${part} stream on this host (status ${step.status}); no log artifact exists.`);
        }
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': Buffer.byteLength(bytes),
          'Content-Disposition': `attachment; filename="${part}-${runId}-${stepId}.txt"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        return res.end(bytes);
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
  startServer({ port }).then(({ port: actual }) => {
    console.log(`[formal-web] UI: http://127.0.0.1:${actual}/  (engine=workflow-v2+v3, mocked_contracts=false)`);
  });
}
