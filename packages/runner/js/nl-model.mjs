/**
 * Issue #182 follow-up R2-C: natural language -> typed constraint MODEL
 * proposal -> explicit user approval -> typed ExecutionPlan.
 *
 * Honesty contract (binding for every exporter of this module):
 *   - The LLM output is a TRANSLATION PROPOSAL, i.e. UNTRUSTED DATA. Nothing
 *     here ever claims semantic equivalence between the natural-language text
 *     and the structured model or its renderings. Render validity is a
 *     statement about the deterministic renderer, never about fidelity of the
 *     translation; only the explicit user approval gate (approveModel) turns
 *     a proposal into something that may be planned, and even then the plan
 *     answers the RENDERED model, not "the text".
 *   - The deterministic path in this module is VALIDATION + RENDERING only.
 *     There is no NL parser: a template extractor exists only in tests as a
 *     stub provider. Proposals without a provider are impossible.
 *   - Scope: bounded integer linear problems expressible in QF_LIA
 *     (question "sat", executed by z3 + cvc5 + cross-check), and the LP
 *     relaxation shape of the existing HiGHS typed portfolio for question
 *     "optimize" (integrality is DROPPED; results are bounds for the
 *     continuous relaxation, NOT the integer problem). Because no integer
 *     MIP typed operation exists, R3 makes the relaxation EXPLICIT and
 *     FAIL-CLOSED: approving an optimize question without decision
 *     `lpRelaxationAcknowledged === true` returns the restricted record
 *     UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION (no plan, never a silent LP
 *     stand-in for the integer optimum); with the acknowledgement the plan
 *     carries machine-readable LP_RELAXATION_ONLY metadata.
 *   - Vague or missing-bounds texts must surface as NEEDS_CLARIFICATION with
 *     the model's own questions; this module never guesses missing
 *     constraints, bounds or objectives.
 *
 * Planning/execution reuse (imports, no shared-file edits):
 *   workflow-plan.mjs: canonicalJson, sha256Canonical, sha256Text, WorkflowError,
 *     makeDeepSeekChatProvider (transport reuse: env-only key, header-only
 *     Authorization, timeout/abort discipline, JSON classification),
 *     normalizeUserProblem, stepsFromMethod, buildExecutionPlan.
 *   method-planner.mjs: validateProblemSpec (problem re-validation after the
 *     provenance requirement is attached).
 *   tool-portfolio-t4.mjs: planPortfolioOperation (LP shape acceptance probe).
 *
 * This module never launches processes and never opens sockets itself; the
 * only network path is the injected DeepSeek chat provider transport reuse.
 */

import {
  WorkflowError, canonicalJson, sha256Canonical, sha256Text,
  canonicalProblemText, normalizeUserProblem, stepsFromMethod,
  buildExecutionPlan, makeDeepSeekChatProvider, PLAN_SCHEMA
} from "./workflow-plan.mjs";
import { validateProblemSpec } from "./method-planner.mjs";
import { planPortfolioOperation } from "./tool-portfolio-t4.mjs";

export const NL_MODEL_PROPOSAL_SCHEMA = "formal-tools/nl-model-proposal/0.1";
export const NL_MODEL_APPROVED_SCHEMA = "formal-tools/nl-model-approved/0.1";
export const NL_PROBLEM_KIND = "nl_model";

/** Frozen scope caps for the NL-model lane. Transport-independent. */
export const NL_CAPS = Object.freeze({
  maxTextBytes: 8192,
  maxVars: 16,
  maxConstraints: 32,
  maxCoeffAbs: 1000,
  maxBoundAbs: 1e6,
  maxAssumptions: 16,
  maxAssumptionChars: 256,
  maxClarifications: 8,
  maxClarificationChars: 256,
  namePattern: /^[a-z][a-z0-9_]{0,15}$/
});

const VAR_NAME_KEYS = ["name", "integer", "lower", "upper"];
const CONSTRAINT_KEYS = ["coefficients", "op", "rhs"];
const OPS = Object.freeze(["<", "<=", "==", ">=", ">"]);
const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);
const hasOnly = (obj, names) => isObject(obj) && Object.keys(obj).every(k => names.includes(k));
const safeInt = x => Number.isSafeInteger(x);

/**
 * Documented constraint on the LP arm: the HiGHS typed shape carries only
 * {lower,upper} bounds — no integrality. Building an LP plan therefore drops
 * integrality, and this exact sentence is appended to the plan assumptions.
 */
export const NL_LP_RELAXATION_ASSUMPTION =
  "LP relaxation: integrality constraints are dropped by the nl-model compiler " +
  "(the HiGHS typed operation has no integrality field); the executed answer " +
  "characterizes the continuous relaxation only, not the integer problem.";

/**
 * R3: machine-readable label for the LP arm. Every approved optimize model
 * (decision.lpRelaxationAcknowledged === true) records this kind in
 * review.lp_relaxation_ack (hash-covered), in the buildPlanFromApprovedModel
 * wrapper field `relaxation`, and inside the plan assumption JSON string
 * (see nlLpRelaxationPlanAssumption).
 */
export const NL_LP_RELAXATION_ONLY = "LP_RELAXATION_ONLY";

/**
 * R3: verdict for the fail-closed gate. Without an explicit LP-relaxation
 * acknowledgement, an integer optimize question is UNSUPPORTED: there is no
 * trusted exact-integer execution operation, and the runner must never
 * present the LP relaxation optimum as the integer optimum.
 */
export const NL_UNSUPPORTED_EXACT_INTEGER = "UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION";

/**
 * R3: fixed deterministic explanation carried in the `detail` field of the
 * UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION record.
 */
export const NL_INTEGER_OPTIMIZATION_UNSUPPORTED_NOTE =
  "No trusted execution operation exists for exact integer optimization: the " +
  "only typed operation available is the continuous HiGHS LP relaxation " +
  "(integrality dropped), whose optimal value can differ from the integer " +
  "optimum. To proceed, explicitly accept the LP relaxation by approving with " +
  "lpRelaxationAcknowledged: true (results then characterize the continuous " +
  "relaxation only), or provide a future integer MIP typed operation adapter. " +
  "This runner never presents an LP relaxation optimum as an integer optimum.";

