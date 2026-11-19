/**
 * Issue #183 V3: typed DAG executor for "formal-tools/execution-plan/1.0".
 *
 * The plan is consumed as validated DATA only: structure, allowlist, canonical
 * input hashes, DAG closure and budgets are re-validated here (defense in
 * depth), never imported from a plan compiler. No shell is ever involved —
 * the only process launch is spawn(argv, {shell:false}) through an injectable
 * capture implementation, and solve-lp steps are delegated to the existing
 * T4 portfolio gateway (its own pinning/validation applies).
 *
 * Verdict layering (never collapsed): process EXIT status, per-step solver
 * answer, cross-tool comparison verdict and the user claim verdict are
 * distinct receipt fields. Contradiction, UNKNOWN, tool absence, malformed
 * output, tampered hashes and timeouts fail closed; exit 0 is never proof.
 */
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir, hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { join, resolve, isAbsolute, basename } from "node:path";
import { runPortfolioOperation } from "./tool-portfolio-t4.mjs";
import {
  canonicalJsonBytes, sha256Hex, boundText, buildExecutionReceipt,
  writeExecutionReceiptArtifacts, BOUNDED_BYTES
} from "./workflow-evidence.mjs";

const PLAN_SCHEMA = "formal-tools/execution-plan/1.0";
const SOLVE_SMT_TOOLS = Object.freeze(["z3","cvc5"]);
const SOLVE_LP_TOOLS = Object.freeze(["highs"]);
const COMPARE_TOOL = "compare";
const TOOL_OPERATIONS = Object.freeze({
  z3: "solve-smt", cvc5: "solve-smt", highs: "solve-lp", [COMPARE_TOOL]: "cross-check"
});
const EXPECTED_OUTPUT_KINDS = Object.freeze({
  "solve-smt": "smt-answer", "solve-lp": "lp-result", "cross-check": "cross-check-verdict"
});
const TIMEOUT_LIMITS = Object.freeze({"solve-smt":[1,120], "solve-lp":[1,30], "cross-check":[1,120]});
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const SMT_ANSWERS = Object.freeze(["sat","unsat","unknown"]);
const LP_MODEL_STATUSES = Object.freeze(["kOptimal","kInfeasible","kUnbounded","kUnboundedOrInfeasible","kTimeLimit"]);
const MAX_SMT_INPUT_BYTES = 65536;
const MAX_CAPTURE_BYTES = 1048576;
const MAX_VERSION_PROBE_TIMEOUT_MS = 10000;
const MAX_STEP_FILES = 64;
const MAX_ARTIFACT_FILE_BYTES = 8388608;
const MAX_ERROR_TEXT = 256;

// Fail-closed reason codes recorded in overall.fail_closed_reason.
const FC = Object.freeze({
  TOOL_MISSING: "BLOCKED_TOOL_MISSING",
  VERSION_PROBE: "BLOCKED_TOOL_VERSION_PROBE",
  STEP_TIMEOUT: "STEP_TIMEOUT",
  PROCESS_ERROR: "STEP_PROCESS_ERROR",
  NONZERO_EXIT: "SOLVER_NONZERO_EXIT",
  UNPARSABLE: "SOLVER_OUTPUT_UNPARSABLE",
  CONTRADICTION: "CROSS_TOOL_CONTRADICTION",
  BUDGET: "BUDGET_WALL_CLOCK_EXCEEDED",
  HIGHS: "HIGHS_ADAPTER_FAIL_CLOSED"
});

export class WorkflowPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkflowPlanError";
    this.code = code;
  }
}
export class WorkflowBlockedError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "WorkflowBlockedError";
    this.code = code;
    this.detail = detail;
    this.receipt = detail?.receipt ?? null;
    this.workspaceDir = detail?.workspaceDir ?? null;
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, names) {
  const keys = Object.keys(value);
  return keys.length === names.length && keys.every(k => names.includes(k));
}
function snapshotEnvironment(env) {
  if (!env || typeof env !== "object" || Array.isArray(env))
    throw new TypeError("child environment must be an object");
  /** @type {Record<string,string>} */
  const snapshot = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || key.includes("\0") || value.includes("\0"))
      throw new TypeError("child environment must contain only NUL-free strings");
    snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}

