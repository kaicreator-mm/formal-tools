/**
 * Issue #182 (i180/V2): LLM Method DAG -> typed ExecutionPlan layer.
 *
 * Everything an LLM proposes is UNTRUSTED DATA. This module is planning and
 * static validation ONLY: it never launches processes, executes tools, opens
 * network sockets on its own or promotes Solutions. The only network path is
 * the injected DeepSeek chat provider, which carries an explicitly approved
 * public payload through proposeMethod()'s egress authority gate.
 *
 * ExecutionPlan schema "formal-tools/execution-plan/1.0" is the frozen V0
 * cross-lane contract (see docs/mvp/EXECUTION_PLAN_CONTRACT.md). Plan output
 * is always tool_execution NOT_RUN; execution belongs to V3's
 * workflow-executor.mjs via the compiled launcher.
 */
import { createHash } from "node:crypto";
import { validateProblemSpec, assessMethod } from "./method-planner.mjs";
import { planPortfolioOperation } from "./tool-portfolio-t4.mjs";

export const PLAN_SCHEMA = "formal-tools/execution-plan/1.0";
export const LAUNCHER_MANIFEST_SCHEMA = "formal-tools/launcher-manifest/1.0";
export const PROBLEM_SPEC_SCHEMA = "formal-tools/problem-spec/0.1";
export const METHOD_PROPOSAL_SCHEMA = "formal-tools/method-proposal/0.1";

/** Hard transport and budget caps for the V0 MVP contract. */
export const CAPS = Object.freeze({
  problemTextBytes: 65536,
  assumptionItems: 32,
  assumptionChars: 512,
  smtLibBytes: 65536,
  lpModelBytes: 65536,
  planJsonBytes: 262144,
  maxSteps: 8,
  maxStepTimeoutS: 120,
  maxTotalTimeoutS: 120,
  problemKindChars: 128
});

/**
 * Frozen typed-operation allowlist. method_operation is the ONLY method-step
 * operation that may be promoted to the typed plan operation; compare steps
 * are executor-side and have no method counterpart (method_operation null).
 */
const OP_ALLOWLIST = Object.freeze({
  z3: Object.freeze({
    "solve-smt": Object.freeze({ expected_output_kind: "smt-answer", method_operation: "solve" })
  }),
  cvc5: Object.freeze({
    "solve-smt": Object.freeze({ expected_output_kind: "smt-answer", method_operation: "solve" })
  }),
  highs: Object.freeze({
    "solve-lp": Object.freeze({ expected_output_kind: "lp-status", method_operation: "UNRESOLVED" })
  }),
  compare: Object.freeze({
    "cross-check": Object.freeze({ expected_output_kind: "cross-tool-verdict", method_operation: null })
  })
});

const COMPARE_AGREE_ON = Object.freeze(["sat", "unsat", "optimal-status"]);
const idPattern = /^[a-z][a-z0-9_.-]{0,79}$/;
const hexPattern = /^[a-f0-9]{64}$/;
const planIdPattern = /^wf-[a-f0-9]{32}$/;
const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);
const hasOnly = (obj, names) => isObject(obj) && Object.keys(obj).every(k => names.includes(k));
const finiteInt = (x, low, high) => Number.isSafeInteger(x) && x >= low && x <= high;

/** Reject with a precise, stable machine code. Messages never carry secrets. */
export class WorkflowError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {any} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit order (default
 * Array#sort), arrays keep order, JSON.stringify output. Machine-independent
 * (never localeCompare) so hashes and launcher bytes are stable across hosts.
 * @param {any} value
 * @returns {string}
 */
export function canonicalJson(value) {
  const seen = new WeakSet();
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      if (seen.has(v)) throw new WorkflowError("PLAN_SCHEMA_INVALID", "cyclic structure cannot be canonicalized");
      if (typeof v.toJSON === "function") throw new WorkflowError("PLAN_SCHEMA_INVALID", "values with toJSON are not canonical JSON-safe");
      seen.add(v);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      seen.delete(v);
      return out;
    }
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint")
      throw new WorkflowError("PLAN_SCHEMA_INVALID", "value is not JSON-safe: " + typeof v);
    return v;
  };
  return JSON.stringify(walk(value));
}

