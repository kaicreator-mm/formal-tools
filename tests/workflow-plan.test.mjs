import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync as readReg } from "node:fs";
import {
  CAPS, WorkflowError, canonicalJson, sha256Canonical, sha256Text,
  normalizeUserProblem, makeDeepSeekChatProvider, stepsFromMethod,
  buildExecutionPlan, validateExecutionPlan
} from "../packages/runner/js/workflow-plan.mjs";
import { compilePlan, LAUNCHER_ENTRY, EXECUTOR_SPECIFIER } from "../packages/runner/js/workflow-compiler.mjs";

const sha256 = x => createHash("sha256").update(x).digest("hex");
const SMT = [
  "(set-logic QF_LIA)",
  "(declare-const x Int)",
  "(assert (> x 0))",
  "(assert (< x 0))",
  "(check-sat)",
  "(exit)"
].join("\n");

/** @returns {any} normalized bounded problem (PUBLIC, deterministic ids) */
function fixtureProblem() {
  return normalizeUserProblem(
    "Check with two independent SMT solvers whether this bounded integer problem is unsat.",
    { assumptions: ["input is bounded linear integer arithmetic", "solvers run locally"] }
  );
}

/** @param {any} problem @returns {any} two-solver method proposal (G2 shape, native ops) */
function smtMethod(problem) {
  return {
    schema: "formal-tools/method-proposal/0.1",
    method_id: "methodsmt01",
    problem_id: problem.problem_id,
    goal_claim_ids: ["claim1"],
    oracle_ids: ["heldout"],
    semantic_review: "PENDING",
    steps: [
      { id: "step-z3", tool_id: "z3", operation: "solve", claim_ids: ["claim1"], provides: ["logic.smt"],
        depends_on: [], source_refs: ["user-problem-text"], estimated_cost_units: 1, timeout_ms: 30000,
        destination: "LOCAL", output_classification: "PUBLIC" },
      { id: "step-cvc5", tool_id: "cvc5", operation: "solve", claim_ids: ["claim1"], provides: ["logic.smt"],
        depends_on: ["step-z3"], source_refs: [], estimated_cost_units: 1, timeout_ms: 30000,
        destination: "LOCAL", output_classification: "PUBLIC" }
    ]
  };
}

/** @returns {any[]} typed steps: z3 + cvc5 solve-smt, compare cross-check */
function smtSteps(extraCompare = {}) {
  const inputs = { "step-z3": { smt_lib: SMT }, "step-cvc5": { smt_lib: SMT } };
  const compare = {
    id: "step-agree", tool: "compare", operation: "cross-check",
    depends_on: ["step-z3", "step-cvc5"],
    input: { left_step: "step-z3", right_step: "step-cvc5", agree_on: ["sat", "unsat"] },
    timeout_s: 5, expected_output_kind: "cross-tool-verdict", ...extraCompare
  };
  return stepsFromMethod(smtMethod(fixtureProblem().problem), inputs, { compareSteps: [compare] });
}

/** @returns {any} one-step HiGHS LP method + typed step pair */
function lpFixture() {
  const problem = normalizeUserProblem(
    "Minimize cost subject to a linear constraint over two bounded variables using HiGHS.",
    { capabilityIds: ["opt.numerical"], assumptions: ["model is linear"] }
  );
  const method = {
    schema: "formal-tools/method-proposal/0.1",
    method_id: "methodlp01",
    problem_id: problem.problem.problem_id,
    goal_claim_ids: ["claim1"],
    oracle_ids: ["heldout"],
    semantic_review: "PENDING",
    steps: [
      { id: "step-highs", tool_id: "highs", operation: "UNRESOLVED", claim_ids: ["claim1"],
        provides: ["opt.numerical"], depends_on: [], source_refs: ["user-problem-text"],
        estimated_cost_units: 1, timeout_ms: 30000, destination: "LOCAL", output_classification: "PUBLIC" }
    ]
  };
  const model = {
    sense: "min", objective: [1, 2],
    variables: [{ lower: 0, upper: 10 }, { lower: 0, upper: null }],
    constraints: [{ lower: 1, upper: null, coefficients: [1, 1] }]
  };
  const steps = [{
    id: "step-highs", tool: "highs", operation: "solve-lp", depends_on: [],
    input: model, timeout_s: 30, expected_output_kind: "lp-status"
  }];
  return { problem: problem.problem, method, steps };
}