/** Light structural re-validation of the LP model shape (the authoritative
 * validation happens inside the T4 portfolio gateway at execution time). */
function validateLpInputShape(model) {
  if (!plainObject(model) || !exactKeys(model, ["sense","objective","variables","constraints"]))
    throw new Error("LP model must have exactly sense/objective/variables/constraints");
  if (!["min","max"].includes(model.sense)) throw new Error("LP sense must be min or max");
  const finite = v => typeof v === "number" && Number.isFinite(v);
  const bound = v => v === null || finite(v);
  if (!Array.isArray(model.objective) || model.objective.length < 1 || model.objective.length > 64 ||
      !model.objective.every(finite)) throw new Error("LP objective invalid");
  const n = model.objective.length;
  if (!Array.isArray(model.variables) || model.variables.length !== n) throw new Error("LP variable count mismatch");
  for (const v of model.variables) {
    if (!plainObject(v) || !exactKeys(v, ["lower","upper"]) || !bound(v.lower) || !bound(v.upper) ||
        (v.lower !== null && v.upper !== null && v.lower > v.upper)) throw new Error("LP variable bounds invalid");
  }
  if (!Array.isArray(model.constraints) || model.constraints.length > 128) throw new Error("LP constraints invalid");
  for (const c of model.constraints) {
    if (!plainObject(c) || !exactKeys(c, ["lower","upper","coefficients"]) || !bound(c.lower) || !bound(c.upper) ||
        (c.lower !== null && c.upper !== null && c.lower > c.upper) ||
        !Array.isArray(c.coefficients) || c.coefficients.length !== n || !c.coefficients.every(finite))
      throw new Error("LP constraint invalid");
  }
}

/** Re-validate the plan as data: structure, allowlist, canonical input
 * hashes, DAG closure and budgets. Throws WorkflowPlanError; never executes. */