export const NL_PLAN_TARGETS = Object.freeze({ sat: "smt", optimize: "lp" });

/**
 * Canonical LP-relaxation acknowledgement record stored hash-covered at
 * review.lp_relaxation_ack of every approved optimize model. approveModel
 * writes it iff decision.lpRelaxationAcknowledged === true;
 * buildPlanFromApprovedModel requires exactly this canonical shape.
 */
export function nlLpRelaxationAckRecord() {
  return Object.freeze({
    acknowledged: true,
    kind: NL_LP_RELAXATION_ONLY,
    dropped: ["integrality"],
    decision_field: "lpRelaxationAcknowledged"
  });
}

/** @param {any} ack @returns {boolean} exact canonical-shape match */
function isCanonicalLpRelaxationAck(ack) {
  try {
    return canonicalJson(ack) === canonicalJson(nlLpRelaxationAckRecord());
  } catch {
    return false;
  }
}

/**
 * Machine-readable LP-relaxation metadata embedded as an additional plan
 * assumption (a canonical JSON string). The frozen ExecutionPlan envelope has
 * no metadata slot, so this is the machine-readable marker INSIDE the plan:
 * consumers can detect LP_RELAXATION_ONLY from the plan envelope alone.
 */
export function nlLpRelaxationPlanAssumption() {
  return canonicalJson({
    kind: NL_LP_RELAXATION_ONLY,
    dropped: ["integrality"],
    relaxed_from: "QF_LIA integer model",
    ack: { field: "lpRelaxationAcknowledged", acknowledged: true }
  });
}

// ---------------------------------------------------------------------------
// System prompt (the LLM proposes ONLY this JSON schema; temperature 0 comes
// from the reused transport). The proposal is untrusted data on return.
// ---------------------------------------------------------------------------
export const NL_SYSTEM_PROMPT = [
  "You translate a bounded natural-language constraint problem into a structured linear integer model.",
  "You PROPOSE a translation; you have no authority over its correctness and a human will review it.",
  "Reply with STRICT JSON only (no markdown, no commentary): exactly one JSON object with exactly these fields:",
  '{"variables":[{"name":"<lowercase snake_case id>","integer":true,"lower":<int>,"upper":<int>}],',
  ' "constraints":[{"coefficients":{"<variable name>":<int coefficient>},"op":"<|<=|==|>=|>","rhs":<int>}],',
  ' "question":"sat"|"optimize","assumptions":["<every non-obvious interpretation decision you made>"]}',
  'Add "objective":{"direction":"minimize"|"maximize","coefficients":{"<variable name>":<int>}} ONLY when question is "optimize".',
  'Add "clarification_needed":["<specific question to the user>"] ONLY when you cannot propose a model responsibly.',
  "Rules:",
  "- Every variable MUST carry explicit finite integer bounds with lower <= upper (|bound| <= 1000000).",
  "  If the text omits a bound, derive the smallest implied bound and RECORD the derivation in assumptions;",
  "  if no defensible bound exists, use clarification_needed instead of guessing.",
  "- If two stated conditions contradict each other (e.g. 'x >= 5' and 'x <= 3'), NEVER encode them as crossed",
  "  variable bounds (lower > upper is invalid): give the variable wide neutral bounds and encode each stated",
  "  condition as its own constraint, so the solver can honestly report unsat.",
  "- Constraints must be linear over declared variables only, with integer coefficients (|coefficient| <= 1000),",
  "  one of the ops <, <=, ==, >=, >, and an integer rhs.",
  "- Introduce auxiliary variables only when required (e.g. 'multiple of 7' means x+y = 7*k for an auxiliary",
  "  integer k) and record their introduction and bounds in assumptions.",
  "- Use question \"sat\" when the text asks whether a solution exists (or to find one); use \"optimize\" ONLY",
  "  when the text explicitly asks for a minimum or maximum value, and then include \"objective\".",
  "- If the text is not a bounded finite linear integer constraint problem (vague goals, missing quantities,",
  "  non-linear relations, qualitative safety claims), do NOT invent a model: return the JSON envelope with",
  "  empty variables/constraints arrays and your specific questions in clarification_needed.",
  "- Never add fields beyond the schema; never output anything except the JSON object."
].join("\n");

// ---------------------------------------------------------------------------
// Provider: transport reuse via makeDeepSeekChatProvider. That adapter's
// frozen system prompt is method-proposal-specific, so the provider below
// swaps ONLY the system message while reusing the entire hardened transport:
// env-only API key, Authorization-header-only key placement, timeout/abort,
// HTTP status classification, strict JSON parsing with brace fallback and
// BLOCKED_PROVIDER/PROVIDER_FAILED classification.
// ---------------------------------------------------------------------------
export function makeNlModelProvider(options = {}) {
  const upstreamFetch = typeof options.fetchImpl === "function"
    ? options.fetchImpl
    : globalThis.fetch;
  if (typeof upstreamFetch !== "function")
    throw new WorkflowError("BLOCKED_PROVIDER", "no fetch implementation available");
  const inner = makeDeepSeekChatProvider({
    ...options,
    fetchImpl: async (url, init) => {
      // The body shape is frozen in workflow-plan.mjs: messages[0] is the
      // system prompt, messages[1] the JSON user payload. Swap the system
      // message; never touch headers (the key stays header-only upstream).
      const body = JSON.parse(init.body);
      body.messages[0].content = NL_SYSTEM_PROMPT;
      return upstreamFetch(url, { ...init, body: JSON.stringify(body) });
    }
  });
  return Object.freeze({
    generate: inner.generate,
    model: inner.model,
    baseUrl: inner.baseUrl,
    getProposal: inner.getProposal
  });
}