/** @param {Function} fn @returns {string} thrown WorkflowError code */
function codeOf(fn) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof WorkflowError, "expected WorkflowError, got " + String(e));
    return /** @type {WorkflowError} */ (e).code;
  }
  throw new Error("expected WorkflowError, nothing thrown");
}

/** @param {any} obj @returns {any} deep clone with object keys in reverse insertion order */
function shuffled(obj) {
  if (Array.isArray(obj)) return obj.map(shuffled);
  if (obj !== null && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj).reverse()) out[k] = shuffled(obj[k]);
    return out;
  }
  return obj;
}

test("V2: normalizeUserProblem yields a bounded ProblemSpec-compatible problem", () => {
  const f = fixtureProblem();
  assert.equal(f.problem.schema, "formal-tools/problem-spec/0.1");
  assert.match(f.problem_sha256, /^[a-f0-9]{64}$/);
  assert.equal(f.problem.source_refs[0].sha256, f.problem_sha256);
  assert.deepEqual(f.assumptions, ["input is bounded linear integer arithmetic", "solvers run locally"]);
  // deterministic: same text -> same ids and hash
  const again = fixtureProblem();
  assert.equal(again.problem.problem_id, f.problem.problem_id);
  assert.equal(again.problem_sha256, f.problem_sha256);
  assert.equal(sha256Text(f.canonical_text), f.problem_sha256);
});

test("V2: normalizeUserProblem caps text, assumptions and rejects bad types", () => {
  assert.equal(codeOf(() => normalizeUserProblem("x".repeat(CAPS.problemTextBytes + 1))), "PLAN_OVERSIZED");
  const many = Array.from({ length: CAPS.assumptionItems + 1 }, () => "a");
  assert.equal(codeOf(() => normalizeUserProblem("ok", { assumptions: many })), "PLAN_OVERSIZED");
  assert.equal(codeOf(() => normalizeUserProblem("ok", { assumptions: ["x".repeat(CAPS.assumptionChars + 1)] })), "PLAN_OVERSIZED");
  assert.equal(codeOf(() => normalizeUserProblem("ok", { assumptions: /** @type {any} */ ([42]) })), "PLAN_SCHEMA_INVALID");
  assert.equal(codeOf(() => normalizeUserProblem(123)), "PLAN_SCHEMA_INVALID");
});

test("V2: two-solver SMT plan builds, hashes verify, NOT_RUN discipline holds", () => {
  const f = fixtureProblem();
  const method = smtMethod(f.problem);
  const steps = smtSteps();
  const plan = buildExecutionPlan({ problem: f.problem, method, steps, assumptions: f.assumptions });
  assert.equal(plan.schema, "formal-tools/execution-plan/1.0");
  assert.match(plan.plan_id, /^wf-[a-f0-9]{32}$/);
  assert.equal(plan.steps.length, 3);
  assert.deepEqual(plan.steps.map(s => s.tool), ["z3", "cvc5", "compare"]);
  assert.deepEqual(plan.compiled, { launcher_sha256: null, manifest_sha256: null });
  for (const step of plan.steps) {
    assert.equal(step.input_sha256, sha256Canonical(step.input));
    assert.match(step.input_sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(plan.method_dag, [
    { id: "step-z3", kind: "solve", depends_on: [] },
    { id: "step-cvc5", kind: "solve", depends_on: ["step-z3"] },
    { id: "step-agree", kind: "cross_check", depends_on: ["step-z3", "step-cvc5"] }
  ]);
  // stable id: same inputs -> same plan_id
  const rebuilt = buildExecutionPlan({ problem: f.problem, method, steps: smtSteps(), assumptions: f.assumptions });
  assert.equal(rebuilt.plan_id, plan.plan_id);
  // revalidation passes
  validateExecutionPlan(plan);
});

test("V2: HiGHS LP plan builds with portfolio-caps mirrored", () => {
  const { problem, method, steps } = lpFixture();
  const plan = buildExecutionPlan({ problem, method, steps, assumptions: ["model is linear"] });
  assert.deepEqual(plan.steps.map(s => s.tool + "/" + s.operation), ["highs/solve-lp"]);
  assert.equal(plan.steps[0].expected_output_kind, "lp-status");
  // mirrored per-op timeout cap: highs step may not exceed 30s
  const capped = structuredClone(steps);
  capped[0].timeout_s = 31;
  assert.equal(codeOf(() => buildExecutionPlan({ problem, method, steps: capped })), "PLAN_BUDGET_EXCEEDED");
});

test("V2: allowlist rejections are precise", () => {
  const f = fixtureProblem();
  const method = smtMethod(f.problem);
  const unknownTool = smtSteps();
  unknownTool[0].tool = "mathsat";
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: unknownTool })), "PLAN_UNKNOWN_TOOL");
  const unknownOp = smtSteps();
  unknownOp[0].operation = "solve-lp";
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: unknownOp })), "PLAN_UNKNOWN_OPERATION");
  const badKind = smtSteps();
  badKind[0].expected_output_kind = "sat";
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: badKind })), "PLAN_INPUT_INVALID");
});