/** sha256 (hex) over canonical JSON of a value. */
export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** sha256 (hex) over raw UTF-8 text. */
export function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Canonical problem text: NFC normalize, unify CRLF/CR to LF, trim outer
 * whitespace. This exact rule is the hash domain of the user statement.
 * @param {any} text
 * @returns {string}
 */
export function canonicalProblemText(text) {
  if (typeof text !== "string") throw new WorkflowError("PLAN_SCHEMA_INVALID", "problem text must be a string");
  return text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

/**
 * Validate the assumptions list against CAPS. Returns a defensive copy.
 * @param {any} assumptions
 * @returns {string[]}
 */
function checkedAssumptions(assumptions) {
  if (!Array.isArray(assumptions)) throw new WorkflowError("PLAN_SCHEMA_INVALID", "assumptions must be an array of strings");
  if (assumptions.length > CAPS.assumptionItems)
    throw new WorkflowError("PLAN_OVERSIZED", "too many assumptions", { count: assumptions.length, max: CAPS.assumptionItems });
  for (const a of assumptions) {
    if (typeof a !== "string") throw new WorkflowError("PLAN_SCHEMA_INVALID", "every assumption must be a string");
    if (a.length > CAPS.assumptionChars)
      throw new WorkflowError("PLAN_OVERSIZED", "assumption exceeds character cap", { max: CAPS.assumptionChars });
  }
  return [...assumptions];
}

/**
 * Bounded user statement -> ProblemSpec-compatible problem (validateProblemSpec
 * is the acceptance oracle). Assumptions are plan-level metadata; the frozen
 * ProblemSpec schema has no assumptions slot, so they never enter the problem.
 * @param {any} text
 * @param {{assumptions?: string[], problemKind?: string, capabilityIds?: string[]}} [options]
 */
export function normalizeUserProblem(text, options = {}) {
  const canonical = canonicalProblemText(text);
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (bytes > CAPS.problemTextBytes)
    throw new WorkflowError("PLAN_OVERSIZED", "canonical problem text exceeds byte cap", { bytes, max: CAPS.problemTextBytes });
  const assumptions = checkedAssumptions(options.assumptions ?? []);
  const problemKind = options.problemKind ?? "user_problem";
  if (typeof problemKind !== "string" || !problemKind || problemKind.length > CAPS.problemKindChars)
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "problemKind must be a non-empty string of at most " + CAPS.problemKindChars + " chars");
  const capabilityIds = options.capabilityIds ?? ["logic.smt"];
  if (!Array.isArray(capabilityIds) || !capabilityIds.length || capabilityIds.some(c => typeof c !== "string" || !idPattern.test(c)))
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "capabilityIds must be a non-empty array of registry capability ids");
  const problemSha = sha256Text(canonical);
  const statement = canonical.length > 0 ? canonical : "(empty problem statement)";
  const problem = {
    schema: PROBLEM_SPEC_SCHEMA,
    problem_id: "user." + problemSha.slice(0, 16),
    source_refs: [{
      id: "user-problem-text", sha256: problemSha, classification: "PUBLIC",
      purpose: "canonical user problem statement", consumer: "formal_tools"
    }],
    requirements: [{ id: "r1", source_ref: "user-problem-text", text: statement }],
    claims: [{
      id: "claim1", text: statement, kind: "bounded_model", requirement_ids: ["r1"],
      source_refs: ["user-problem-text"], capability_ids: [...capabilityIds]
    }],
    oracles: [{
      id: "heldout", source_ref: "user-problem-text", frozen: true,
      positive_case_ids: ["positive-case"], negative_case_ids: ["negative-case"],
      review_identity: "independent_reviewer"
    }],
    capability_ids: [...capabilityIds],
    budget: { max_steps: CAPS.maxSteps, max_depth: CAPS.maxSteps, max_cost_units: 1000, max_total_time_ms: 120000, max_retries: 0 },
    policy: {
      allowed_tools: ["z3", "cvc5", "highs"],
      allowed_operations: { z3: ["solve"], cvc5: ["solve"], highs: [] },
      destination: "LOCAL", max_input_classification: "PUBLIC", allow_network: false
    }
  };
  const checked = validateProblemSpec(problem);
  if (!checked.ok) {
    const oversize = checked.errors.some(e => /transport limit|structural budget/.test(e));
    throw new WorkflowError(oversize ? "PLAN_OVERSIZED" : "PLAN_SCHEMA_INVALID",
      "normalized problem is not a valid ProblemSpec", { errors: checked.errors });
  }
  return { problem, canonical_text: canonical, problem_sha256: problemSha, assumptions, problem_kind: problemKind };
}