function normalizeProvider(provider) {
  if (provider === undefined || provider === "deepseek")
    return { fn: makeNlModelProvider({}).generate, name: "deepseek", model: "deepseek-chat" };
  if (typeof provider === "function")
    return { fn: provider, name: "injected", model: "injected" };
  if (isObject(provider) && typeof provider.generate === "function")
    return {
      fn: provider.generate,
      name: "injected",
      model: typeof provider.model === "string" && provider.model ? provider.model : "injected"
    };
  throw new WorkflowError("NL_PROVIDER_INVALID",
    "provider must be \"deepseek\", a generate(payload) function, or an object with a generate function");
}

// ---------------------------------------------------------------------------
// Structured model validation. All provider output flows through here.
// Returns a defensive normalized copy; throws NL_MODEL_INVALID with issues.
// ---------------------------------------------------------------------------
/** @param {any} raw @returns {any} */
export function validateStructuredModel(raw) {
  /** @type {string[]} */
  const issues = [];
  if (!isObject(raw)) throw new WorkflowError("NL_MODEL_INVALID", "structured model must be a plain object", { issues: ["not_an_object"] });
  const required = ["variables", "constraints", "question", "assumptions"];
  const optional = ["objective", "clarification_needed"];
  const keys = Object.keys(raw);
  for (const k of keys)
    if (!required.includes(k) && !optional.includes(k)) issues.push("unexpected_field:" + k);
  for (const k of required)
    if (!keys.includes(k)) issues.push("missing_field:" + k);
  if (issues.length)
    throw new WorkflowError("NL_MODEL_INVALID", "structured model envelope rejected", { issues });

  const variables = [];
  const rawVarsIsArray = Array.isArray(raw.variables);
  if (!rawVarsIsArray || raw.variables.length < 1 || raw.variables.length > NL_CAPS.maxVars)
    issues.push("variables_out_of_bounds");
  else {
    const seen = new Set();
    raw.variables.forEach((v, i) => {
      if (!isObject(v) || !hasOnly(v, VAR_NAME_KEYS)) { issues.push("variable_" + i + "_fields"); return; }
      const { name, integer, lower, upper } = v;
      if (typeof name !== "string" || !NL_CAPS.namePattern.test(name)) { issues.push("variable_" + i + "_name"); return; }
      if (seen.has(name)) { issues.push("duplicate_variable:" + name); return; }
      seen.add(name);
      if (integer !== true) { issues.push("variable_" + name + "_not_integer"); return; }
      if (!safeInt(lower) || Math.abs(lower) > NL_CAPS.maxBoundAbs ||
          !safeInt(upper) || Math.abs(upper) > NL_CAPS.maxBoundAbs)
        issues.push("variable_" + name + "_bounds");
      else if (lower > upper) issues.push("variable_" + name + "_bounds_crossed");
      else variables.push({ name, integer: true, lower, upper });
    });
    if (variables.length !== raw.variables.length && variables.length === 0) issues.push("no_valid_variables");
  }
  const nameSet = new Set(variables.map(v => v.name));

  // clarification_needed inside a full-model reply: valid non-empty content
  // was already handled by the clarification branch in proposeConstraintModel;
  // invalid content here means the reply as a whole is unusable.
  if (raw.clarification_needed !== undefined) {
    /** @type {string[]} */
    const clIssues = [];
    const questions = boundedStrings(raw.clarification_needed, NL_CAPS.maxClarifications, NL_CAPS.maxClarificationChars, clIssues, "clarification_needed");
    if (clIssues.length > 0 || questions.length === 0) issues.push("clarification_needed_invalid");
    else if (questions.length > 0) issues.push("clarification_needed_present_with_model");
  }

  let objective = null;
  if (raw.objective !== undefined) {
    const o = raw.objective;
    if (!isObject(o) || !hasOnly(o, ["direction", "coefficients"]))
      issues.push("objective_fields");
    else if (o.direction !== "minimize" && o.direction !== "maximize")
      issues.push("objective_direction");
    else {
      const coeffs = checkCoefficients(o.coefficients, nameSet, issues, "objective");
      if (coeffs !== null && Object.keys(coeffs).length > 0)
        objective = { direction: o.direction, coefficients: coeffs };
    }
  }

  const constraints = [];
  if (!Array.isArray(raw.constraints) || raw.constraints.length > NL_CAPS.maxConstraints)
    issues.push("constraints_out_of_bounds");
  else raw.constraints.forEach((c, i) => {
    if (!isObject(c) || !hasOnly(c, CONSTRAINT_KEYS)) { issues.push("constraint_" + i + "_fields"); return; }
    if (!OPS.includes(c.op)) { issues.push("constraint_" + i + "_op"); return; }
    if (!safeInt(c.rhs) || Math.abs(c.rhs) > NL_CAPS.maxBoundAbs) { issues.push("constraint_" + i + "_rhs"); return; }
    const coeffs = checkCoefficients(c.coefficients, nameSet, issues, "constraint_" + i);
    if (coeffs === null || Object.keys(coeffs).length === 0) issues.push("constraint_" + i + "_empty");
    else constraints.push({ coefficients: coeffs, op: c.op, rhs: c.rhs });
  });

  const question = raw.question;
  if (question !== "sat" && question !== "optimize") issues.push("question");
  if (question === "optimize" && objective === null) issues.push("optimize_without_objective");
  if (question === "sat" && raw.objective !== undefined) issues.push("sat_with_objective");

  const assumptions = boundedStrings(raw.assumptions, NL_CAPS.maxAssumptions, NL_CAPS.maxAssumptionChars, issues, "assumptions");

  if (issues.length)
    throw new WorkflowError("NL_MODEL_INVALID", "structured model rejected", { issues });
  return { variables, constraints, question, assumptions, ...(objective ? { objective } : {}) };
}

/** Coefficient object check: declared names only, safe ints, |c|<=maxCoeffAbs,
 * no zero coefficients (the provider was told to omit them). Returns null on
 * shape failure (issue already recorded) or the cleaned sorted-name object. */