test("V2: structural DAG rejections: dup id, unbound dep, cycle, hostile compare refs", () => {
  const f = fixtureProblem();
  const method = smtMethod(f.problem);
  const dup = smtSteps();
  dup[1] = { ...structuredClone(dup[0]), tool: "cvc5", operation: "solve-smt", depends_on: [] };
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: dup })), "PLAN_DUP_STEP_ID");
  const unbound = smtSteps({ depends_on: ["ghost"] });
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: unbound })), "PLAN_UNBOUND_DEP");
  const badRef = smtSteps();
  badRef[2].input = { left_step: "ghost", right_step: "step-cvc5", agree_on: ["sat"] };
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: badRef })), "PLAN_UNBOUND_DEP");
  const selfCompare = smtSteps();
  selfCompare[2].input = { left_step: "step-agree", right_step: "step-cvc5", agree_on: ["sat"] };
  // "step-agree" itself exists, so the operand-dep rule fires (not UNBOUND_DEP)
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: selfCompare })), "PLAN_INPUT_INVALID");
  // cycle built purely from executor-side compare steps (compare is exempt
  // from method correspondence, so PLAN_CYCLE is reachable at build time).
  const cycle = smtSteps();
  cycle[2].depends_on = ["step-z3", "step-cvc5", "step-agree-b"];
  cycle.push({
    id: "step-agree-b", tool: "compare", operation: "cross-check",
    depends_on: ["step-z3", "step-cvc5", "step-agree"],
    input: { left_step: "step-z3", right_step: "step-cvc5", agree_on: ["sat"] },
    timeout_s: 5, expected_output_kind: "cross-tool-verdict"
  });
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: cycle })), "PLAN_CYCLE");
});

