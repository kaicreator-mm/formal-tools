/**
 * Shared library for the mvp-user-e2e harness (issue #186; V6 live resync @ 646859f).
 * Plain Node >= 20 ESM, zero dependencies, offline. Never fabricates outcomes:
 * every classifier maps an OBSERVED violation/response to an outcome class.
 *
 * Pinned contracts (V2 planner / V3 executor as shipped; see
 * docs/mvp/EXECUTION_PLAN_CONTRACT.md and packages/runner/js/workflow-{plan,executor}.mjs):
 * - ExecutionPlan  {schema:"formal-tools/execution-plan/1.0", plan_id,
 *   source:{problem_sha256, problem_kind}, assumptions[], method_dag[{id,kind,depends_on}],
 *   steps:[{id, tool(z3|cvc5|highs|compare), operation(solve-smt|solve-lp|cross-check),
 *   depends_on[], input(TYPED OBJECT: {smt_lib} | LP model | {left_step,right_step,agree_on}),
 *   input_sha256(canonical JSON hash of input), timeout_s, expected_output_kind
 *   (smt-answer|lp-status|cross-tool-verdict)}],
 *   budgets:{max_steps, max_total_timeout_s},
 *   compiled:{launcher_sha256, manifest_sha256} each null-or-64hex}
 * - ExecutionReceipt {schema:"formal-tools/execution-receipt/1.0", run_id, plan_id,
 *   plan_sha256, source_sha, created_at, tool_versions, steps[...], overall{...},
 *   environment{}}
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_ROOT = resolve(fileURLToPath(import.meta.url), "..");
/** Repo root as seen from validation/mvp-user-e2e/harness: three levels up. */
export const REPO_ROOT = resolve(HARNESS_ROOT, "..", "..", "..");

export const EXECUTION_PLAN_SCHEMA = "formal-tools/execution-plan/1.0";
export const EXECUTION_RECEIPT_SCHEMA = "formal-tools/execution-receipt/1.0";
export const PLAN_TOOL_ALLOWLIST = ["z3", "cvc5", "highs", "compare"];
export const PLAN_OPERATION_ALLOWLIST = ["solve-smt", "solve-lp", "cross-check"];
export const EXPECTED_OUTPUT_KINDS = ["smt-answer", "lp-status", "cross-tool-verdict"];

/** Harness-side budget policy — resynced to the frozen V2 CAPS (workflow-plan.mjs). */
export const BUDGET_POLICY = {
  max_steps: 8,
  max_total_timeout_s: 120,
  max_step_timeout_s: 120
};

/** Tool -> the single operation each tool may perform (frozen V2 allowlist). */
export const TOOL_OPERATIONS = Object.freeze({
  z3: "solve-smt", cvc5: "solve-smt", highs: "solve-lp", compare: "cross-check"
});
/** operation -> expected_output_kind (frozen V0 contract, enforced by planner+executor). */
export const OPERATION_OUTPUT_KINDS = Object.freeze({
  "solve-smt": "smt-answer", "solve-lp": "lp-status", "cross-check": "cross-tool-verdict"
});
const COMPARE_AGREE_ON = ["sat", "unsat", "optimal-status"];

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
 * input_sha256 of a V2/V3 typed step input: ALWAYS the canonical JSON hash of the
 * input object ({smt_lib} | LP model | compare operands), matching both the
 * planner (sha256Canonical) and the executor (sha256Hex(canonicalJsonBytes)).
 */
export function inputShaFor(payload) {
  return canonicalJsonSha256(payload);
}

/** Light LP model shape checks mirrored from workflow-executor.mjs validateLpInputShape. */
export function isLpModelShape(model) {
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const bound = (v) => v === null || finite(v);
  if (!isPlainObject(model) || !["sense", "objective", "variables", "constraints"].every((k) => Object.hasOwn(model, k)) ||
      Object.keys(model).length !== 4 || !["min", "max"].includes(model.sense)) return false;
  if (!Array.isArray(model.objective) || model.objective.length < 1 || model.objective.length > 64 ||
      !model.objective.every(finite)) return false;
  const n = model.objective.length;
  if (!Array.isArray(model.variables) || model.variables.length !== n) return false;
  for (const v of model.variables) {
    if (!isPlainObject(v) || Object.keys(v).length !== 2 || !("lower" in v && "upper" in v) ||
        !bound(v.lower) || !bound(v.upper) || (v.lower !== null && v.upper !== null && v.lower > v.upper)) return false;
  }
  if (!Array.isArray(model.constraints) || model.constraints.length > 128) return false;
  for (const c of model.constraints) {
    if (!isPlainObject(c) || Object.keys(c).length !== 3 || !("lower" in c && "upper" in c && "coefficients" in c) ||
        !bound(c.lower) || !bound(c.upper) ||
        (c.lower !== null && c.upper !== null && c.lower > c.upper) ||
        !Array.isArray(c.coefficients) || c.coefficients.length !== n || !c.coefficients.every(finite)) return false;
  }
  return true;
}