function checkCoefficients(coeffs, nameSet, issues, label) {
  if (!isObject(coeffs)) { issues.push(label + "_coefficients_shape"); return null; }
  const keys = Object.keys(coeffs);
  if (keys.length === 0) { issues.push(label + "_coefficients_empty"); return null; }
  const out = {};
  for (const k of keys) {
    if (!NL_CAPS.namePattern.test(k) || !nameSet.has(k)) { issues.push(label + "_coefficient_undeclared:" + k); return null; }
    const c = coeffs[k];
    if (!safeInt(c) || Math.abs(c) > NL_CAPS.maxCoeffAbs) { issues.push(label + "_coefficient_value:" + k); return null; }
    if (c === 0) { issues.push(label + "_coefficient_zero:" + k); return null; }
    out[k] = c;
  }
  return out;
}

function boundedStrings(value, maxItems, maxChars, issues, label) {
  if (!Array.isArray(value) || value.length > maxItems) { issues.push(label + "_shape"); return []; }
  const out = [];
  for (const s of value) {
    if (typeof s !== "string" || s.length === 0 || s.length > maxChars) { issues.push(label + "_item"); return out; }
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic rendering.
// ---------------------------------------------------------------------------

/** Linear s-expression for {coefficients, ...} with coefficients iterated in
 * sorted-name order (determinism). coeff 1/-1 collapse to the bare variable. */
function linExpr(coefficients) {
  const terms = Object.keys(coefficients).sort().map(name => {
    const c = coefficients[name];
    if (c === 1) return name;
    if (c === -1) return "(- " + name + ")";
    return "(* " + c + " " + name + ")";
  });
  if (terms.length === 1) return terms[0];
  return "(+ " + terms.join(" ") + ")";
}

const OP_TO_SMT = Object.freeze({ "<": "<", "<=": "<=", "==": "=", ">=": ">=", ">": ">" });
const SMT_COMMANDS = Object.freeze(["set-logic", "declare-fun", "assert", "check-sat", "get-model", "exit"]);

/**
 * Render the validated model to SMT-LIB2 (QF_LIA).
 *   mode "plan":    check-sat + exit; NEVER get-model — z3 5.4.0 exits 1 on
 *                   get-model after unsat (measured on the trusted host), and
 *                   an executor step must not risk a nonzero exit on a result
 *                   it cannot predict.
 *   mode "witness": adds (get-value (...)) after check-sat; used ONLY by
 *                   evidence tooling after an AGREE_SAT verdict, never in a
 *                   plan step input.
 * @param {any} model validated structured model
 * @param {{mode?: "plan"|"witness"}} [options]
 * @returns {string}
 */
export function renderSmtLib(model, options = {}) {
  const mode = options.mode === "witness" ? "witness" : "plan";
  const lines = ["(set-logic QF_LIA)"];
  for (const v of model.variables) lines.push("(declare-fun " + v.name + " () Int)");
  for (const v of model.variables) {
    lines.push("(assert (>= " + v.name + " " + v.lower + "))");
    lines.push("(assert (<= " + v.name + " " + v.upper + "))");
  }
  for (const c of model.constraints)
    lines.push("(assert (" + OP_TO_SMT[c.op] + " " + linExpr(c.coefficients) + " " + c.rhs + "))");
  lines.push("(check-sat)");
  if (mode === "witness" && model.question === "sat")
    lines.push("(get-value (" + model.variables.map(v => v.name).join(" ") + "))");
  lines.push("(exit)");
  return lines.join("\n") + "\n";
}

/**
 * Render the validated model to the HiGHS typed LP JSON shape (the exact
 * shape planPortfolioOperation / validateHighsModel accept). Ops < and > are
 * rejected: strict inequalities have no LP form and the integrality shift
 * (x < 5 == x <= 4) is unsound once integrality is dropped.
 * @param {any} model validated structured model
 * @returns {any}
 */
export function renderLpModel(model) {
  if (model.question !== "optimize")
    throw new WorkflowError("NL_RENDER_INVALID", "LP rendering is defined for question \"optimize\" only");
  const vars = model.variables;
  const objective = vars.map(v => (model.objective.coefficients[v.name] ?? 0));
  const constraints = model.constraints.map((c, i) => {
    if (c.op === "<" || c.op === ">")
      throw new WorkflowError("NL_RENDER_INVALID", "strict inequality cannot be rendered as LP row " + i,
        { op: c.op, row: i });
    const coefficients = vars.map(v => (c.coefficients[v.name] ?? 0));
    if (c.op === "<=") return { lower: null, upper: c.rhs, coefficients };
    if (c.op === ">=") return { lower: c.rhs, upper: null, coefficients };
    return { lower: c.rhs, upper: c.rhs, coefficients }; // "=="
  });
  const lp = {
    sense: model.objective.direction === "minimize" ? "min" : "max",
    objective,
    variables: vars.map(v => ({ lower: v.lower, upper: v.upper })),
    constraints
  };
  // Acceptance probe: the same validator the executor's portfolio gateway
  // applies at run time. Validation only — nothing is executed here.
  try {
    planPortfolioOperation("highs", "solve-lp", lp);
  } catch (e) {
    throw new WorkflowError("NL_RENDER_INVALID", "rendered LP model rejected by the portfolio validator",
      { reason: String(e && e.message || e) });
  }
  return lp;
}

/**
 * Defense-in-depth verification of a rendered SMT text: balanced parens
 * (string-aware), top-level commands drawn only from the frozen allowlist,
 * and every identifier drawn only from declared variables, the QF_LIA
 * keyword, Int, the comparison/arithmetic operators and the command names.
 * The renderer only emits such text; this checker proves it per artifact.
 * @param {string} text
 * @param {{variables?: string[], allowGetModel?: boolean}} [options]
 */
export function verifyRenderedSmt(text, options = {}) {
  const fail = why => { throw new WorkflowError("NL_RENDER_INVALID", "rendered SMT rejected: " + why, { reason: why }); };
  if (typeof text !== "string" || text.length === 0) fail("empty");
  // balanced parens, string-aware
  let depth = 0, inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (c === "\\") i++; else if (c === "\"") inString = false; continue; }
    if (c === "\"") inString = true;
    else if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth < 0) fail("unbalanced_parens"); }
  }
  if (depth !== 0 || inString) fail("unbalanced_parens");
  // top-level commands
  const commands = [];
  let tok = "", head = false;
  for (const ch of text) {
    if (ch === "(") { if (depth === 0) { head = true; tok = ""; } depth++; continue; }
    if (ch === ")") { depth--; if (depth === 0 && head) { commands.push(tok.trim().split(/\s+/)[0]); head = false; } continue; }
    if (depth === 1 && head) tok += ch;
  }
  const allowGetModel = options.allowGetModel === true;
  const allowedCommands = allowGetModel ? [...SMT_COMMANDS, "get-value"] : [...SMT_COMMANDS];
  for (const cmd of commands)
    if (!allowedCommands.includes(cmd)) fail("disallowed_command:" + cmd);
  if (!allowGetModel && commands.includes("get-model")) fail("unexpected_get_model");
  // identifier allowlist
  const allowed = new Set([
    ...(options.variables ?? []), "Int", "QF_LIA", ...SMT_COMMANDS,
    "=", "<", ">", "<=", ">=", "+", "-", "*",
    ...(allowGetModel ? ["get-value"] : [])
  ]);
  const atoms = text.split(/[()\s]+/).map(a => a.replace(/^"|"$/g, "")).filter(a => a.length > 0);
  for (const a of atoms) {
    if (/^-?\d+$/.test(a)) continue;
    if (!allowed.has(a)) fail("disallowed_atom:" + a);
  }
  return { ok: true, commands };
}