test("V2: input validation: extra keys, bad shapes, oversize are rejected", () => {
  const f = fixtureProblem();
  const method = smtMethod(f.problem);
  const extraKey = smtSteps();
  extraKey[0].input = { smt_lib: SMT, attach: "/etc/passwd" };
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: extraKey })), "PLAN_INPUT_INVALID");
  const emptyLib = smtSteps();
  emptyLib[0].input = { smt_lib: "" };
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: emptyLib })), "PLAN_INPUT_INVALID");
  const oversize = smtSteps();
  oversize[0].input = { smt_lib: "x".repeat(CAPS.smtLibBytes + 1) };
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: oversize })), "PLAN_OVERSIZED");
  const badAgree = smtSteps();
  badAgree[2].input = { left_step: "step-z3", right_step: "step-cvc5", agree_on: ["sat", "UNSAT"] };
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: badAgree })), "PLAN_INPUT_INVALID");
  const sameRef = smtSteps();
  sameRef[2].input = { left_step: "step-z3", right_step: "step-z3", agree_on: ["sat"] };
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: sameRef })), "PLAN_INPUT_INVALID");
  const noOperandDep = smtSteps({ depends_on: ["step-z3"] });
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: noOperandDep })), "PLAN_INPUT_INVALID");

  const { problem, method: lpMethod, steps: lpSteps } = lpFixture();
  const badSense = structuredClone(lpSteps);
  badSense[0].input = { ...badSense[0].input, sense: "minimize" };
  assert.equal(codeOf(() => buildExecutionPlan({ problem, method: lpMethod, steps: badSense })), "PLAN_INPUT_INVALID");
  const wrongVars = structuredClone(lpSteps);
  wrongVars[0].input = { ...wrongVars[0].input, variables: [{ lower: 0, upper: 1 }] };
  assert.equal(codeOf(() => buildExecutionPlan({ problem, method: lpMethod, steps: wrongVars })), "PLAN_INPUT_INVALID");
  const tooManyConstraints = structuredClone(lpSteps);
  tooManyConstraints[0].input = {
    sense: "min", objective: [1],
    variables: [{ lower: 0, upper: 1 }],
    constraints: Array.from({ length: 129 }, () => ({ lower: 0, upper: null, coefficients: [1] }))
  };
  assert.equal(codeOf(() => buildExecutionPlan({ problem, method: lpMethod, steps: tooManyConstraints })), "PLAN_INPUT_INVALID");
  const lpOversize = structuredClone(lpSteps);
  lpOversize[0].input = {
    sense: "min",
    objective: Array.from({ length: 64 }, () => 1.7976931348623157e+308),
    variables: Array.from({ length: 64 }, () => ({ lower: 0, upper: null })),
    constraints: Array.from({ length: 128 }, () => ({
      lower: 0, upper: null,
      coefficients: Array.from({ length: 64 }, () => 1.7976931348623157e+308)
    }))
  };
  assert.equal(codeOf(() => buildExecutionPlan({ problem, method: lpMethod, steps: lpOversize })), "PLAN_OVERSIZED");
});

test("V2: hash drift, per-step timeout bounds and budget enforcement are rejected", () => {
  const f = fixtureProblem();
  const method = smtMethod(f.problem);
  const drifted = smtSteps();
  drifted[0].input_sha256 = "0".repeat(64);
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: drifted })), "PLAN_HASH_MISMATCH");
  const built = buildExecutionPlan({ problem: f.problem, method, steps: smtSteps(), assumptions: f.assumptions });
  const tampered = structuredClone(built);
  tampered.steps[1].input_sha256 = "a".repeat(64);
  assert.equal(codeOf(() => validateExecutionPlan(tampered)), "PLAN_HASH_MISMATCH");

  const zeroT = smtSteps();
  zeroT[0].timeout_s = 0;
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: zeroT })), "PLAN_BUDGET_EXCEEDED");
  const hugeT = smtSteps();
  hugeT[0].timeout_s = 121;
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: hugeT })), "PLAN_BUDGET_EXCEEDED");
  const sumTooBig = smtSteps();
  sumTooBig[0].timeout_s = 60;
  sumTooBig[1].timeout_s = 60;
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: sumTooBig })), "PLAN_BUDGET_EXCEEDED");
  const tooManySteps = smtSteps();
  while (tooManySteps.length < CAPS.maxSteps + 1) tooManySteps.push(structuredClone(tooManySteps[2]));
  assert.equal(tooManySteps.length, CAPS.maxSteps + 1);
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: tooManySteps })), "PLAN_SCHEMA_INVALID");
  assert.equal(codeOf(() => buildExecutionPlan({
    problem: f.problem, method, steps: smtSteps(), budgets: { max_steps: 2, max_total_timeout_s: 120 }
  })), "PLAN_BUDGET_EXCEEDED");
  assert.equal(codeOf(() => buildExecutionPlan({
    problem: f.problem, method, steps: smtSteps(), budgets: { max_steps: 9, max_total_timeout_s: 120 }
  })), "PLAN_BUDGET_EXCEEDED");
  assert.equal(codeOf(() => buildExecutionPlan({
    problem: f.problem, method, steps: smtSteps(), budgets: { max_steps: 3, max_total_timeout_s: 120, extra: 1 }
  })), "PLAN_SCHEMA_INVALID");
});