/** Validate one typed step input object (mirror of planner validateStepInput). */
export function validateTypedStepInput(tool, operation, input) {
  if (!isPlainObject(input)) return "step input must be a typed plain object";
  if (operation === "solve-smt") {
    if (Object.keys(input).length !== 1 || !("smt_lib" in input) ||
        typeof input.smt_lib !== "string" || input.smt_lib.length === 0)
      return "solve-smt input must be exactly {smt_lib} non-empty";
    if (Buffer.byteLength(input.smt_lib, "utf8") > 65536) return "smt_lib exceeds 64KiB cap";
    return null;
  }
  if (operation === "solve-lp") {
    return isLpModelShape(input) ? null : "solve-lp input must be an LP model {sense,objective,variables,constraints}";
  }
  // cross-check
  if (Object.keys(input).length !== 3 || !("left_step" in input && "right_step" in input && "agree_on" in input) ||
      typeof input.left_step !== "string" || typeof input.right_step !== "string" ||
      input.left_step === input.right_step)
    return "cross-check input must be {left_step, right_step, agree_on} with distinct step ids";
  if (!Array.isArray(input.agree_on) || input.agree_on.length === 0 ||
      new Set(input.agree_on).size !== input.agree_on.length ||
      input.agree_on.some((x) => !COMPARE_AGREE_ON.includes(x)))
    return "agree_on must be unique values from " + COMPARE_AGREE_ON.join("|");
  return null;
}

const HEX64 = /^[a-f0-9]{64}$/;
const isInt = (v) => Number.isInteger(v);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const missingKeys = (obj, keys) => keys.filter((k) => !Object.hasOwn(obj, k));
const extraKeys = (obj, keys) => Object.keys(obj).filter((k) => !keys.includes(k));

export const PLAN_TOP_KEYS = ["schema", "plan_id", "source", "assumptions", "method_dag", "steps", "budgets", "compiled"];
export const STEP_KEYS = ["id", "tool", "operation", "depends_on", "input", "input_sha256", "timeout_s", "expected_output_kind"];
export const RECEIPT_TOP_KEYS = ["schema", "run_id", "plan_id", "plan_sha256", "source_sha", "created_at", "tool_versions", "steps", "overall", "environment"];
const PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

/**
 * Structural conformance of a plan to the pinned ExecutionPlan contract
 * (V2/V3 shapes: typed input objects, per-operation expected_output_kind,
 * null-or-hash compiled block). Returns {ok, errors:[{code, detail}]} — codes
 * are stable strings the harness maps to outcome classes. A plan may be
 * structurally perfect yet still fail its tool allowlist (PLAN_UNKNOWN_TOOL)
 * or budget policy (TIMEOUT_BUDGET): those are deliberate negative-fixture
 * classes, reported as classification results, and are NOT counted in
 * `errors` unless `opts.negativesAreErrors` is true.
 */