/** Rendering artifact with provenance fields. Runs verifyRenderedSmt. */
/** @param {any} model @param {"plan"|"witness"} mode @returns {any} */
export function renderSmtArtifact(model, mode = "plan") {
  const text = renderSmtLib(model, { mode });
  verifyRenderedSmt(text, {
    variables: model.variables.map(v => v.name),
    allowGetModel: mode === "witness"
  });
  return Object.freeze({
    kind: "smt-lib2", logic: "QF_LIA", mode,
    text,
    sha256: sha256Text(text),
    commands_allowlist: SMT_COMMANDS,
    semantic_status: "TRANSLATION_PROPOSAL_NOT_VERIFIED_AGAINST_TEXT"
  });
}

// ---------------------------------------------------------------------------
// proposeConstraintModel
// ---------------------------------------------------------------------------

const REPLY_REQUIRED = ["variables", "constraints", "question", "assumptions"];
const REPLY_OPTIONAL = ["objective", "clarification_needed"];

/**
 * Natural-language bounded constraint problem -> structured model PROPOSAL.
 * The provider reply is untrusted data; the deterministic part of this
 * function is validation + rendering only. There is no NL parser here.
 *
 * Statuses: MODEL_PROPOSED | NEEDS_CLARIFICATION | UNKNOWN.
 * BLOCKED_PROVIDER (no API key / no fetch) is THROWN, callers decide whether
 * to skip; provider HTTP/network/JSON failures and structurally rejected
 * replies become status UNKNOWN with the recorded issues.
 *
 * @param {{text?: any, provider?: any}} args
 * @returns {Promise<any>}
 */
export async function proposeConstraintModel(args = {}) {
  if (!isObject(args)) throw new WorkflowError("NL_INPUT_INVALID", "args must be a plain object");
  if (typeof args.text !== "string") throw new WorkflowError("NL_TEXT_INVALID", "text must be a string");
  const originalText = canonicalProblemText(args.text);
  const bytes = Buffer.byteLength(originalText, "utf8");
  if (bytes > NL_CAPS.maxTextBytes)
    throw new WorkflowError("NL_TEXT_OVERSIZED", "problem text exceeds the NL-model byte cap", { bytes, max: NL_CAPS.maxTextBytes });
  const prov = normalizeProvider(args.provider);

  const prompt = Object.freeze({
    schema: NL_MODEL_PROPOSAL_SCHEMA,
    role: "TRANSLATION_PROPOSAL_ONLY",
    original_text: originalText,
    caps: {
      max_vars: NL_CAPS.maxVars, max_constraints: NL_CAPS.maxConstraints,
      max_coeff_abs: NL_CAPS.maxCoeffAbs, max_bound_abs: NL_CAPS.maxBoundAbs
    }
  });
  const promptSha = sha256Canonical(prompt);

  /** @type {any} */
  let reply = null;
  let responseSha = null;
  try {
    reply = await prov.fn(prompt);
    responseSha = sha256Canonical(reply);
  } catch (e) {
    if (e instanceof WorkflowError && e.code === "BLOCKED_PROVIDER") throw e;
    // provider transport failure (HTTP/network/timeout/JSON): status UNKNOWN.
    return unknownResult({
      originalText, provider: prov, promptSha, responseSha: null,
      reason: e instanceof WorkflowError ? "PROVIDER_FAILED:" + e.code : "PROVIDER_FAILED",
      issues: [String(e && e.message || e).slice(0, 200)]
    });
  }

  if (!isObject(reply))
    return unknownResult({ originalText, provider: prov, promptSha, responseSha, reason: "REPLY_NOT_OBJECT", issues: ["reply is not a JSON object"] });
  const keys = Object.keys(reply);
  /** @type {string[]} */
  const envelopeIssues = [];
  for (const k of keys) if (!REPLY_REQUIRED.includes(k) && !REPLY_OPTIONAL.includes(k)) envelopeIssues.push("unexpected_field:" + k);
  for (const k of REPLY_REQUIRED) if (!keys.includes(k)) envelopeIssues.push("missing_field:" + k);

  // Clarification branch BEFORE full model validation: the provider was
  // instructed to return an (empty) envelope plus its questions when the text
  // is not a bounded finite constraint problem.
  const clarification = reply.clarification_needed;
  if (Array.isArray(clarification) && clarification.length > 0) {
    /** @type {string[]} */
    const clIssues = [];
    const questions = boundedStrings(clarification, NL_CAPS.maxClarifications, NL_CAPS.maxClarificationChars, clIssues, "clarification_needed");
    if (questions.length > 0 && clIssues.length === 0) {
      return {
        schema: NL_MODEL_PROPOSAL_SCHEMA,
        status: "NEEDS_CLARIFICATION",
        original_text: originalText,
        original_text_sha256: sha256Text(originalText),
        provider: { name: prov.name, model: prov.model },
        prompt_sha256: promptSha,
        response_sha256: responseSha,
        model: null,
        rendering: null,
        clarification_needed: questions,
        assumptions: [],
        issues: null,
        review: { approved: false },
        honesty_note: "translation proposal requires user clarification; nothing was rendered or executed",
        proposal_sha256: null
      };
    }
  }
  if (envelopeIssues.length)
    return unknownResult({ originalText, provider: prov, promptSha, responseSha, reason: "ENVELOPE_REJECTED", issues: envelopeIssues });

  let model;
  try {
    model = validateStructuredModel(reply);
  } catch (e) {
    if (e instanceof WorkflowError && e.code === "NL_MODEL_INVALID")
      return unknownResult({ originalText, provider: prov, promptSha, responseSha, reason: "MODEL_REJECTED", issues: e.details.issues });
    throw e;
  }

  const rendering = renderSmtArtifact(model, "plan");
  const core = {
    original_text: originalText,
    provider: { name: prov.name, model: prov.model },
    prompt_sha256: promptSha,
    response_sha256: responseSha,
    model,
    rendering
  };
  return {
    schema: NL_MODEL_PROPOSAL_SCHEMA,
    status: "MODEL_PROPOSED",
    ...core,
    original_text_sha256: sha256Text(originalText),
    clarification_needed: null,
    assumptions: model.assumptions,
    issues: null,
    review: { approved: false },
    honesty_note: "TRANSLATION PROPOSAL: the structured model is unverified against the text; a human must review it. Render validity does not imply translation fidelity.",
    proposal_sha256: sha256Canonical(core)
  };
}