export function validateExecutionPlan(plan) {
  if (!plainObject(plan)) throw new WorkflowPlanError("PLAN_SCHEMA_INVALID", "plan must be a plain object");
  if (plan.schema !== PLAN_SCHEMA)
    throw new WorkflowPlanError("PLAN_SCHEMA_INVALID", "plan schema must be " + PLAN_SCHEMA);
  if (typeof plan.plan_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(plan.plan_id))
    throw new WorkflowPlanError("PLAN_ID_INVALID", "invalid plan_id");
  if (!plainObject(plan.source) || !exactKeys(plan.source, ["problem_sha256","problem_kind"]) ||
      typeof plan.source.problem_sha256 !== "string" || !SHA_PATTERN.test(plan.source.problem_sha256) ||
      typeof plan.source.problem_kind !== "string" || !plan.source.problem_kind ||
      plan.source.problem_kind.length > 64)
    throw new WorkflowPlanError("PLAN_SOURCE_INVALID", "invalid plan source block");
  if (!Array.isArray(plan.assumptions) || plan.assumptions.length > 32 ||
      !plan.assumptions.every(a => typeof a === "string" && a.length <= 256))
    throw new WorkflowPlanError("PLAN_ASSUMPTIONS_INVALID", "invalid assumptions");
  if (!Array.isArray(plan.method_dag) || plan.method_dag.length > 64 ||
      !plan.method_dag.every(m => plainObject(m) && typeof m.id === "string" && m.id.length <= 64 &&
        typeof m.kind === "string" && m.kind.length <= 64 && Array.isArray(m.depends_on) &&
        m.depends_on.every(d => typeof d === "string" && d.length <= 64)))
    throw new WorkflowPlanError("PLAN_METHOD_DAG_INVALID", "invalid method_dag");
  if (!plainObject(plan.budgets) || !exactKeys(plan.budgets, ["max_steps","max_total_timeout_s"]) ||
      !Number.isInteger(plan.budgets.max_steps) || plan.budgets.max_steps < 1 || plan.budgets.max_steps > 1024 ||
      !Number.isInteger(plan.budgets.max_total_timeout_s) || plan.budgets.max_total_timeout_s < 1 ||
      plan.budgets.max_total_timeout_s > 86400)
    throw new WorkflowPlanError("PLAN_BUDGETS_INVALID", "invalid budgets");
  if (!plainObject(plan.compiled) || !exactKeys(plan.compiled, ["launcher_sha256","manifest_sha256"]) ||
      !(plan.compiled.launcher_sha256 === null || SHA_PATTERN.test(plan.compiled.launcher_sha256)) ||
      !(plan.compiled.manifest_sha256 === null || SHA_PATTERN.test(plan.compiled.manifest_sha256)))
    throw new WorkflowPlanError("PLAN_COMPILED_INVALID", "invalid compiled block");
  if (!Array.isArray(plan.steps) || plan.steps.length < 1)
    throw new WorkflowPlanError("PLAN_STEPS_INVALID", "plan must contain at least one step");
  if (plan.steps.length > plan.budgets.max_steps)
    throw new WorkflowPlanError("PLAN_BUDGET_EXCEEDED", "step count exceeds budgets.max_steps");

  const ids = new Set();
  for (const step of plan.steps) {
    if (!plainObject(step) || !exactKeys(step, ["id","tool","operation","depends_on","input","input_sha256","timeout_s","expected_output_kind"]))
      throw new WorkflowPlanError("PLAN_STEP_FIELDS_INVALID", "step field set mismatch: " + String(step?.id));
    if (typeof step.id !== "string" || !STEP_ID_PATTERN.test(step.id))
      throw new WorkflowPlanError("PLAN_STEP_ID_INVALID", "invalid step id: " + String(step.id));
    if (ids.has(step.id))
      throw new WorkflowPlanError("PLAN_DUP_STEP", "duplicate step id: " + step.id);
    ids.add(step.id);
  }
  let totalTimeout = 0;
  for (const step of plan.steps) {
    const op = TOOL_OPERATIONS[step.tool];
    if (!op) throw new WorkflowPlanError("PLAN_TOOL_NOT_ALLOWED", "tool not in executor allowlist: " + String(step.tool));
    if (step.operation !== op)
      throw new WorkflowPlanError("PLAN_OPERATION_MISMATCH", "operation " + String(step.operation) + " not admitted for tool " + step.tool);
    if (!Array.isArray(step.depends_on) ||
        step.depends_on.some(d => typeof d !== "string" || !ids.has(d)))
      throw new WorkflowPlanError("PLAN_UNBOUND_DEPENDENCY", "unbound dependency on step " + String(step.id));
    if (step.depends_on.includes(step.id))
      throw new WorkflowPlanError("PLAN_CYCLE", "self dependency on step " + step.id);
    const [lo, hi] = TIMEOUT_LIMITS[step.operation];
    if (!Number.isInteger(step.timeout_s) || step.timeout_s < lo || step.timeout_s > hi)
      throw new WorkflowPlanError("PLAN_TIMEOUT_INVALID", "timeout_s out of admitted range for " + step.operation);
    totalTimeout += step.timeout_s;
    if (step.expected_output_kind !== EXPECTED_OUTPUT_KINDS[step.operation])
      throw new WorkflowPlanError("PLAN_EXPECTED_KIND_INVALID", "unexpected output kind on step " + step.id);
    if (typeof step.input_sha256 !== "string" || !SHA_PATTERN.test(step.input_sha256))
      throw new WorkflowPlanError("PLAN_HASH_MISMATCH", "input_sha256 must be 64-hex on step " + step.id);
    if (step.operation === "solve-smt") {
      if (!plainObject(step.input) || !exactKeys(step.input, ["smt_lib"]) ||
          typeof step.input.smt_lib !== "string" || step.input.smt_lib.length === 0 ||
          Buffer.byteLength(step.input.smt_lib, "utf8") > MAX_SMT_INPUT_BYTES)
        throw new WorkflowPlanError("PLAN_INPUT_INVALID", "solve-smt input must be {smt_lib} within " + MAX_SMT_INPUT_BYTES + " bytes");
    } else if (step.operation === "solve-lp") {
      try { validateLpInputShape(step.input); }
      catch (e) { throw new WorkflowPlanError("PLAN_INPUT_INVALID", "solve-lp input invalid: " + e.message); }
    } else if (step.operation === "cross-check") {
      if (!plainObject(step.input) || !exactKeys(step.input, ["left_step","right_step","agree_on"]) ||
          typeof step.input.left_step !== "string" || typeof step.input.right_step !== "string" ||
          step.input.agree_on !== "answer")
        throw new WorkflowPlanError("PLAN_INPUT_INVALID", 'cross-check input must be {left_step, right_step, agree_on:"answer"}');
    }
    let inputHash;
    try { inputHash = sha256Hex(canonicalJsonBytes(step.input)); }
    catch { throw new WorkflowPlanError("PLAN_INPUT_INVALID", "input is not canonicalizable JSON on step " + step.id); }
    if (inputHash !== step.input_sha256)
      throw new WorkflowPlanError("PLAN_HASH_MISMATCH", "input_sha256 mismatch on step " + step.id);
  }
  if (totalTimeout > plan.budgets.max_total_timeout_s)
    throw new WorkflowPlanError("PLAN_BUDGET_EXCEEDED", "sum of step timeouts exceeds budgets.max_total_timeout_s");

  const byId = new Map(plan.steps.map(s => [s.id, s]));
  for (const step of plan.steps) {
    if (step.operation !== "cross-check") continue;
    for (const side of ["left_step","right_step"]) {
      const target = byId.get(step.input[side]);
      if (!target || target.id === step.id || !["solve-smt","solve-lp"].includes(target.operation))
        throw new WorkflowPlanError("PLAN_COMPARE_INVALID", "cross-check " + side + " must reference a solve step: " + step.id);
      if (!step.depends_on.includes(target.id))
        throw new WorkflowPlanError("PLAN_COMPARE_INVALID", "cross-check must depend on " + side + ": " + step.id);
    }
  }

  // Kahn topological sort, stable by original plan order.
  const indegree = new Map(plan.steps.map(s => [s.id, 0]));
  const dependents = new Map(plan.steps.map(s => [s.id, []]));
  for (const step of plan.steps) {
    for (const dep of new Set(step.depends_on)) {
      indegree.set(step.id, indegree.get(step.id) + 1);
      dependents.get(dep).push(step.id);
    }
  }
  const orderedSteps = [];
  const ready = plan.steps.filter(s => indegree.get(s.id) === 0).map(s => s.id);
  while (ready.length) {
    const id = ready.shift();
    orderedSteps.push(byId.get(id));
    for (const next of dependents.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (orderedSteps.length !== plan.steps.length)
    throw new WorkflowPlanError("PLAN_CYCLE", "plan dependency graph contains a cycle");

  return {
    orderedSteps,
    plan_sha256: sha256Hex(canonicalJsonBytes(plan)),
    budgets: {...plan.budgets}
  };
}

/** Injectable-free default process runner: spawn argv with shell:false,
 * bounded capture, SIGKILL on timeout (process group on Linux). */
async function defaultCapture(argv, {cwd, timeoutMs, env}) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.some(a => typeof a !== "string" || a.includes("\0")))
    throw new TypeError("invalid argv");
  return await new Promise(done => {
    let stdout = [], stderr = [], bytes = 0, timedOut = false, overLimit = false, error = null, settled = false;
    const start = Date.now();
    let timer;
    const child = spawn(argv[0], argv.slice(1), {
      cwd, shell: false, stdio: ["ignore","pipe","pipe"], env,
      detached: process.platform === "linux"
    });
    const kill = () => { try {
      if (child.pid && process.platform === "linux") process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {} };
    const push = (parts, b) => {
      bytes += b.length;
      if (bytes > MAX_CAPTURE_BYTES) { overLimit = true; kill(); }
      else parts.push(b);
    };
    child.stdout?.on("data", b => push(stdout, b));
    child.stderr?.on("data", b => push(stderr, b));
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({
        exit_code: code, signal, timed_out: timedOut, output_limit: overLimit,
        elapsed_ms: Date.now() - start, error: error === null ? null : String(error.message ?? error),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    };
    child.on("error", e => { error = e; finish(null, null); });
    child.on("close", finish);
    timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  });
}

async function pathExists(path, wantFile) {
  try {
    const s = await stat(path);
    return wantFile ? s.isFile() : s.isDirectory();
  } catch { return false; }
}

function makeRecord(step, fields = {}) {
  return {
    step_id: step.id,
    tool: step.tool,
    operation: step.operation,
    status: "NOT_RUN",
    exit_code: null,
    elapsed_ms: null,
    stdout_sha256: null,
    stderr_sha256: null,
    stdout_bounded: null,
    stderr_bounded: null,
    result: null,
    artifacts: [],
    ...fields
  };
}

function smtAnswerFromStdout(stdout) {
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const token = line.trim();
    if (SMT_ANSWERS.includes(token)) return token;
  }
  return null;
}

function lpModelStatusToAnswer(status) {
  if (status === "kOptimal") return "sat";
  if (status === "kInfeasible") return "unsat";
  return "unknown";
}

function sideAnswer(record) {
  if (!record || record.status !== "EXECUTED" || !plainObject(record.result)) return null;
  if (record.operation === "solve-smt")
    return SMT_ANSWERS.includes(record.result.answer) ? record.result.answer : null;
  if (record.operation === "solve-lp")
    return LP_MODEL_STATUSES.includes(record.result.model_status)
      ? lpModelStatusToAnswer(record.result.model_status) : null;
  return null;
}

async function collectStepArtifacts(workspace, stepDir) {
  const rel = "steps/" + basename(stepDir);
  const entries = await readdir(stepDir, {withFileTypes: true});
  const names = entries.filter(e => e.isFile()).map(e => e.name).sort();
  const artifacts = [];
  for (const name of names.slice(0, MAX_STEP_FILES)) {
    const full = join(stepDir, name);
    const s = await stat(full);
    const sha256 = s.size <= MAX_ARTIFACT_FILE_BYTES ? sha256Hex(await readFile(full)) : null;
    artifacts.push({name: rel + "/" + name, sha256, bytes: s.size});
  }
  return artifacts;
}

function truncateError(text) {
  return String(text ?? "unknown failure").slice(0, MAX_ERROR_TEXT);
}

/**
 * Execute a validated-or-raw execution plan. Throws WorkflowPlanError for
 * plan-level re-validation failures (nothing runs, nothing is written) and
 * WorkflowBlockedError (with an ABORTED receipt attached) when the preflight
 * cannot guarantee every tool named by the plan. Otherwise runs the DAG in
 * topological order and returns {receipt, workspaceDir}.
 *
 * options: {captureImpl?, solveLpImpl?, workspaceDir?, sourceSha?, env?,
 *           now?, runId?, host?} — captureImpl: (argv,{cwd,timeoutMs,env}) =>
 * {exit_code, signal, timed_out, output_limit, error, stdout, stderr}.
 */
export async function executeWorkflowPlan(plan, options = {}) {
  if (!plainObject(options)) throw new TypeError("options must be a plain object");
  const {
    captureImpl = null, solveLpImpl = null, workspaceDir = null, sourceSha = null,
    env = process.env, now = null, runId = null, host = null
  } = options;
  for (const [name, value] of [["captureImpl", captureImpl], ["solveLpImpl", solveLpImpl]]) {
    if (value !== null && typeof value !== "function")
      throw new TypeError(name + " must be a function or null");
  }
  if (workspaceDir !== null && (typeof workspaceDir !== "string" || !workspaceDir))
    throw new TypeError("workspaceDir must be a non-empty string or null");
  if (sourceSha !== null && (typeof sourceSha !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sourceSha)))
    throw new TypeError("sourceSha must be null, a 40-hex git commit SHA, or a 64-hex sha256");
  if (runId !== null && (typeof runId !== "string" || !ID_PATTERN.test(runId)))
    throw new TypeError("runId must match " + ID_PATTERN);
  if (host !== null && (typeof host !== "string" || !host || host.length > 255))
    throw new TypeError("host must be a non-empty string or null");
  const runIdFinal = runId ?? ("run-" + Date.now().toString(36) + "-" + randomUUID().replace(/-/g,"").slice(0,8));
  const environment = snapshotEnvironment(env);
  const runStart = now === null ? Date.now()
    : typeof now === "function" ? Number(now()) : Number(now);
  if (!Number.isFinite(runStart) || runStart < 0) throw new TypeError("now must yield a finite non-negative ms value");
  const nowMs = () => now === null ? Date.now()
    : typeof now === "function" ? Number(now()) : Number(now);

  // 1. Re-validate the plan as data. No execution, no workspace before this.
  const {orderedSteps, plan_sha256, budgets} = validateExecutionPlan(plan);
  const createdMs = runStart;

  // 2. Workspace (per run unless injected).
  const workspace = workspaceDir === null
    ? await mkdtemp(join(tmpdir(), "formal-workflow-"))
    : resolve(workspaceDir);
  await mkdir(workspace, {recursive: true});

  const toolVersions = {};
  const buildAbortedReceipt = failClosedReason => buildExecutionReceipt({
    plan, plan_sha256,
    steps: orderedSteps.map(s => makeRecord(s)),
    tool_versions: toolVersions,
    fail_closed_reason: failClosedReason,
    aborted: true,
    run_id: runIdFinal,
    source_sha: sourceSha,
    created_at: new Date(createdMs).toISOString(),
    environment: {
      host: host ?? hostname(),
      node: process.version,
      formal_portable_root_sha: SHA_PATTERN.test(environment.FORMAL_PORTABLE_RUNNER_SHA256 ?? "")
        ? environment.FORMAL_PORTABLE_RUNNER_SHA256 : null
    }
  });

  // 3. Preflight over ALL steps before any step runs: portable root, every
  // named tool binary, and one bounded --version probe per solve-smt tool.
  const root = environment.FORMAL_PORTABLE_ROOT;
  const blocked = (code, message) => {
    const receipt = buildAbortedReceipt(code);
    throw new WorkflowBlockedError(code, message, {receipt, workspaceDir: workspace});
  };
  if (typeof root !== "string" || !root || !isAbsolute(root))
    blocked(FC.TOOL_MISSING, "FORMAL_PORTABLE_ROOT must be set to an absolute portable bundle path");
  if (!(await pathExists(resolve(root), false)))
    blocked(FC.TOOL_MISSING, "portable root directory missing: " + root);
  const smtTools = [...new Set(orderedSteps.filter(s => s.operation === "solve-smt").map(s => s.tool))];
  const needsHighs = orderedSteps.some(s => s.operation === "solve-lp");
  for (const tool of smtTools) {
    const bin = join(resolve(root), "tools", tool, "bin", tool);
    if (!(await pathExists(bin, true)))
      blocked(FC.TOOL_MISSING, "solver binary missing for tool " + tool + " at " + bin);
  }
  if (needsHighs) {
    for (const rel of [["bin","tool-runner"], ["tools","highs","run"]]) {
      const p = join(resolve(root), ...rel);
      if (!(await pathExists(p, true)))
        blocked(FC.TOOL_MISSING, "portfolio runner component missing at " + p);
    }
  }
  const capture = captureImpl ?? defaultCapture;
  for (const tool of smtTools) {
    const bin = join(resolve(root), "tools", tool, "bin", tool);
    const p = await capture([bin, "--version"], {
      cwd: workspace, timeoutMs: MAX_VERSION_PROBE_TIMEOUT_MS, env: environment
    });
    const versionLine = String(p?.stdout ?? "").split(/\r?\n/).map(l => l.trim())
      .find(l => l.length > 0);
    if (!p || p.error || p.timed_out || p.output_limit || p.exit_code !== 0 ||
        typeof versionLine !== "string" || versionLine.length === 0)
      blocked(FC.VERSION_PROBE, "version probe failed for tool " + tool);
    toolVersions[tool] = {
      version: versionLine.slice(0, 128),
      probe_sha256: sha256Hex(Buffer.from(String(p.stdout), "utf8")),
      probe_bounded: boundText(String(p.stdout), 256)
    };
  }

  // 4. Execute the DAG in topological order (sequential, deterministic).
  const records = new Map();
  const rawStreams = [];
  const firstFailClosed = [];
  const noteFailClosed = code => { if (!firstFailClosed.includes(code)) firstFailClosed.push(code); };
  const budgetMs = budgets.max_total_timeout_s * 1000;
  let budgetExceeded = false;

  for (const step of orderedSteps) {
    if (budgetExceeded) { records.set(step.id, makeRecord(step)); continue; }
    if (nowMs() - runStart > budgetMs) {
      budgetExceeded = true;
      noteFailClosed(FC.BUDGET);
      records.set(step.id, makeRecord(step));
      continue;
    }
    const depsOk = step.depends_on.every(dep => records.get(dep)?.status === "EXECUTED");
    if (!depsOk) { records.set(step.id, makeRecord(step, {status: "SKIPPED_DOWNSTREAM"})); continue; }

    if (step.operation === "solve-smt") {
      const t0 = nowMs();
      let stepDir;
      try {
        stepDir = join(workspace, "steps", step.id);
        await mkdir(stepDir, {recursive: true});
        const inputPath = join(stepDir, "input.smt2");
        await writeFile(inputPath, Buffer.from(step.input.smt_lib, "utf8"), {flag: "wx", mode: 0o600});
      } catch (e) {
        noteFailClosed(FC.PROCESS_ERROR);
        records.set(step.id, makeRecord(step, {status: "ERROR", elapsed_ms: nowMs() - t0,
          result: {error: truncateError("workspace preparation failed: " + (e?.message ?? e))}}));
        continue;
      }
      const bin = join(resolve(root), "tools", step.tool, "bin", step.tool);
      const p = await capture([bin, "input.smt2"], {
        cwd: stepDir, timeoutMs: step.timeout_s * 1000, env: environment
      });
      const elapsed = nowMs() - t0;
      const stdout = String(p?.stdout ?? ""), stderr = String(p?.stderr ?? "");
      rawStreams.push({step_id: step.id, stdout: boundText(stdout), stderr: boundText(stderr)});
      const fields = {
        exit_code: typeof p?.exit_code === "number" ? p.exit_code : null,
        elapsed_ms: elapsed,
        stdout_sha256: sha256Hex(Buffer.from(stdout, "utf8")),
        stderr_sha256: sha256Hex(Buffer.from(stderr, "utf8")),
        stdout_bounded: boundText(stdout),
        stderr_bounded: boundText(stderr)
      };
      if (!p || p.error || p.output_limit) {
        noteFailClosed(FC.PROCESS_ERROR);
        records.set(step.id, makeRecord(step, {...fields, status: "ERROR",
          result: {error: truncateError(p?.error ?? "output limit exceeded")}}));
        continue;
      }
      if (p.timed_out) {
        noteFailClosed(FC.STEP_TIMEOUT);
        records.set(step.id, makeRecord(step, {...fields, status: "TIMEOUT"}));
        continue;
      }
      if (p.exit_code !== 0) {
        noteFailClosed(FC.NONZERO_EXIT);
        records.set(step.id, makeRecord(step, {...fields, status: "ERROR",
          result: {error: truncateError("solver exited with code " + p.exit_code)}}));
        continue;
      }
      const answer = smtAnswerFromStdout(stdout);
      if (answer === null) {
        noteFailClosed(FC.UNPARSABLE);
        records.set(step.id, makeRecord(step, {...fields, status: "ERROR",
          result: {error: "no smt answer token in solver stdout"}}));
        continue;
      }
      records.set(step.id, makeRecord(step, {...fields, status: "EXECUTED",
        result: {answer}, artifacts: await collectStepArtifacts(workspace, stepDir)}));
      continue;
    }

    if (step.operation === "solve-lp") {
      const t0 = nowMs();
      let r;
      try {
        r = await (solveLpImpl ?? runPortfolioOperation)(step.tool, step.operation, step.input, {timeoutS: step.timeout_s});
      } catch (e) {
        r = {status: "NOT_RUN_FAIL_CLOSED", reason: String(e)};
      }
      const elapsed = nowMs() - t0;
      const streams = plainObject(r?.streams) ? r.streams : {};
      const stdout = typeof streams.stdout === "string" ? streams.stdout : "";
      const stderr = typeof streams.stderr === "string" ? streams.stderr : "";
      const hasStreams = stdout.length > 0 || stderr.length > 0 || plainObject(r?.streams);
      if (hasStreams)
        rawStreams.push({step_id: step.id, stdout: boundText(stdout), stderr: boundText(stderr)});
      const fields = {
        exit_code: Number.isSafeInteger(r?.process?.exit_code) ? r.process.exit_code : null,
        elapsed_ms: elapsed,
        stdout_sha256: hasStreams ? sha256Hex(Buffer.from(stdout, "utf8")) : null,
        stderr_sha256: hasStreams ? sha256Hex(Buffer.from(stderr, "utf8")) : null,
        stdout_bounded: hasStreams ? boundText(stdout) : null,
        stderr_bounded: hasStreams ? boundText(stderr) : null
      };
      const fail = text => {
        noteFailClosed(FC.HIGHS);
        records.set(step.id, makeRecord(step, {...fields, status: "ERROR",
          result: {error: truncateError(text)}}));
      };
      if (r?.status === "T4_OPERATION_EXECUTED_UNREVIEWED" && plainObject(r.solver) &&
          LP_MODEL_STATUSES.includes(r.solver.model_status)) {
        records.set(step.id, makeRecord(step, {...fields, status: "EXECUTED", result: r.solver}));
        if (typeof r.solver.highspy_version === "string")
          toolVersions[step.tool] = {
            version: "highspy " + r.solver.highspy_version,
            probe_sha256: null, probe_bounded: null
          };
        continue;
      }
      if (r?.status === "PORTFOLIO_OPERATION_FAILED") {
        if (r.process?.timed_out === true) {
          noteFailClosed(FC.STEP_TIMEOUT);
          records.set(step.id, makeRecord(step, {...fields, status: "TIMEOUT"}));
        } else {
          fail(r.process?.error ?? "portfolio operation failed");
        }
        continue;
      }
      fail(r?.reason ?? "portfolio operation status " + String(r?.status));
      continue;
    }

    // cross-check: computed from completed dependency results only.
    const t0 = nowMs();
    const left = records.get(step.input.left_step), right = records.get(step.input.right_step);
    const leftAnswer = sideAnswer(left), rightAnswer = sideAnswer(right);
    let verdict, extra = {};
    if (leftAnswer === null || rightAnswer === null || leftAnswer === "unknown" || rightAnswer === "unknown") {
      verdict = "UNKNOWN";
      extra.unknown_reason = leftAnswer === null ? "left_answer_unavailable"
        : rightAnswer === null ? "right_answer_unavailable" : "solver_reported_unknown";
    } else if (leftAnswer === rightAnswer) {
      verdict = leftAnswer === "sat" ? "AGREE_SAT" : "AGREE_UNSAT";
    } else {
      verdict = "CONTRADICTION";
      noteFailClosed(FC.CONTRADICTION);
    }
    records.set(step.id, makeRecord(step, {
      status: "EXECUTED",
      elapsed_ms: nowMs() - t0,
      result: {verdict, left_step: step.input.left_step, right_step: step.input.right_step,
        left_answer: leftAnswer ?? "unavailable", right_answer: rightAnswer ?? "unavailable",
        ...extra}
    }));
  }

  // 5. Receipt + hash-bound artifacts.
  const failClosedReason = firstFailClosed.length > 0 ? firstFailClosed[0] : null;
  const receipt = buildExecutionReceipt({
    plan, plan_sha256,
    steps: orderedSteps.map(s => records.get(s.id)),
    tool_versions: toolVersions,
    fail_closed_reason: failClosedReason,
    aborted: false,
    run_id: runIdFinal,
    source_sha: sourceSha,
    created_at: new Date(createdMs).toISOString(),
    environment: {
      host: host ?? hostname(),
      node: process.version,
      formal_portable_root_sha: SHA_PATTERN.test(environment.FORMAL_PORTABLE_RUNNER_SHA256 ?? "")
        ? environment.FORMAL_PORTABLE_RUNNER_SHA256 : null
    }
  });
  await writeExecutionReceiptArtifacts(workspace, receipt, rawStreams);
  return {receipt, workspaceDir: workspace};
}

export const EXECUTOR_CONSTANTS = Object.freeze({
  PLAN_SCHEMA, SOLVE_SMT_TOOLS, SOLVE_LP_TOOLS, COMPARE_TOOL,
  TOOL_OPERATIONS, EXPECTED_OUTPUT_KINDS, TIMEOUT_LIMITS,
  BOUNDED_BYTES, FAIL_CLOSED_CODES: FC
});