export function validateExecutionPlanShape(plan, opts = {}) {
  const errors = [];
  const classes = [];
  if (!isPlainObject(plan)) return { ok: false, classes, errors: [{ code: "PLAN_SCHEMA_INVALID", detail: "plan is not a plain object" }] };
  for (const k of missingKeys(plan, PLAN_TOP_KEYS)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "missing key " + k });
  for (const k of extraKeys(plan, PLAN_TOP_KEYS)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "unexpected key " + k });
  if (plan.schema !== EXECUTION_PLAN_SCHEMA) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "schema " + JSON.stringify(plan.schema) });
  if (typeof plan.plan_id !== "string" || !PLAN_ID_PATTERN.test(plan.plan_id)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "plan_id" });
  if (!isPlainObject(plan.source) ||
      !HEX64.test(String(plan.source?.problem_sha256)) ||
      typeof plan.source?.problem_kind !== "string" || !plan.source.problem_kind)
    errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "source {problem_sha256(64hex), problem_kind}" });
  if (!Array.isArray(plan.assumptions)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "assumptions[]" });
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
      if (PLAN_TOOL_ALLOWLIST.includes(step.tool) && PLAN_OPERATION_ALLOWLIST.includes(step.operation) &&
          TOOL_OPERATIONS[step.tool] !== step.operation)
        classes.push({ code: "OPERATION_NOT_IN_ALLOWLIST", detail: `step ${step.id}: operation ${step.operation} not admitted for tool ${step.tool}` });
      if (!Array.isArray(step.depends_on)) errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: depends_on[]` });
      const inputProblem = isPlainObject(step) && PLAN_OPERATION_ALLOWLIST.includes(step.operation)
        ? validateTypedStepInput(step.tool, step.operation, step.input) : "input must be a typed object";
      if (inputProblem) errors.push({ code: "PLAN_INPUT_INVALID", detail: `step ${step.id}: ${inputProblem}` });
      if (!HEX64.test(String(step.input_sha256)))
        errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: input_sha256 not 64hex` });
      if (!isInt(step.timeout_s) || step.timeout_s < 1) {
        errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: timeout_s must be a positive integer` });
      } else if (step.timeout_s > 120) {
        // Deliberate negative class (executor: PLAN_TIMEOUT_INVALID), not a shape error.
        classes.push({ code: "TIMEOUT_BUDGET", detail: `step ${step.id}: timeout_s ${step.timeout_s} > frozen step cap 120` });
      }
      if (isInt(step.timeout_s) && step.timeout_s >= 1 &&
          OPERATION_OUTPUT_KINDS[step.operation] !== undefined &&
          step.expected_output_kind !== OPERATION_OUTPUT_KINDS[step.operation])
        errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `step ${step.id}: expected_output_kind must be ${OPERATION_OUTPUT_KINDS[step.operation]} for ${step.operation}` });
    }
    // method_dag mirrors steps 1:1 (planner invariant, checked when present).
    if (Array.isArray(plan.method_dag)) {
      if (plan.method_dag.length !== plan.steps.length)
        errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "method_dag must mirror steps 1:1" });
      plan.method_dag.forEach((entry, i) => {
        if (!isPlainObject(entry) || missingKeys(entry, ["id", "kind", "depends_on"]).length ||
            extraKeys(entry, ["id", "kind", "depends_on"]).length)
          errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `method_dag[${i}] must be exactly {id, kind, depends_on}` });
        else if (entry.id !== plan.steps[i]?.id)
          errors.push({ code: "PLAN_SCHEMA_INVALID", detail: `method_dag[${i}].id diverges from steps[${i}].id` });
      });
    }
  }
  if (!isPlainObject(plan.budgets) ||
      !isInt(plan.budgets.max_steps) || !isInt(plan.budgets.max_total_timeout_s))
    errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "budgets {max_steps, max_total_timeout_s} integers" });
  if (!isPlainObject(plan.compiled) ||
      !(plan.compiled.launcher_sha256 === null || HEX64.test(String(plan.compiled.launcher_sha256))) ||
      !(plan.compiled.manifest_sha256 === null || HEX64.test(String(plan.compiled.manifest_sha256))))
    errors.push({ code: "PLAN_SCHEMA_INVALID", detail: "compiled {launcher_sha256, manifest_sha256} null-or-64hex" });

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

/**
 * Recompute a step's input hash from its INLINE typed input object (V2/V3:
 * inputs travel inside the plan, hashes are canonical JSON). `repoRoot` is
 * accepted for call compatibility and unused.
 */
export function recomputeStepInputSha(step, _repoRoot = undefined) {
  let expected;
  try { expected = canonicalJsonSha256(step.input); }
  catch (e) { return { ok: false, code: "INPUT_UNPARSEABLE", detail: String(e).slice(0, 200) }; }
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
  if (shape.classes.some((c) => c.code === "TIMEOUT_BUDGET")) return "TIMEOUT_BUDGET";
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