function unknownResult({ originalText, provider, promptSha, responseSha, reason, issues }) {
  return {
    schema: NL_MODEL_PROPOSAL_SCHEMA,
    status: "UNKNOWN",
    original_text: originalText,
    original_text_sha256: sha256Text(originalText),
    provider: { name: provider.name, model: provider.model },
    prompt_sha256: promptSha,
    response_sha256: responseSha,
    reason,
    issues,
    model: null,
    rendering: null,
    clarification_needed: null,
    assumptions: [],
    review: { approved: false },
    honesty_note: "no usable translation proposal; nothing was rendered or executed",
    proposal_sha256: null
  };
}

// ---------------------------------------------------------------------------
// Approval gate: the ONLY path from proposal to plan.
// ---------------------------------------------------------------------------

/**
 * Explicit user decision on a MODEL_PROPOSED proposal.
 *   approved === true                    -> USER_APPROVED record (plan-eligible)
 *   approved === false                   -> USER_REJECTED record (final, no throw)
 *   edited (optional object)             -> replaces the structured model; the
 *                                           edited model is re-validated and
 *                                           re-rendered and the approval
 *                                           records the edit.
 *   lpRelaxationAcknowledged (optional)  -> R3 fail-closed LP gate. When the
 *                                           FINAL (possibly edited) model has
 *                                           question "optimize" and this is
 *                                           not exactly true, approval returns
 *                                           the restricted record
 *                                           UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION
 *                                           (plan: null, never plan-eligible):
 *                                           there is no exact integer
 *                                           execution operation, only the
 *                                           continuous LP relaxation. With
 *                                           exactly true, the approval records
 *                                           the canonical acknowledgement
 *                                           hash-covered at
 *                                           review.lp_relaxation_ack.
 * Anything but a MODEL_PROPOSED proposal throws NL_NOT_APPROVABLE; a tampered
 * proposal (proposal_sha256 mismatch) throws NL_TAMPERED.
 * @param {any} proposal
 * @param {{approved?: boolean, edited?: any, reviewer?: string, note?: string,
 *          lpRelaxationAcknowledged?: boolean}} decision
 * @returns {any}
 */
