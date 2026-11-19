/**
 * Shared library for the mvp-user-e2e harness (issue #186 preparation, r0 @ 33bd3d0).
 * Plain Node >= 20 ESM, zero dependencies, offline. Never fabricates outcomes:
 * every classifier maps an OBSERVED violation/response to an outcome class.
 *
 * Pinned V0 contracts (issue #186 master brief):
 * - ExecutionPlan  {schema:"formal-tools/execution-plan/1.0", plan_id,
 *   source:{problem_sha256, problem_kind}, assumptions[], method_dag[],
 *   steps:[{id, tool(z3|cvc5|highs|compare), operation(solve-smt|solve-lp|cross-check),
 *   depends_on[], input, input_sha256, timeout_s, expected_output_kind}],
 *   budgets:{max_steps, max_total_timeout_s},
 *   compiled:{launcher_sha256, manifest_sha256}}
 * - ExecutionReceipt {schema:"formal-tools/execution-receipt/1.0", run_id, plan_id,
 *   plan_sha256, source_sha, created_at, tool_versions, steps[...], overall{...},
 *   environment{}}
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_ROOT = resolve(fileURLToPath(import.meta.url), "..");
/** Repo root as seen from validation/mvp-user-e2e/harness: three levels up. */
export const REPO_ROOT = resolve(HARNESS_ROOT, "..", "..", "..");

export const EXECUTION_PLAN_SCHEMA = "formal-tools/execution-plan/1.0";
export const EXECUTION_RECEIPT_SCHEMA = "formal-tools/execution-receipt/1.0";
export const PLAN_TOOL_ALLOWLIST = ["z3", "cvc5", "highs", "compare"];
export const PLAN_OPERATION_ALLOWLIST = ["solve-smt", "solve-lp", "cross-check"];
export const EXPECTED_OUTPUT_KINDS = ["solver_answer", "cross_tool_verdict"];

/** Harness-side r0 budget policy (pre-V4-b best guess; refine after V4-b lands). */
export const BUDGET_POLICY = {
  max_steps: 16,
  max_total_timeout_s: 300,
  max_step_timeout_s: 120
};

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Canonical JSON text: recursively key-sorted, no whitespace (pinned hash rule). */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]);
    return out;
  }
  return value;
}
export function canonicalJsonString(value) {
  return JSON.stringify(canonicalValue(value));
}

export const canonicalJsonSha256 = (value) => sha256Hex(canonicalJsonString(value));

/**
 * input_sha256 of a step input: JSON inputs use the canonical hash, text inputs use
 * raw bytes. The caller passes already-parsed JSON or raw bytes, so this stays pure.
 */
export function inputShaFor(kind, payload) {
  if (kind === "json") return canonicalJsonSha256(payload);
  return sha256Hex(payload);
}

const HEX64 = /^[a-f0-9]{64}$/;
const isInt = (v) => Number.isInteger(v);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const missingKeys = (obj, keys) => keys.filter((k) => !Object.hasOwn(obj, k));
const extraKeys = (obj, keys) => Object.keys(obj).filter((k) => !keys.includes(k));

export const PLAN_TOP_KEYS = ["schema", "plan_id", "source", "assumptions", "method_dag", "steps", "budgets", "compiled"];
export const STEP_KEYS = ["id", "tool", "operation", "depends_on", "input", "input_sha256", "timeout_s", "expected_output_kind"];
export const RECEIPT_TOP_KEYS = ["schema", "run_id", "plan_id", "plan_sha256", "source_sha", "created_at", "tool_versions", "steps", "overall", "environment"];

/**
 * Structural conformance of a plan to the pinned ExecutionPlan contract.
 * Returns {ok, errors:[{code, detail}]} — codes are stable strings the harness maps
 * to outcome classes. A plan may be structurally perfect yet still fail its tool
 * allowlist (PLAN_UNKNOWN_TOOL) or budget policy (TIMEOUT_BUDGET): those are
 * deliberate negative-fixture classes, reported as classification results, and are
 * NOT counted in `errors` unless `opts.negativesAreErrors` is true.
 */