const SYSTEM_PROMPT = [
  "You are the planning module of the formal-tools runner. You PROPOSE a method; you have no execution authority.",
  "Reply with STRICT JSON only (no markdown, no commentary): exactly one JSON object.",
  "The object must have exactly these fields:",
  '{"schema":"formal-tools/method-proposal/0.1","method_id":"<lowercase id>","problem_id":"<copy problem.problem_id exactly>",',
  ' "goal_claim_ids":["<ids of problem.claims whose kind is not external_fact/not_formalizable>"],',
  ' "oracle_ids":["<copy every problem.oracles id>"],"semantic_review":"PENDING",',
  ' "steps":[{"id":"<lowercase id>","tool_id":"<from candidates[].id>","operation":"<from that candidate\'s allowed_operations>",',
  '  "claim_ids":["<goal claim ids this step helps check>"],"provides":["<capability ids from that candidate>"],',
  '  "depends_on":["<earlier step ids>"],"source_refs":["user-problem-text"],"estimated_cost_units":1,"timeout_ms":30000,',
  '  "destination":"LOCAL","output_classification":"PUBLIC"}]}',
  "Rules: never invent tool ids, operations or capability ids; never add fields; every checkable claim's capability_ids must be provided by at least one step; source_refs is always [\"user-problem-text\"].",
  "For a two-solver agreement question propose two solver steps (one per solver candidate) with independent first step and the second step depending on the first."
].join("\n");

/**
 * DeepSeek chat provider adapter compatible with proposeMethod(problem,
 * generate, egressAuthority): generate(prompt) resolves to a bounded JSON
 * object parsed from the model's reply. The API key is read from the env by
 * default, is sent ONLY in the Authorization header and never appears in
 * error messages, details or logs. Single attempt; caller decides retries.
 * @param {{apiKey?: string, baseUrl?: string, model?: string, fetchImpl?: any, timeoutMs?: number, proxyAgent?: any}} [options]
 */
export function makeDeepSeekChatProvider(options = {}) {
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.DEEPSEEK_API_KEY;
  const baseUrl = String(options.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const model = String(options.model ?? "deepseek-chat");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = finiteInt(options.timeoutMs, 1, 600000) ? options.timeoutMs : 60000;
  const proxyAgent = options.proxyAgent;
  let lastProposal = null;
  if (typeof fetchImpl !== "function")
    throw new WorkflowError("BLOCKED_PROVIDER", "no fetch implementation available");
  /** @param {any} prompt */
  const generate = async prompt => {
    if (typeof apiKey !== "string" || apiKey.length === 0)
      throw new WorkflowError("BLOCKED_PROVIDER", "DEEPSEEK_API_KEY is not set; callers decide to skip");
    const body = {
      model, temperature: 0, max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(prompt) }
      ]
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (typeof fetchImpl !== "function") throw new WorkflowError("BLOCKED_PROVIDER", "no fetch implementation available");
      const init = {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + apiKey },
        body: JSON.stringify(body),
        signal: controller.signal
      };
      if (proxyAgent !== undefined) init.dispatcher = proxyAgent;
      const res = await fetchImpl(baseUrl + "/chat/completions", init);
      if (res.status !== 200)
        throw new WorkflowError("PROVIDER_FAILED", "deepseek chat completions request failed", { http_status: res.status });
      const payload = await res.json();
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message ?
        payload.choices[0].message.content : null;
      if (typeof content !== "string" || content.length === 0)
        throw new WorkflowError("PROVIDER_FAILED", "provider reply has no message content", { reason: "invalid_response_shape" });
      let proposal;
      try {
        proposal = JSON.parse(content);
      } catch {
        const start = content.indexOf("{"), end = content.lastIndexOf("}");
        if (start < 0 || end <= start)
          throw new WorkflowError("PROVIDER_FAILED", "provider reply is not JSON", { reason: "invalid_json" });
        try { proposal = JSON.parse(content.slice(start, end + 1)); }
        catch { throw new WorkflowError("PROVIDER_FAILED", "provider reply is not JSON", { reason: "invalid_json" }); }
      }
      if (!isObject(proposal))
        throw new WorkflowError("PROVIDER_FAILED", "provider reply is not a JSON object", { reason: "not_object" });
      lastProposal = proposal;
      return proposal;
    } catch (e) {
      if (e instanceof WorkflowError) throw e;
      if (controller.signal.aborted)
        throw new WorkflowError("PROVIDER_FAILED", "provider call timed out", { reason: "timeout", timeout_ms: timeoutMs });
      throw new WorkflowError("PROVIDER_FAILED", "provider network failure", { reason: "network" });
    } finally {
      clearTimeout(timer);
    }
  };
  return Object.freeze({
    generate, model, baseUrl,
    /** The last successfully parsed proposal (untrusted data), or null. */
    getProposal() { return lastProposal; }
  });
}