test("V2: untrusted method is data: hostile proposal keys and method/step divergence are rejected", () => {
  const f = fixtureProblem();
  const method = smtMethod(f.problem);
  const hostile = structuredClone(method);
  hostile.steps[0].argv = ["curl", "https://outside.example"];
  hostile.pre_exec = "bash -c id";
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method: hostile, steps: smtSteps() })), "PLAN_METHOD_INVALID");
  const mismatched = structuredClone(method);
  mismatched.steps[0].operation = "dimacs";
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method: mismatched, steps: smtSteps() })), "PLAN_METHOD_INVALID");
  const swappedTool = structuredClone(method);
  swappedTool.steps[0].tool_id = "cvc5";
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method: swappedTool, steps: smtSteps() })), "PLAN_METHOD_INVALID");
  const divergedDeps = structuredClone(method);
  divergedDeps.steps[1].depends_on = [];
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method: divergedDeps, steps: smtSteps() })), "PLAN_METHOD_INVALID");
  const staleMethod = structuredClone(method);
  staleMethod.problem_id = "ads.other.r0";
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method: staleMethod, steps: smtSteps() })), "PLAN_METHOD_INVALID");
  // hostile typed steps with structural (non-schema) keys
  const shelled = smtSteps();
  shelled[0].shell = "/bin/sh";
  shelled[0].env = { PATH: "/usr/bin" };
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method, steps: shelled })), "PLAN_SCHEMA_INVALID");
  // hostile plan envelope keys
  const plan = buildExecutionPlan({ problem: f.problem, method, steps: smtSteps(), assumptions: f.assumptions });
  const enveloped = { ...structuredClone(plan), pre_exec: "bash -c whoami" };
  assert.equal(codeOf(() => validateExecutionPlan(enveloped)), "PLAN_SCHEMA_INVALID");
});

test("V2: LLM-as-data: fake generate() flows only through validation into a plan", async () => {
  const f = fixtureProblem();
  const method = smtMethod(f.problem);
  let calls = 0;
  const generate = async () => { calls++; return JSON.stringify(method); };
  const verdict = await propose(f.problem, generate);
  assert.equal(calls, 1);
  assert.equal(verdict.status, "STRUCTURALLY_VALID", JSON.stringify(verdict.issues));
  assert.equal(verdict.tool_execution, "NOT_RUN");
  assert.equal(verdict.executable, false);
  assert.match(verdict.method_sha256, /^[a-f0-9]{64}$/);
  // hostile variant: provider returns a proposal with executable-looking keys
  const hostile = structuredClone(method);
  hostile.steps[0].argv = ["sh", "-c", "id"];
  const rejected = await propose(f.problem, async () => hostile);
  assert.equal(rejected.status, "REJECTED");
  assert.match(rejected.issues.join(" "), /unexpected fields|invalid step fields/);
  // and even if the hostile object is passed straight through, planning refuses
  assert.equal(codeOf(() => buildExecutionPlan({ problem: f.problem, method: hostile, steps: smtSteps() })), "PLAN_METHOD_INVALID");
});

/** proposeMethod passthrough with a permissive host egress authority (synthetic public payload). */
async function propose(problem, generate) {
  const { proposeMethod } = await import("../packages/runner/js/method-planner.mjs");
  return proposeMethod(problem, generate, { authorizePublicPayload: async () => true });
}

