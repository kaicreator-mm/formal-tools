import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  normalizeUserProblem, makeDeepSeekChatProvider, stepsFromMethod, buildExecutionPlan
} from "../packages/runner/js/workflow-plan.mjs";
import { compilePlan } from "../packages/runner/js/workflow-compiler.mjs";
import { proposeMethod } from "../packages/runner/js/method-planner.mjs";

const sha256Text = text => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * REAL DeepSeek round-trip: user text -> provider -> proposeMethod ->
 * buildExecutionPlan -> compilePlan. Runs only when DEEPSEEK_API_KEY is set
 * (the key is read from the environment only; CI without the key skips).
 * The host egress authority below is the test itself approving the exact
 * synthetic PUBLIC payload — the problem text contains no private data.
 */
const SMT = [
  "(set-logic QF_LIA)",
  "(declare-const x Int)",
  "(declare-const y Int)",
  "(assert (>= x 0))",
  "(assert (<= x 9))",
  "(assert (>= y 0))",
  "(assert (<= y 9))",
  "(assert (= (+ (* x x) (* y y)) 65))",
  "(assert (= (- x y) 1))",
  "(check-sat)",
  "(exit)"
].join("\n");

test("V2 real DeepSeek: text -> method proposal -> typed plan -> compiled launcher", { timeout: 180000 }, async t => {
  if (!process.env.DEEPSEEK_API_KEY) {
    t.skip("BLOCKED_PROVIDER: DEEPSEEK_API_KEY not set");
    return;
  }
  const normalized = normalizeUserProblem(
    "Check with two independent SMT solvers (z3 and cvc5) whether this bounded integer problem is unsat: " +
    "x and y are integers with 0 <= x <= 9, 0 <= y <= 9, x*x + y*y = 65 and x - y = 1. " +
    "Both solvers must agree on the sat/unsat answer.",
    { assumptions: ["input is bounded linear integer arithmetic", "solvers run locally", "no network access needed"] }
  );
  const provider = makeDeepSeekChatProvider({});
  const egressAuthority = { authorizePublicPayload: async () => true };
  // Up to two single-shot attempts: a chatty model may occasionally emit a
  // proposal that fails static admission; each attempt is one real call.
  let verdict = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    verdict = await proposeMethod(normalized.problem, provider.generate, egressAuthority);
    if (verdict.status === "STRUCTURALLY_VALID") break;
  }
  assert.equal(verdict.status, "STRUCTURALLY_VALID",
    "model proposal must pass assessMethod: " + JSON.stringify(verdict.issues));
  assert.equal(verdict.tool_execution, "NOT_RUN");
  const method = provider.getProposal();
  assert.ok(method, "provider must retain the untrusted proposal object");
  // Map the admitted proposal to typed steps with TRUSTED inputs keyed by the
  // model's own step ids; compare step is supplied by the trusted caller.
  const inputs = {};
  for (const step of method.steps) {
    if (step.tool_id === "z3" || step.tool_id === "cvc5") inputs[step.id] = { smt_lib: SMT };
  }
  const solverIds = Object.keys(inputs);
  assert.ok(solverIds.length >= 2, "expected two solver steps, got: " + JSON.stringify(method.steps.map(s => s.tool_id)));
  const compareStep = {
    id: "step-agree", tool: "compare", operation: "cross-check",
    depends_on: solverIds.slice(0, 2),
    input: { left_step: solverIds[0], right_step: solverIds[1], agree_on: ["sat", "unsat"] },
    timeout_s: 5, expected_output_kind: "cross-tool-verdict"
  };
  const steps = stepsFromMethod(method, inputs, { compareSteps: [compareStep] });
  const plan = buildExecutionPlan({
    problem: normalized.problem, method, steps, assumptions: normalized.assumptions
  });
  const planTools = plan.steps.map(s => s.tool);
  assert.ok(planTools.includes("z3"), "plan must contain a z3 step: " + planTools.join(","));
  assert.ok(planTools.includes("cvc5"), "plan must contain a cvc5 step: " + planTools.join(","));
  assert.ok(planTools.includes("compare"));
  assert.equal(plan.source.problem_kind, "user_problem");
  assert.deepEqual(plan.compiled, { launcher_sha256: null, manifest_sha256: null });
  const { launcher, manifest } = compilePlan(plan);
  assert.equal(manifest.launcher_sha256, sha256Text(launcher));
  assert.match(manifest.plan_sha256, /^[a-f0-9]{64}$/);
  // Record the real model identity in the test output for the delivery receipt.
  console.log("DEEPSEEK_REAL_CALL model=%s endpoint=%s plan_id=%s steps=%s status=STRUCTURALLY_VALID execution=NOT_RUN",
    provider.model, provider.baseUrl, plan.plan_id, planTools.join("+"));
});