/**
 * Map a method proposal step (untrusted, already admitted by assessMethod)
 * to a typed plan step. inputsByStepId is TRUSTED caller data: concrete
 * {smt_lib} / LP model payloads keyed by method step id. compareSteps are
 * appended verbatim (executor-side steps; validated downstream).
 * @param {any} method
 * @param {Record<string, any>} inputsByStepId
 * @param {{compareSteps?: any[]}} [options]
 */
export function stepsFromMethod(method, inputsByStepId, options = {}) {
  if (!isObject(method) || !Array.isArray(method.steps))
    throw new WorkflowError("PLAN_METHOD_INVALID", "method proposal with steps array required");
  if (!isObject(inputsByStepId))
    throw new WorkflowError("PLAN_INPUT_INVALID", "inputsByStepId must be an object keyed by step id");
  const compareSteps = options.compareSteps ?? [];
  if (!Array.isArray(compareSteps)) throw new WorkflowError("PLAN_INPUT_INVALID", "compareSteps must be an array");
  const out = [];
  for (const s of method.steps) {
    if (!isObject(s) || typeof s.id !== "string" || typeof s.tool_id !== "string" || typeof s.operation !== "string")
      throw new WorkflowError("PLAN_METHOD_INVALID", "malformed method step record");
    const entry = Object.entries(OP_ALLOWLIST).find(([tool, ops]) =>
      Object.values(/** @type {any} */ (ops)).some(op => op.method_operation === s.operation && tool === s.tool_id));
    if (!entry)
      throw new WorkflowError("PLAN_UNKNOWN_OPERATION",
        "no typed plan operation admits method operation " + s.operation + " on tool " + s.tool_id);
    const [tool, ops] = entry;
    const planOperation = Object.keys(/** @type {any} */ (ops)).find(op => /** @type {any} */ (ops)[op].method_operation === s.operation);
    const input = inputsByStepId[s.id];
    if (!isObject(input))
      throw new WorkflowError("PLAN_INPUT_INVALID", "missing trusted input payload for method step " + s.id);
    const spec = /** @type {any} */ (/** @type {any} */ (ops)[planOperation]);
    out.push({
      id: s.id, tool, operation: planOperation,
      depends_on: Array.isArray(s.depends_on) ? [...s.depends_on] : [],
      input, input_sha256: sha256Canonical(input),
      timeout_s: Math.max(1, Math.round((typeof s.timeout_ms === "number" ? s.timeout_ms : 0) / 1000)),
      expected_output_kind: spec.expected_output_kind
    });
  }
  for (const c of compareSteps) out.push(structuredClone(c));
  return out;
}

/**
 * Validate one typed step input against the op-specific validator.
 * Returns {refs?: {left_step, right_step}, timeoutCapS?: number}.
 * @param {string} tool
 * @param {string} operation
 * @param {any} input
 */