test("V2: compilePlan is deterministic, manifest hashes chain, caller plan is never mutated", () => {
  const f = fixtureProblem();
  const plan = buildExecutionPlan({ problem: f.problem, method: smtMethod(f.problem), steps: smtSteps(), assumptions: f.assumptions });
  const before = structuredClone(plan);
  const a = compilePlan(plan);
  const b = compilePlan(plan);
  assert.equal(a.launcher, b.launcher);
  assert.equal(JSON.stringify(a.manifest), JSON.stringify(b.manifest));
  // key-order independence
  const c = compilePlan(shuffled(plan));
  assert.equal(a.launcher, c.launcher);
  assert.equal(a.manifest.plan_sha256, c.manifest.plan_sha256);
  // non-mutation + backfill only in returned copy
  assert.deepEqual(plan, before);
  assert.deepEqual(plan.compiled, { launcher_sha256: null, manifest_sha256: null });
  assert.equal(a.plan.compiled.launcher_sha256, sha256(a.launcher));
  assert.equal(a.manifest.launcher_sha256, sha256(a.launcher));
  assert.equal(a.manifest.plan_sha256, sha256Canonical(plan));
  assert.equal(a.plan.compiled.manifest_sha256, sha256Canonical(a.manifest));
  assert.equal(a.manifest.schema, "formal-tools/launcher-manifest/1.0");
  assert.equal(a.manifest.plan_id, plan.plan_id);
  assert.equal(a.manifest.entry, LAUNCHER_ENTRY);
  assert.equal(a.manifest.runtime, "node>=20");
  assert.equal(a.manifest.generated_by, "workflow-compiler@1.0");
  assert.equal(a.manifest.deterministic, true);
  // backfilled copy is still a valid plan
  validateExecutionPlan(a.plan);
});