export function approveModel(proposal, decision = {}) {
  if (!isObject(proposal) || proposal.schema !== NL_MODEL_PROPOSAL_SCHEMA)
    throw new WorkflowError("NL_PROPOSAL_INVALID", "proposal must be a proposeConstraintModel result");
  if (typeof decision.approved !== "boolean")
    throw new WorkflowError("NL_APPROVAL_INVALID", "decision.approved must be a boolean");
  // Explicit rejection is always available; approval is restricted to
  // MODEL_PROPOSED. NEEDS_CLARIFICATION / UNKNOWN records cannot be approved
  // (nothing was proposed), but the user may explicitly reject them.
  if (proposal.status !== "MODEL_PROPOSED") {
    if (decision.approved === false)
      return {
        schema: NL_MODEL_APPROVED_SCHEMA, status: "USER_REJECTED",
        original_text: proposal.original_text ?? null, proposal_sha256: null,
        review: { approved: false, edited: false, rejected: true, status_was: proposal.status }
      };
    throw new WorkflowError("NL_NOT_APPROVABLE", "only MODEL_PROPOSED proposals can be approved", { status: proposal.status });
  }
  const core = {
    original_text: proposal.original_text,
    provider: proposal.provider,
    prompt_sha256: proposal.prompt_sha256,
    response_sha256: proposal.response_sha256,
    model: proposal.model,
    rendering: proposal.rendering
  };
  if (proposal.proposal_sha256 !== sha256Canonical(core))
    throw new WorkflowError("NL_TAMPERED", "proposal_sha256 does not cover the recorded proposal core");

  if (decision.approved === false)
    return {
      schema: NL_MODEL_APPROVED_SCHEMA, status: "USER_REJECTED",
      original_text: proposal.original_text, proposal_sha256: proposal.proposal_sha256,
      review: { approved: false, edited: false, rejected: true }
    };

  let model = proposal.model;
  let rendering = proposal.rendering;
  let edited = false;
  if (decision.edited !== undefined) {
    model = validateStructuredModel(decision.edited);
    rendering = renderSmtArtifact(model, "plan");
    edited = true;
  }
  // R3 fail-closed LP gate: the FINAL model (after any edit) with question
  // "optimize" has every variable integer-declared, but the only execution
  // operation is the continuous LP relaxation (integrality dropped). Without
  // the explicit acknowledgement there is no exact-integer operation to run,
  // so approval must NOT yield a plan-eligible record — return the restricted
  // unsupported result instead of silently degrading to the relaxation.
  if (model.question === "optimize" && decision.lpRelaxationAcknowledged !== true)
    return unsupportedIntegerRecord(proposal, model, edited);
  // Review metadata (who approved, on what grounds) is part of the APPROVAL
  // and therefore hash-covered — post-hoc mutation of the approved record is
  // rejected by buildPlanFromApprovedModel's integrity recheck.
  const review = { approved: true, edited };
  if (model.question === "optimize")
    review.lp_relaxation_ack = nlLpRelaxationAckRecord();
  if (typeof decision.reviewer === "string" && decision.reviewer.trim())
    review.reviewer = decision.reviewer.trim().slice(0, 256);
  if (typeof decision.note === "string" && decision.note.trim())
    review.note = decision.note.trim().slice(0, 256);
  const approvedCore = {
    schema: NL_MODEL_APPROVED_SCHEMA, status: "USER_APPROVED",
    original_text: proposal.original_text,
    original_text_sha256: sha256Text(proposal.original_text),
    provider: proposal.provider,
    proposal_sha256: proposal.proposal_sha256,
    provenance: {
      prompt_sha256: proposal.prompt_sha256,
      response_sha256: proposal.response_sha256,
      status_before_approval: proposal.status
    },
    model, rendering, review
  };
  return { ...approvedCore, approved_sha256: sha256Canonical(approvedCore) };
}

/**
 * R3 restricted unsupported result for an approved integer optimize model
 * without an explicit LP-relaxation acknowledgement. Returned (never thrown)
 * so callers can inspect the verdict; it is NOT plan-eligible —
 * buildPlanFromApprovedModel rejects it with NL_NOT_APPROVED, and no plan is
 * ever produced from it.
 * @param {any} proposal
 * @param {any} model final validated structured model (question "optimize")
 * @param {boolean} edited
 * @returns {any}
 */
function unsupportedIntegerRecord(proposal, model, edited) {
  return {
    schema: NL_MODEL_APPROVED_SCHEMA,
    status: NL_UNSUPPORTED_EXACT_INTEGER,
    original_text: proposal.original_text,
    proposal_sha256: proposal.proposal_sha256,
    question: "optimize",
    edited,
    model,
    unsupported: {
      code: NL_UNSUPPORTED_EXACT_INTEGER,
      reason: "LP_RELAXATION_NOT_ACKNOWLEDGED",
      dropped: ["integrality"],
      available_operation: "highs/solve-lp (continuous LP relaxation only; no integer MIP typed operation)",
      required_decision_field: "lpRelaxationAcknowledged",
      remedies: [
        "re-approve with lpRelaxationAcknowledged: true to explicitly accept the LP relaxation (results then characterize the continuous relaxation only)",
        "wait for a future integer MIP typed operation adapter"
      ]
    },
    detail: NL_INTEGER_OPTIMIZATION_UNSUPPORTED_NOTE,
    review: { approved: false, edited, rejected: false, unsupported: true },
    plan: null,
    honesty_note: "fail-closed: no plan was produced and the LP relaxation was not presented as an integer optimum"
  };
}

/**
 * Approved record -> typed ExecutionPlan. The plan's problem embeds the FULL
 * provenance chain (original text + structured model + rendering) as a second
 * requirement, so plan.source.problem_sha256 and every step input hash bind
 * that chain. Re-validated on entry: schema/status/integrity/ack/render drift.
 *
 * Target mapping (deterministic): question "sat" -> SMT plan
 * (z3 + cvc5 + cross-check), question "optimize" -> LP plan (HiGHS). An
 * explicit options.target must match.
 *
 * R3 LP relaxation contract: the plan envelope is frozen (no metadata slot),
 * so machine-readable relaxation metadata lives (a) on the returned wrapper
 * field `relaxation` (null for the smt target), (b) hash-covered at
 * approved.review.lp_relaxation_ack, and (c) INSIDE the plan as an
 * additional canonical-JSON-string assumption (nlLpRelaxationPlanAssumption).
 * An optimize model whose approval lacks the exact canonical
 * lp_relaxation_ack is rejected fail-closed with
 * UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION — hand-carried records included.
 * @param {any} approved
 * @param {{target?: "smt"|"lp"}} [options]
 * @returns {any}
 */