function validateStepInput(tool, operation, input) {
  if (!isObject(input)) throw new WorkflowError("PLAN_INPUT_INVALID", "step input must be a plain object");
  if (tool === "z3" || tool === "cvc5") {
    if (!hasOnly(input, ["smt_lib"])) throw new WorkflowError("PLAN_INPUT_INVALID", tool + " input must be exactly {smt_lib}");
    if (typeof input.smt_lib !== "string" || input.smt_lib.length === 0)
      throw new WorkflowError("PLAN_INPUT_INVALID", "smt_lib must be a non-empty string");
    const bytes = Buffer.byteLength(input.smt_lib, "utf8");
    if (bytes > CAPS.smtLibBytes)
      throw new WorkflowError("PLAN_OVERSIZED", "smt_lib exceeds byte cap", { bytes, max: CAPS.smtLibBytes });
    return {};
  }
  if (tool === "highs") {
    // Mirror the tool-portfolio-t4 HiGHS validator exactly by delegating to
    // its pure planning entry (validation only; nothing is executed).
    let planned;
    try {
      planned = planPortfolioOperation("highs", "solve-lp", input);
    } catch (e) {
      if (e instanceof RangeError)
        throw new WorkflowError("PLAN_OVERSIZED", "highs model exceeds portfolio size limit", { reason: String(e && e.message || e) });
      throw new WorkflowError("PLAN_INPUT_INVALID", "highs model rejected by portfolio validator", { reason: String(e && e.message || e) });
    }
    return { timeoutCapS: planned && planned.budget ? planned.budget.max_timeout_s : CAPS.maxStepTimeoutS };
  }
  // compare / cross-check
  if (!hasOnly(input, ["left_step", "right_step", "agree_on"]))
    throw new WorkflowError("PLAN_INPUT_INVALID", "compare input must be exactly {left_step,right_step,agree_on}");
  if (typeof input.left_step !== "string" || !idPattern.test(input.left_step) ||
      typeof input.right_step !== "string" || !idPattern.test(input.right_step))
    throw new WorkflowError("PLAN_INPUT_INVALID", "compare left_step/right_step must be step ids");
  if (input.left_step === input.right_step)
    throw new WorkflowError("PLAN_INPUT_INVALID", "compare operands must be distinct steps");
  if (!Array.isArray(input.agree_on) || !input.agree_on.length ||
      new Set(input.agree_on).size !== input.agree_on.length ||
      input.agree_on.some(x => !COMPARE_AGREE_ON.includes(x)))
    throw new WorkflowError("PLAN_INPUT_INVALID", "agree_on must be unique values from " + COMPARE_AGREE_ON.join("|"));
  return { refs: { left_step: input.left_step, right_step: input.right_step } };
}

/**
 * Full ExecutionPlan validator: the single choke point used by
 * buildExecutionPlan and compilePlan. Throws WorkflowError with precise
 * PLAN_* codes. Returns { plan, canonical }.
 * @param {any} plan
 */