test("V2: launcher is inert text: plan data only inside the JSON.parse literal", () => {
  const f = fixtureProblem();
  const hostile = smtSteps();
  hostile[0].input = { smt_lib: SMT + "\n; child_process import eval( spawn( bash -c `id`" };
  delete hostile[0].input_sha256;
  const plan = buildExecutionPlan({ problem: f.problem, method: smtMethod(f.problem), steps: hostile, assumptions: f.assumptions });
  const { launcher, manifest } = compilePlan(plan);
  const lines = launcher.split("\n");
  // hostile payload appears ONLY inside the single frozen plan literal line
  const tainted = lines.filter(l => l.includes("child_process") || l.includes("spawn(") || l.includes("bash -c"));
  assert.ok(tainted.length >= 1);
  assert.ok(tainted.every(l => l.startsWith("const PLAN = Object.freeze(JSON.parse(")), tainted.join(" | "));
  // trusted surface: only the two fixed static imports and one constant dynamic import
  const imports = lines.filter(l => /^import |await import\(/.test(l));
  assert.deepEqual(imports.sort(), [
    "import { pathToFileURL } from \"node:url\";",
    "import { writeFile } from \"node:fs/promises\";",
    "  ({ executeWorkflowPlan } = await import(EXECUTOR_SPECIFIER));"
  ].sort());
  assert.ok(launcher.includes("NOT_COMPILED_FOR_EXECUTION"));
  assert.ok(launcher.includes(JSON.stringify(EXECUTOR_SPECIFIER).slice(1, -1)));
  assert.ok(launcher.includes("// plan_id: " + plan.plan_id));
  for (const banned of ["require(", "process.env", "spawnSy", "execSync"]) {
    assert.ok(!lines.some(l => !l.startsWith("const PLAN") && l.includes(banned)), "banned: " + banned);
  }
});

test("V2: launcher fails closed with NOT_COMPILED_FOR_EXECUTION before V3 exists", async () => {
  const f = fixtureProblem();
  const plan = buildExecutionPlan({ problem: f.problem, method: smtMethod(f.problem), steps: smtSteps(), assumptions: f.assumptions });
  const { launcher } = compilePlan(plan);
  const root = mkdtempSync(join(tmpdir(), "wf-launcher-"));
  try {
    // ../../ from artifacts/<plan_id>/ resolves to root; executor deliberately absent there.
    mkdirSync(join(root, "packages", "runner", "js"), { recursive: true });
    const dir = join(root, "artifacts", plan.plan_id);
    mkdirSync(dir, { recursive: true });
    const launcherPath = join(dir, "launcher.mjs");
    writeFileSync(launcherPath, launcher);
    const receiptPath = join(root, "receipt.json");
    const run = spawnSync(process.execPath, [launcherPath, receiptPath], { encoding: "utf8" });
    assert.equal(run.status, 2, "stderr=" + run.stderr + " stdout=" + run.stdout);
    assert.match(run.stderr, /NOT_COMPILED_FOR_EXECUTION/);
    assert.ok(!existsSync(receiptPath), "no receipt may be written without the V3 executor");
    // usage error
    const usage = spawnSync(process.execPath, [launcherPath], { encoding: "utf8" });
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /LAUNCHER_USAGE/);
    // main() is importable and refuses execution without a receipt path too
    const mod = await import("file:///" + launcherPath.replace(/\\/g, "/"));
    await assert.rejects(() => mod.main(["node", "launcher.mjs", ""]), /LAUNCHER_USAGE/);
    await assert.rejects(() => mod.main(["node", "launcher.mjs", join(root, "unused.json")]), /NOT_COMPILED_FOR_EXECUTION/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V2: compilePlan rejects tampered or structurally hostile plans", () => {
  const f = fixtureProblem();
  const plan = buildExecutionPlan({ problem: f.problem, method: smtMethod(f.problem), steps: smtSteps(), assumptions: f.assumptions });
  const drifted = structuredClone(plan);
  drifted.steps[0].input_sha256 = "b".repeat(64);
  assert.equal(codeOf(() => compilePlan(drifted)), "PLAN_HASH_MISMATCH");
  const cycled = structuredClone(plan);
  cycled.steps[0].depends_on = ["step-agree"];
  cycled.method_dag[0].depends_on = ["step-agree"];
  assert.equal(codeOf(() => compilePlan(cycled)), "PLAN_CYCLE");
  const enveloped = { ...structuredClone(plan), argv: ["sh"] };
  assert.equal(codeOf(() => compilePlan(enveloped)), "PLAN_SCHEMA_INVALID");
});

test("V2: DeepSeek provider offline behavior: no key, header-only key, failures stay classified", async () => {
  // no key => BLOCKED_PROVIDER before any fetch
  const blocked = makeDeepSeekChatProvider({ apiKey: "", fetchImpl: async () => { throw new Error("must not be called"); } });
  await assert.rejects(() => blocked.generate({ mode: "UNTRUSTED_PROPOSAL_ONLY" }),
    e => e instanceof WorkflowError && e.code === "BLOCKED_PROVIDER");
  // key travels only in the Authorization header
  let seen = /** @type {any} */ (null);
  const okFetch = async (url, init) => {
    seen = { url, headers: init.headers };
    assert.ok(!String(url).includes("test-key-123"));
    return { status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }) };
  };
  const provider = makeDeepSeekChatProvider({ apiKey: "test-key-123", fetchImpl: okFetch });
  const reply = await provider.generate({ mode: "UNTRUSTED_PROPOSAL_ONLY" });
  assert.deepEqual(reply, { ok: true });
  assert.deepEqual(provider.getProposal(), { ok: true });
  assert.equal(seen.url, "https://api.deepseek.com/chat/completions");
  assert.equal(seen.headers.authorization, "Bearer test-key-123");
  // http failure stays classified and never echoes the key or response body
  const failing = makeDeepSeekChatProvider({ apiKey: "test-key-123", fetchImpl: async () => ({ status: 500, json: async () => ({ secret_body: "FAKE_TOKEN" }) }) });
  await assert.rejects(() => failing.generate({}),
    e => e instanceof WorkflowError && e.code === "PROVIDER_FAILED" && e.details.http_status === 500 &&
      !JSON.stringify(e).includes("FAKE_TOKEN") && !JSON.stringify(e).includes("test-key-123"));
  // invalid JSON reply
  const junk = makeDeepSeekChatProvider({ apiKey: "test-key-123", fetchImpl: async () => ({ status: 200, json: async () => ({ choices: [{ message: { content: "not json {" } }] }) }) });
  await assert.rejects(() => junk.generate({}), e => e instanceof WorkflowError && e.code === "PROVIDER_FAILED");
  // timeout is classified (abort-aware fake fetch)
  const slow = makeDeepSeekChatProvider({
    apiKey: "test-key-123", timeoutMs: 50,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })
  });
  await assert.rejects(() => slow.generate({}),
    e => e instanceof WorkflowError && e.code === "PROVIDER_FAILED" && e.details.reason === "timeout");
});