export function buildPlanFromApprovedModel(approved, options = {}) {
  if (!isObject(approved) || approved.schema !== NL_MODEL_APPROVED_SCHEMA)
    throw new WorkflowError("NL_NOT_APPROVED", "an approveModel USER_APPROVED record is required");
  if (approved.status !== "USER_APPROVED" || approved.review?.approved !== true)
    throw new WorkflowError("NL_NOT_APPROVED", "the user approval gate has not granted this model", { status: approved.status });
  const approvedCore = {
    schema: approved.schema, status: approved.status,
    original_text: approved.original_text,
    original_text_sha256: approved.original_text_sha256,
    provider: approved.provider,
    proposal_sha256: approved.proposal_sha256,
    provenance: approved.provenance,
    model: approved.model,
    rendering: approved.rendering,
    review: approved.review
  };
  if (approved.approved_sha256 !== sha256Canonical(approvedCore))
    throw new WorkflowError("NL_TAMPERED", "approved_sha256 does not cover the approved record");
  // R3 fail-closed ack gate (defense in depth for hand-carried records with a
  // self-consistent hash): an optimize model is plan-eligible only with the
  // exact canonical LP-relaxation acknowledgement.
  if (approved.model.question === "optimize" && !isCanonicalLpRelaxationAck(approved.review?.lp_relaxation_ack))
    throw new WorkflowError(NL_UNSUPPORTED_EXACT_INTEGER,
      "integer optimize model without the explicit LP-relaxation acknowledgement " +
      "(review.lp_relaxation_ack must equal the canonical record; approveModel writes it " +
      "iff decision.lpRelaxationAcknowledged === true): no exact integer execution " +
      "operation exists, only the continuous LP relaxation");
  // Render drift: the stored rendering must equal a fresh render of the
  // stored model (guards edited/hand-carried approved records).
  const fresh = renderSmtArtifact(approved.model, "plan");
  if (fresh.text !== approved.rendering.text || fresh.sha256 !== approved.rendering.sha256)
    throw new WorkflowError("NL_RENDER_DRIFT", "stored rendering does not match the approved model");

  const target = options.target ?? NL_PLAN_TARGETS[approved.model.question];
  if (target !== NL_PLAN_TARGETS[approved.model.question])
    throw new WorkflowError("NL_TARGET_MISMATCH", "target does not match the approved question",
      { question: approved.model.question, expected: NL_PLAN_TARGETS[approved.model.question], target });

  const provenance = {
    original_text: approved.original_text,
    structured_model: approved.model,
    rendering: approved.rendering
  };
  const provenanceJson = canonicalJson(provenance);
  const provenanceSha = sha256Text(provenanceJson);

  const assumptions = [...approved.model.assumptions];
  const capabilityIds = target === "lp" ? ["opt.numerical"] : ["logic.smt"];
  if (target === "lp") {
    assumptions.push(NL_LP_RELAXATION_ASSUMPTION);
    assumptions.push(nlLpRelaxationPlanAssumption());
  }
  // R3 machine-readable relaxation metadata on the wrapper (the plan envelope
  // schema is frozen; the same metadata also rides INSIDE the plan as the
  // canonical JSON-string assumption pushed above).
  const relaxation = target === "lp"
    ? {
        kind: NL_LP_RELAXATION_ONLY,
        dropped: ["integrality"],
        meaning: NL_LP_RELAXATION_ASSUMPTION,
        effect: "plan results characterize the continuous LP relaxation only; " +
          "the optimal value is a bound for the integer problem, not its exact optimum",
        ack: approved.review.lp_relaxation_ack
      }
    : null;

  const normalized = normalizeUserProblem(approved.original_text, {
    assumptions, problemKind: NL_PROBLEM_KIND, capabilityIds
  });
  const problem = structuredClone(normalized.problem);
  problem.source_refs.push({
    id: "nl-model-provenance", sha256: provenanceSha, classification: "PUBLIC",
    purpose: "translation-proposal provenance: original text, structured model, rendering",
    consumer: "formal_tools"
  });
  problem.requirements.push({ id: "r2", source_ref: "nl-model-provenance", text: provenanceJson });
  const checked = validateProblemSpec(problem);
  if (!checked.ok)
    throw new WorkflowError("NL_PROVENANCE_INVALID", "provenance-enriched problem is not a valid ProblemSpec", { errors: checked.errors });

  let method, steps;
  if (target === "smt") {
    method = {
      schema: "formal-tools/method-proposal/0.1",
      method_id: "nlmodelsmt01",
      problem_id: problem.problem_id,
      goal_claim_ids: ["claim1"],
      oracle_ids: ["heldout"],
      semantic_review: "PENDING",
      steps: [
        { id: "step-z3", tool_id: "z3", operation: "solve", claim_ids: ["claim1"], provides: ["logic.smt"],
          depends_on: [], source_refs: ["user-problem-text"], estimated_cost_units: 1, timeout_ms: 30000,
          destination: "LOCAL", output_classification: "PUBLIC" },
        { id: "step-cvc5", tool_id: "cvc5", operation: "solve", claim_ids: ["claim1"], provides: ["logic.smt"],
          depends_on: ["step-z3"], source_refs: ["user-problem-text"], estimated_cost_units: 1, timeout_ms: 30000,
          destination: "LOCAL", output_classification: "PUBLIC" }
      ]
    };
    const smt = { smt_lib: approved.rendering.text };
    const compare = {
      id: "step-agree", tool: "compare", operation: "cross-check",
      depends_on: ["step-z3", "step-cvc5"],
      input: { left_step: "step-z3", right_step: "step-cvc5", agree_on: ["sat", "unsat"] },
      timeout_s: 5, expected_output_kind: "cross-tool-verdict"
    };
    steps = stepsFromMethod(method, { "step-z3": smt, "step-cvc5": { smt_lib: approved.rendering.text } }, { compareSteps: [compare] });
  } else {
    const lp = renderLpModel(approved.model);
    method = {
      schema: "formal-tools/method-proposal/0.1",
      method_id: "nlmodellp01",
      problem_id: problem.problem_id,
      goal_claim_ids: ["claim1"],
      oracle_ids: ["heldout"],
      semantic_review: "PENDING",
      steps: [
        { id: "step-highs", tool_id: "highs", operation: "UNRESOLVED", claim_ids: ["claim1"], provides: ["opt.numerical"],
          depends_on: [], source_refs: ["user-problem-text"], estimated_cost_units: 1, timeout_ms: 30000,
          destination: "LOCAL", output_classification: "PUBLIC" }
      ]
    };
    steps = stepsFromMethod(method, { "step-highs": lp });
  }

  const plan = buildExecutionPlan({ problem, method, steps, assumptions, problemKind: NL_PROBLEM_KIND });
  return {
    schema: PLAN_SCHEMA,
    target,
    plan,
    problem,
    method,
    provenance_sha256: provenanceSha,
    question: approved.model.question,
    relaxation
  };
}