export function validateExecutionPlan(plan) {
  if (!hasOnly(plan, ["schema", "plan_id", "source", "assumptions", "method_dag", "steps", "budgets", "compiled"]))
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "plan envelope has unknown or missing fields");
  if (plan.schema !== PLAN_SCHEMA) throw new WorkflowError("PLAN_SCHEMA_INVALID", "plan schema id mismatch");
  if (typeof plan.plan_id !== "string" || !planIdPattern.test(plan.plan_id))
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "plan_id must match " + planIdPattern.source);
  if (!hasOnly(plan.source, ["problem_sha256", "problem_kind"]) ||
      !hexPattern.test(plan.source.problem_sha256) ||
      typeof plan.source.problem_kind !== "string" || !plan.source.problem_kind ||
      plan.source.problem_kind.length > CAPS.problemKindChars)
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "plan source must be {problem_sha256, problem_kind}");
  checkedAssumptions(plan.assumptions);
  if (!hasOnly(plan.budgets, ["max_steps", "max_total_timeout_s"]))
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "budgets must be exactly {max_steps, max_total_timeout_s}");
  if (!finiteInt(plan.budgets.max_steps, 1, CAPS.maxSteps) ||
      !finiteInt(plan.budgets.max_total_timeout_s, 1, CAPS.maxTotalTimeoutS))
    throw new WorkflowError("PLAN_BUDGET_EXCEEDED", "budgets must be integers within the frozen caps",
      { max_steps: CAPS.maxSteps, max_total_timeout_s: CAPS.maxTotalTimeoutS });
  if (!hasOnly(plan.compiled, ["launcher_sha256", "manifest_sha256"]) ||
      ![plan.compiled.launcher_sha256, plan.compiled.manifest_sha256].every(x => x === null || hexPattern.test(x)))
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "compiled must be {launcher_sha256, manifest_sha256} as null or sha256 hex");

  const steps = plan.steps;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > CAPS.maxSteps)
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "steps must be a non-empty array of at most " + CAPS.maxSteps);
  const byId = new Map();
  let totalTimeout = 0;
  for (const step of steps) {
    if (!isObject(step)) throw new WorkflowError("PLAN_SCHEMA_INVALID", "step record must be an object");
    if (typeof step.id !== "string" || !idPattern.test(step.id))
      throw new WorkflowError("PLAN_SCHEMA_INVALID", "step id must match " + idPattern.source);
    if (byId.has(step.id)) throw new WorkflowError("PLAN_DUP_STEP_ID", "duplicate step id: " + step.id);
    if (!hasOnly(step, ["id", "tool", "operation", "depends_on", "input", "input_sha256", "timeout_s", "expected_output_kind"]))
      throw new WorkflowError("PLAN_SCHEMA_INVALID", "step " + step.id + " has unknown fields");
    byId.set(step.id, step);
    const ops = OP_ALLOWLIST[step.tool];
    if (!ops) throw new WorkflowError("PLAN_UNKNOWN_TOOL", "tool is not on the frozen allowlist: " + String(step.tool));
    const spec = /** @type {any} */ (ops)[step.operation];
    if (!spec) throw new WorkflowError("PLAN_UNKNOWN_OPERATION", "operation is not allowed for tool " + step.tool + ": " + String(step.operation));
    if (step.expected_output_kind !== spec.expected_output_kind)
      throw new WorkflowError("PLAN_INPUT_INVALID", "expected_output_kind must be " + spec.expected_output_kind + " for " + step.tool + "/" + step.operation);
    const extra = validateStepInput(step.tool, step.operation, step.input);
    const hash = sha256Canonical(step.input);
    if (step.input_sha256 !== hash)
      throw new WorkflowError("PLAN_HASH_MISMATCH", "input_sha256 does not match canonical input JSON of step " + step.id,
        { expected: hash, actual: step.input_sha256 });
    if (!finiteInt(step.timeout_s, 1, CAPS.maxStepTimeoutS))
      throw new WorkflowError("PLAN_BUDGET_EXCEEDED", "timeout_s must be an integer in 1.." + CAPS.maxStepTimeoutS + " (step " + step.id + ")");
    if (extra.timeoutCapS !== undefined && step.timeout_s > extra.timeoutCapS)
      throw new WorkflowError("PLAN_BUDGET_EXCEEDED", "step " + step.id + " exceeds the portfolio timeout cap of " + extra.timeoutCapS + "s");
    if (!Array.isArray(step.depends_on))
      throw new WorkflowError("PLAN_SCHEMA_INVALID", "depends_on must be an array (step " + step.id + ")");
    if (step.depends_on.includes(step.id))
      throw new WorkflowError("PLAN_CYCLE", "step " + step.id + " depends on itself");
    totalTimeout += step.timeout_s;
  }
  for (const step of steps) {
    for (const dep of step.depends_on) {
      if (typeof dep !== "string" || !byId.has(dep))
        throw new WorkflowError("PLAN_UNBOUND_DEP", "step " + step.id + " references unknown dependency: " + String(dep));
    }
    const ops = OP_ALLOWLIST[step.tool];
    const spec = /** @type {any} */ (ops)[step.operation];
    if (spec.method_operation === null) {
      // compare / cross-check: operands must exist and appear as dependencies.
      if (!byId.has(step.input.left_step) || !byId.has(step.input.right_step))
        throw new WorkflowError("PLAN_UNBOUND_DEP", "compare operands reference unknown steps: " + step.id);
      for (const ref of [step.input.left_step, step.input.right_step])
        if (!step.depends_on.includes(ref))
          throw new WorkflowError("PLAN_INPUT_INVALID", "compare step " + step.id + " must depend on both operands");
    }
  }
  // Acyclicity (iterative DFS with an on-stack set).
  const state = new Map();
  for (const step of steps) {
    const stack = [[step.id, false]];
    while (stack.length > 0) {
      const [id, leaving] = stack.pop();
      if (leaving) { state.set(id, "done"); continue; }
      if (state.get(id) === "done") continue;
      if (state.get(id) === "visiting") throw new WorkflowError("PLAN_CYCLE", "dependency cycle through step: " + id);
      state.set(id, "visiting");
      stack.push([id, true]);
      for (const dep of /** @type {any} */ (byId.get(id)).depends_on) stack.push([dep, false]);
    }
  }
  if (steps.length > plan.budgets.max_steps)
    throw new WorkflowError("PLAN_BUDGET_EXCEEDED", "step count exceeds budgets.max_steps",
      { steps: steps.length, max_steps: plan.budgets.max_steps });
  if (totalTimeout > plan.budgets.max_total_timeout_s)
    throw new WorkflowError("PLAN_BUDGET_EXCEEDED", "total timeout exceeds budgets.max_total_timeout_s",
      { total_timeout_s: totalTimeout, max_total_timeout_s: plan.budgets.max_total_timeout_s });
  // method_dag mirrors steps 1:1 (internal consistency of the frozen shape).
  const dag = plan.method_dag;
  if (!Array.isArray(dag) || dag.length !== steps.length)
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "method_dag must mirror steps 1:1");
  dag.forEach((entry, i) => {
    if (!hasOnly(entry, ["id", "kind", "depends_on"]))
      throw new WorkflowError("PLAN_SCHEMA_INVALID", "method_dag entry has unknown fields");
    if (entry.id !== steps[i].id) throw new WorkflowError("PLAN_SCHEMA_INVALID", "method_dag order diverges from steps at index " + i);
    if (typeof entry.kind !== "string" || !entry.kind || entry.kind.length > 64)
      throw new WorkflowError("PLAN_SCHEMA_INVALID", "method_dag kind must be a short tag");
    const a = [...entry.depends_on].sort().join("\u0000");
    const b = [...steps[i].depends_on].sort().join("\u0000");
    if (a !== b) throw new WorkflowError("PLAN_SCHEMA_INVALID", "method_dag depends_on diverges from step deps: " + entry.id);
  });
  const canonical = canonicalJson(plan);
  if (Buffer.byteLength(canonical, "utf8") > CAPS.planJsonBytes)
    throw new WorkflowError("PLAN_OVERSIZED", "canonical plan JSON exceeds transport cap", { max: CAPS.planJsonBytes });
  return { plan, canonical };
}