test("V2: canonical JSON is key-order independent and registry schema describes the frozen contract", () => {
  const a = { b: 1, a: { z: [1, 2], y: "x" } };
  const b = { a: { y: "x", z: [1, 2] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(sha256Canonical(a), sha256Canonical(b));
  const schema = JSON.parse(readReg(new URL("../registry/EXECUTION_PLAN.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.match(schema.$id, /registry\/EXECUTION_PLAN\.schema\.json$/);
  const stepSchema = schema.$defs.step.properties;
  assert.deepEqual(stepSchema.tool.enum, ["z3", "cvc5", "highs", "compare"]);
  assert.deepEqual(stepSchema.operation.enum, ["solve-smt", "solve-lp", "cross-check"]);
  assert.deepEqual(stepSchema.expected_output_kind.enum, ["smt-answer", "lp-status", "cross-tool-verdict"]);
  assert.equal(schema.properties.budgets.properties.max_steps.maximum, CAPS.maxSteps);
  assert.equal(schema.properties.budgets.properties.max_total_timeout_s.maximum, CAPS.maxTotalTimeoutS);
  assert.equal(stepSchema.input_sha256.$ref, "#/$defs/sha256");
  assert.equal(schema.$defs.sha256.pattern, "^[a-f0-9]{64}$");
  assert.equal(readFileSync(new URL("../registry/EXECUTION_PLAN.schema.json", import.meta.url), "utf8").includes("\"additionalProperties\": false"), true);
});


test("V2/V3: generated launcher writes unwrapped receipt and propagates non-PASS exit status", () => {
  const f = fixtureProblem();
  const plan = buildExecutionPlan({
    problem: f.problem, method: smtMethod(f.problem), steps: smtSteps(),
    assumptions: f.assumptions
  });
  const {launcher} = compilePlan(plan);
  for (const scenario of [
    {verdict: "PASS", expectedExit: 0, blocked: false},
    {verdict: "UNKNOWN", expectedExit: 2, blocked: false},
    {verdict: "BLOCKED", expectedExit: 2, blocked: true}
  ]) {
    const root = mkdtempSync(join(tmpdir(), "wf-v2-v3-receipt-"));
    try {
      // This stub is placed exactly where the generated launcher's trusted
      // relative import expects the executor. Real solvers are not required.
      const executableRoot = join(root, "packages", "runner", "js");
      const artifactDir = join(root, "artifacts", plan.plan_id);
      mkdirSync(executableRoot, {recursive: true});
      mkdirSync(artifactDir, {recursive: true});
      const stub = [
        "export async function executeWorkflowPlan() {",
        '  const receipt = {schema:"formal-tools/execution-receipt/1.0",overall:{claim_verdict:' +
          JSON.stringify(scenario.verdict) + '}};',
        scenario.blocked
          ? '  const e = new Error("BLOCKED_TOOL_MISSING"); e.receipt = receipt; throw e;'
          : '  return {receipt,workspaceDir:"/tmp/not-a-receipt"};',
        "}"
      ].join("\n");
      writeFileSync(join(executableRoot, "workflow-executor.mjs"), stub);
      const launcherPath = join(artifactDir, "launcher.mjs");
      const receiptPath = join(artifactDir, "receipt.json");
      writeFileSync(launcherPath, launcher);
      const run = spawnSync(process.execPath, [launcherPath, receiptPath], {
        cwd: root, encoding: "utf8", timeout: 15000
      });
      assert.equal(run.status, scenario.expectedExit,
        scenario.verdict + ": stderr=" + run.stderr + " stdout=" + run.stdout);
      assert.ok(existsSync(receiptPath), "blocked and non-PASS executions must persist receipts");
      const persisted = JSON.parse(readFileSync(receiptPath, "utf8"));
      assert.equal(persisted.schema, "formal-tools/execution-receipt/1.0");
      assert.equal(persisted.overall.claim_verdict, scenario.verdict);
      assert.equal(Object.hasOwn(persisted, "workspaceDir"), false,
        "executor envelope must not be serialized as a receipt");
      assert.equal(Object.hasOwn(persisted, "receipt"), false);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  }
});