export function validateExecutionPlanShape(plan, opts = {}) {
  const errors = [];
  const classes = [];
  if (!isPlainObject(plan)) return { ok: false, classes, errors: [{ code: "PLAN_SCHEMA_INVALID", detail: "plan is not a plain object" }] };
  for (const k of missingKeys(plan, PLAN_TOP_KEYS)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "missing key " + k });
  for (const k of extraKeys(plan, PLAN_TOP_KEYS)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "unexpected key " + k });
  if (plan.schema !== EXECUTION_PLAN_SCHEMA) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "schema " + JSON.stringify(plan.schema) });
  if (typeof plan.plan_id !== "string" || !plan.plan_id) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "plan_id" });
  if (!isPlainObject(plan.source) ||
      !HEX64.test(String(plan.source?.problem_sha256)) ||
      typeof plan.source?.problem_kind !== "string")
    errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "source {problem_sha256(64hex), problem_kind}" });
  if (!Array.isArray(plan.assumptions)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "assumptions[]" });
  if (!Array.isArray(plan.method_dag)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "method_dag[]" });
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "steps[] must be non-empty" });
  } else {
    for (const step of plan.steps) {
      if (!isPlainObject(step)) { errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "step not an object" }); continue; }
      for (const k of missingKeys(step, STEP_KEYS)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: missing key ${k}` });
      for (const k of extraKeys(step, STEP_KEYS)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: unexpected key ${k}` });
      if (typeof step.id !== "string" || !step.id) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "step id" });
      if (!PLAN_TOOL_ALLOWLIST.includes(step.tool))
        classes.push({ code: "TOOL_NOT_IN_ALLOWLIST", detail: `step ${step.id}: tool ${JSON.stringify(step.tool)}` });
      if (!PLAN_OPERATION_ALLOWLIST.includes(step.operation))
        classes.push({ code: "OPERATION_NOT_IN_ALLOWLIST", detail: `step ${step.id}: operation ${JSON.stringify(step.operation)}` });
      if (!Array.isArray(step.depends_on)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: depends_on[]` });
      if (step.input !== undefined && typeof step.input !== "string")
        errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: input must be a string path` });
      if (!HEX64.test(String(step.input_sha256)))
        errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: input_sha256 not 64hex` });
      if (!isInt(step.timeout_s) || step.timeout_s < 1)
        errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: timeout_s must be a positive integer` });
      if (!EXPECTED_OUTPUT_KINDS.includes(step.expected_output_kind))
        errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: expected_output_kind` });
    }
  }
  if (!isPlainObject(plan.budgets) ||
      !isInt(plan.budgets.max_steps) || !isInt(plan.budgets.max_total_timeout_s))
    errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "budgets {max_steps, max_total_timeout_s} integers" });
  if (!isPlainObject(plan.compiled) ||
      !HEX64.test(String(plan.compiled?.launcher_sha256)) ||
      !HEX64.test(String(plan.compiled?.manifest_sha256)))
    errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "compiled {launcher_sha256, manifest_sha256} 64hex" });

  if (opts.negativesAreErrors) for (const c of classes) errors.push({ code: c.code, detail: c.detail });
  return { ok: errors.length === 0, classes, errors };
}

/** Harness-side budget policy check (runs before any launch). */
export function checkBudgetPolicy(plan, policy = BUDGET_POLICY) {
  const violations = [];
  if (!isPlainObject(plan) || !isPlainObject(plan.budgets) || !Array.isArray(plan.steps)) {
    violations.push({ code: "BUDGET_UNVERIFIABLE", detail: "plan/budgets/steps missing" });
    return violations;
  }
  if (plan.budgets.max_steps > policy.max_steps)
    violations.push({ code: "BUDGET_MAX_STEPS", detail: `budgets.max_steps ${plan.budgets.max_steps} > policy ${policy.max_steps}` });
  if (plan.budgets.max_total_timeout_s > policy.max_total_timeout_s)
    violations.push({ code: "BUDGET_TOTAL_TIMEOUT", detail: `budgets.max_total_timeout_s ${plan.budgets.max_total_timeout_s} > policy ${policy.max_total_timeout_s}` });
  let sum = 0;
  for (const step of plan.steps) {
    if (!isInt(step.timeout_s)) continue;
    sum += step.timeout_s;
    if (step.timeout_s > policy.max_step_timeout_s)
      violations.push({ code: "BUDGET_STEP_TIMEOUT", detail: `step ${step.id}: timeout_s ${step.timeout_s} > policy ${policy.max_step_timeout_s}` });
  }
  if (sum > policy.max_total_timeout_s)
    violations.push({ code: "BUDGET_TOTAL_TIMEOUT", detail: `step timeouts sum ${sum} > policy ${policy.max_total_timeout_s}` });
  return violations;
}

/** Recompute a step's input hash from the referenced file (JSON inputs → canonical). */
export function recomputeStepInputSha(step, repoRoot) {
  const abs = resolve(repoRoot, String(step.input));
  let bytes;
  try { bytes = readFileSync(abs); }
  catch (e) { return { ok: false, code: "INPUT_UNREADABLE", detail: String(e).slice(0, 200) }; }
  const isJson = abs.toLowerCase().endsWith(".json");
  let expected;
  if (isJson) {
    try { expected = canonicalJsonSha256(JSON.parse(bytes.toString("utf8"))); }
    catch (e) { return { ok: false, code: "INPUT_UNPARSEABLE", detail: String(e).slice(0, 200) }; }
  } else {
    expected = sha256Hex(bytes);
  }
  return { ok: expected === step.input_sha256, code: expected === step.input_sha256 ? "INPUT_SHA_MATCH" : "INPUT_SHA_MISMATCH", expected };
}

/** Outcome class enum (closed; documented in fixtures/README.md). */
export const OUTCOME_CLASSES = [
  "AGREE_UNSAT", "AGREE_SAT",
  /^K_OPTIMAL_OBJECTIVE_/, "K_INFEASIBLE", "K_UNBOUNDED",
  "PARSE_ERROR", "PLAN_UNKNOWN_TOOL", "PLAN_HASH_MISMATCH", "TIMEOUT_BUDGET",
  "PLAN_SCHEMA_INVALID", "PROVIDER_BLOCKED",
  "SKIP_NOT_WIRED", "NOT_REGISTERED_YET", "SKIP_WEB_NOT_RUNNING", "FAIL_CLOSED_OTHER"
];
export function isKnownOutcomeClass(cls) {
  if (typeof cls !== "string") return false;
  return OUTCOME_CLASSES.some((c) => (typeof c === "string" ? c === cls : c.test(cls)));
}

/**
 * Map observed plan violations (structural classes + budget policy) to the negative
 * outcome class, or "OK" when nothing disqualifies the plan.
 */
export function classifyPlan(plan, opts = {}) {
  const shape = validateExecutionPlanShape(plan, opts);
  if (shape.classes.some((c) => c.code === "TOOL_NOT_IN_ALLOWLIST")) return "PLAN_UNKNOWN_TOOL";
  if (shape.classes.some((c) => c.code === "OPERATION_NOT_IN_ALLOWLIST")) return "PLAN_UNKNOWN_TOOL";
  const budget = checkBudgetPolicy(plan);
  if (budget.length > 0) return "TIMEOUT_BUDGET";
  if (!shape.ok) return "PLAN_SCHEMA_INVALID";
  if (opts.recomputeInputSha) {
    for (const step of plan.steps) {
      const r = recomputeStepInputSha(step, opts.repoRoot);
      if (!r.ok) return r.code === "INPUT_SHA_MISMATCH" ? "PLAN_HASH_MISMATCH" : "FAIL_CLOSED_OTHER";
    }
  }
  return "OK";
}

/** Structural conformance of a receipt to the pinned ExecutionReceipt contract. */
export function validateExecutionReceiptShape(receipt) {
  const errors = [];
  if (!isPlainObject(receipt)) return { ok: false, errors: [{ code: "RECEIPT_SCHEMA_INVALID", detail: "not a plain object" }] };
  for (const k of missingKeys(receipt, RECEIPT_TOP_KEYS)) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: "missing key " + k });
  for (const k of extraKeys(receipt, RECEIPT_TOP_KEYS)) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: "unexpected key " + k });
  if (receipt.schema !== EXECUTION_RECEIPT_SCHEMA) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: "schema " + JSON.stringify(receipt.schema) });
  for (const k of ["run_id", "plan_id", "plan_sha256", "source_sha", "created_at"])
    if (typeof receipt[k] !== "string" || !receipt[k]) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: k });
  if (!isPlainObject(receipt.tool_versions)) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: "tool_versions{}" });
  if (!Array.isArray(receipt.steps)) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: "steps[]" });
  if (!isPlainObject(receipt.overall)) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: "overall{}" });
  else {
    for (const k of ["process_outcome", "solver_answer", "cross_tool_verdict", "claim_verdict"])
      if (!Object.hasOwn(receipt.overall, k)) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: "overall." + k });
  }
  if (!isPlainObject(receipt.environment)) errors.push({ code: "RECEIPT_SCHEMA_INVALID", detail: "environment{}" });
  return { ok: errors.length === 0, errors };
}

/** Minimal stdout JSON extraction: first value that parses as a JSON object/array. */
export function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