/**
 * Build a typed ExecutionPlan from a bounded problem, an already-admitted
 * method proposal, and trusted typed steps. The method is re-admitted here
 * via assessMethod (LLM output is data, never authority), and every plan
 * step with a registered tool must correspond to its method step (same id,
 * tool and admitting method operation, same dependency set). The returned
 * plan always has compiled = {launcher_sha256:null, manifest_sha256:null}.
 * @param {{problem: any, method: any, steps: any[], assumptions?: string[], budgets?: any, problemKind?: string}} args
 */
export function buildExecutionPlan(args) {
  const { problem, method, steps } = args ?? {};
  const assumptions = checkedAssumptions(args?.assumptions ?? []);
  const problemKind = args?.problemKind ?? "user_problem";
  if (typeof problemKind !== "string" || !problemKind || problemKind.length > CAPS.problemKindChars)
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "problemKind must be a short non-empty string");
  if (!isObject(problem)) throw new WorkflowError("PLAN_SCHEMA_INVALID", "problem must be a ProblemSpec object");
  const checked = validateProblemSpec(problem);
  if (!checked.ok)
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "problem is not a valid ProblemSpec", { errors: checked.errors });
  const budgetsIn = args?.budgets ?? {};
  if (!hasOnly(budgetsIn, ["max_steps", "max_total_timeout_s"]))
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "budgets must be exactly {max_steps, max_total_timeout_s}");
  const budgets = {
    max_steps: budgetsIn.max_steps ?? CAPS.maxSteps,
    max_total_timeout_s: budgetsIn.max_total_timeout_s ?? CAPS.maxTotalTimeoutS
  };

  // LLM is an untrusted proposer: re-admit the method through the G2 static
  // policy gate before any planning happens.
  const verdict = assessMethod(problem, method);
  if (verdict.status !== "STRUCTURALLY_VALID")
    throw new WorkflowError("PLAN_METHOD_INVALID", "method proposal rejected by assessMethod", { issues: verdict.issues });

  if (!Array.isArray(steps) || steps.length === 0 || steps.length > CAPS.maxSteps)
    throw new WorkflowError("PLAN_SCHEMA_INVALID", "steps must be a non-empty array of at most " + CAPS.maxSteps);

  const methodSteps = new Map();
  for (const s of (Array.isArray(method.steps) ? method.steps : [])) {
    if (isObject(s) && typeof s.id === "string") methodSteps.set(s.id, s);
  }
  const normalized = [];
  const seenIds = new Set();
  for (const raw of steps) {
    if (!isObject(raw)) throw new WorkflowError("PLAN_SCHEMA_INVALID", "step record must be an object");
    const step = structuredClone(raw);
    if (typeof step.id !== "string" || !idPattern.test(step.id))
      throw new WorkflowError("PLAN_SCHEMA_INVALID", "step id must match " + idPattern.source);
    if (seenIds.has(step.id)) throw new WorkflowError("PLAN_DUP_STEP_ID", "duplicate step id: " + step.id);
    seenIds.add(step.id);
    const ops = OP_ALLOWLIST[step.tool];
    if (!ops) throw new WorkflowError("PLAN_UNKNOWN_TOOL", "tool is not on the frozen allowlist: " + String(step.tool));
    const spec = /** @type {any} */ (ops)[step.operation];
    if (!spec) throw new WorkflowError("PLAN_UNKNOWN_OPERATION", "operation is not allowed for tool " + step.tool + ": " + String(step.operation));
    if (step.expected_output_kind !== undefined && step.expected_output_kind !== spec.expected_output_kind)
      throw new WorkflowError("PLAN_INPUT_INVALID", "expected_output_kind must be " + spec.expected_output_kind + " for " + step.tool + "/" + step.operation);
    step.expected_output_kind = spec.expected_output_kind;
    if (spec.method_operation !== null) {
      // Registered tool: must correspond to its admitting method step.
      const m = methodSteps.get(step.id);
      if (!m || m.tool_id !== step.tool || m.operation !== spec.method_operation)
        throw new WorkflowError("PLAN_METHOD_INVALID",
          "plan step " + step.id + " does not correspond to an admitted method step (" + step.tool + "/" + step.operation + ")");
      const a = [...(Array.isArray(m.depends_on) ? m.depends_on : [])].sort().join("\u0000");
      const b = [...(Array.isArray(step.depends_on) ? step.depends_on : [])].sort().join("\u0000");
      if (a !== b)
        throw new WorkflowError("PLAN_METHOD_INVALID", "plan step " + step.id + " dependencies diverge from the admitted method step");
    }
    if (!Array.isArray(step.depends_on)) step.depends_on = [];
    const extra = validateStepInput(step.tool, step.operation, step.input);
    const hash = sha256Canonical(step.input);
    if (step.input_sha256 === undefined) step.input_sha256 = hash;
    else if (step.input_sha256 !== hash)
      throw new WorkflowError("PLAN_HASH_MISMATCH", "caller-supplied input_sha256 does not match canonical input JSON of step " + step.id,
        { expected: hash, actual: step.input_sha256 });
    if (extra.timeoutCapS !== undefined && step.timeout_s > extra.timeoutCapS)
      throw new WorkflowError("PLAN_BUDGET_EXCEEDED", "step " + step.id + " exceeds the portfolio timeout cap of " + extra.timeoutCapS + "s");
    normalized.push(step);
  }

  const source = {
    problem_sha256: sha256Canonical(problem),
    problem_kind: problemKind
  };
  const method_dag = normalized.map(step => ({
    id: step.id,
    kind: step.tool === "compare" ? "cross_check" : "solve",
    depends_on: [...step.depends_on]
  }));
  const plan_id = "wf-" + sha256Canonical({
    source, assumptions, method_dag, steps: normalized, budgets
  }).slice(0, 32);
  const plan = {
    schema: PLAN_SCHEMA, plan_id, source, assumptions,
    method_dag, steps: normalized, budgets,
    compiled: { launcher_sha256: null, manifest_sha256: null }
  };
  validateExecutionPlan(plan);
  return plan;
}
