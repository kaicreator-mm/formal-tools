// Issue #183 V3 offline tests for the typed DAG executor and its receipts.
// Every solver/portfolio interaction below goes through clearly-labeled STUB
// implementations — no binary, no network, no FORMAL_PORTABLE_ROOT bundle.
// Real-tool execution evidence lives in tests/workflow-executor.host.mjs and
// docs/mvp/receipts/ (not exercised here).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeWorkflowPlan, validateExecutionPlan, WorkflowPlanError, WorkflowBlockedError,
  EXECUTOR_CONSTANTS
} from "../packages/runner/js/workflow-executor.mjs";
import {
  canonicalJsonBytes, sha256Hex, EXECUTION_RECEIPT_SCHEMA, ARTIFACT_MANIFEST_SCHEMA
} from "../packages/runner/js/workflow-evidence.mjs";
// V2 planning layer (i180/V2, on main) — used by the cross-lane interop lock
// test at the bottom: plans built by V2 must be accepted by V3's validator.
import {
  normalizeUserProblem, stepsFromMethod, buildExecutionPlan
} from "../packages/runner/js/workflow-plan.mjs";

const UNSAT_SMT = [
  "(set-logic QF_LIA)",
  "(declare-fun x () Int)",
  "(assert (> x 0))",
  "(assert (< x 0))",
  "(check-sat)",
  "(exit)",
  ""
].join("\n");
const SAT_SMT = UNSAT_SMT.replace("(assert (< x 0))", "(assert (< x 5))");
const FEASIBLE_LP = {
  sense: "min", objective: [1],
  variables: [{lower: 0, upper: 10}],
  constraints: [{lower: 1, upper: null, coefficients: [1]}]
};
const INFEASIBLE_LP = {
  sense: "min", objective: [1],
  variables: [{lower: 0, upper: 10}],
  constraints: [
    {lower: 5, upper: null, coefficients: [1]},
    {lower: null, upper: 0, coefficients: [1]}
  ]
};
const sha = sha256Hex;

function smtStep(id, tool, smtLib, deps = [], timeout = 5) {
  const input = {smt_lib: smtLib};
  return {id, tool, operation: "solve-smt", depends_on: deps, input,
    input_sha256: sha(canonicalJsonBytes(input)), timeout_s: timeout,
    expected_output_kind: "smt-answer"};
}
function compareStep(id, left, right, deps, agreeOn = ["sat", "unsat"]) {
  const input = {left_step: left, right_step: right, agree_on: agreeOn};
  return {id, tool: "compare", operation: "cross-check", depends_on: deps, input,
    input_sha256: sha(canonicalJsonBytes(input)), timeout_s: 5,
    expected_output_kind: "cross-tool-verdict"};
}
function lpStep(id, model, deps = [], timeout = 10) {
  return {id, tool: "highs", operation: "solve-lp", depends_on: deps, input: model,
    input_sha256: sha(canonicalJsonBytes(model)), timeout_s: timeout,
    expected_output_kind: "lp-status"};
}
function buildPlan(steps, overrides = {}) {
  return {
    schema: "formal-tools/execution-plan/1.0",
    plan_id: "plan-v3-test-001",
    source: {problem_sha256: "a".repeat(64), problem_kind: "unit-test"},
    assumptions: [],
    method_dag: [{id: "m-root", kind: "solve", depends_on: []}],
    steps,
    budgets: {max_steps: 8, max_total_timeout_s: 120},
    compiled: {launcher_sha256: null, manifest_sha256: null},
    ...overrides
  };
}
async function makeFakeRoot({withZ3 = true, withCvc5 = true, withHighs = true} = {}) {
  const root = await mkdtemp(join(tmpdir(), "formal-fake-root-"));
  const layout = [
    {dir: ["tools","z3","bin"], file: withZ3 ? "z3" : null},
    {dir: ["tools","cvc5","bin"], file: withCvc5 ? "cvc5" : null},
    {dir: ["bin"], file: withHighs ? "tool-runner" : null},
    {dir: ["tools","highs"], file: withHighs ? "run" : null}
  ];
  for (const entry of layout) {
    if (!entry.file) continue;
    const dir = join(root, ...entry.dir);
    await mkdir(dir, {recursive: true});
    await writeFile(join(dir, entry.file), "#!/bin/sh\nexit 0\n");
  }
  return root;
}
// STUB process runner: canned solver outputs keyed by inspecting argv.
function stubCapture({z3 = {}, cvc5 = {}, versions = true} = {}, calls = []) {
  return async (argv, opts) => {
    calls.push({argv: [...argv], cwd: opts.cwd, timeoutMs: opts.timeoutMs});
    const canned = argv[1] === "--version"
      ? (argv[0].includes("z3") ? {exit_code: 0, stdout: "z3 5.4.0 (STUB)\n"}
        : argv[0].includes("cvc5") ? {exit_code: 0, stdout: "cvc5 version 1.4.2 (STUB)\n"}
        : {exit_code: 0, stdout: "stub 1.0\n"})
      : argv[0].includes("z3") ? z3 : argv[0].includes("cvc5") ? cvc5 : {};
    return {exit_code: 0, signal: null, timed_out: false, output_limit: false,
      error: null, stdout: "", stderr: "", ...canned};
  };
}
const stubLpImpl = (model, modelStatus = "kOptimal") => async (tool, operation, input, opts) => {
  assert.equal(tool, "highs");
  assert.equal(operation, "solve-lp");
  assert.deepEqual(input, model);
  assert.equal(opts.timeoutS, 10);
  return { // STUB portfolio result (shape mirrors runPortfolioOperation)
    schema: "formal-tools/portfolio-operation/0.1",
    status: "T4_OPERATION_EXECUTED_UNREVIEWED",
    qualification: "NOT_T4_ACCEPTED_INDEPENDENT_REVIEW_PENDING",
    solver: {
      schema: "formal-tools/highs-solve-lp/1.0", tool: "highs",
      highspy_version: "1.15.1", input_sha256: sha(Buffer.from(JSON.stringify(model))),
      solver_api_status: "kOk", model_status: modelStatus,
      ...(modelStatus === "kOptimal" ? {objective: 1, variables: [1]} : {objective: null, variables: []}),
      python_version: "3.13.5", numpy_version: "2.2.0"
    },
    process: {exit_code: 0, signal: null, timed_out: false, output_limit: false,
      elapsed_ms: 5, error: null},
    streams: {stdout: '{"stub":true}\n', stderr: ""}
  };
};
function runOptions(root, capture, extra = {}) {
  return {captureImpl: capture, env: {...process.env, FORMAL_PORTABLE_ROOT: root}, ...extra};
}
const planErrorCode = code => e => e instanceof WorkflowPlanError && e.code === code;
const blockedErrorCode = code => e => e instanceof WorkflowBlockedError && e.code === code;
const crossPlan = (z3Out, cvc5Out, smt = UNSAT_SMT) => buildPlan([
  smtStep("z3-solve", "z3", smt),
  smtStep("cvc5-solve", "cvc5", smt),
  compareStep("xcheck", "z3-solve", "cvc5-solve", ["z3-solve", "cvc5-solve"])
]);

test("V3: cross-tool UNSAT plan agrees end-to-end with stubbed solvers", async () => {
  const root = await makeFakeRoot();
  const calls = [];
  const capture = stubCapture({z3: {stdout: "unsat\n"}, cvc5: {stdout: "unsat\n"}}, calls);
  const {receipt, workspaceDir} = await executeWorkflowPlan(crossPlan(), runOptions(root, capture));
  // Version probes for every solve tool run first, then the DAG order.
  assert.deepEqual(calls.map(c => {
    const tool = c.argv[0].includes("z3") ? "z3" : "cvc5";
    return tool + " " + c.argv[1];
  }), ["z3 --version", "cvc5 --version", "z3 input.smt2", "cvc5 input.smt2"]);
  assert.equal(receipt.schema, EXECUTION_RECEIPT_SCHEMA);
  assert.equal(receipt.overall.process_outcome, "OK");
  assert.equal(receipt.overall.solver_answer.kind, "solve-smt");
  assert.equal(receipt.overall.solver_answer.value, "unsat");
  assert.equal(receipt.overall.solver_answer.by_step.length, 2);
  assert.equal(receipt.overall.cross_tool_verdict, "AGREE_UNSAT");
  assert.equal(receipt.overall.claim_verdict, "PASS");
  assert.equal(receipt.overall.fail_closed_reason, undefined);
  assert.equal(receipt.tool_versions.z3.version, "z3 5.4.0 (STUB)");
  assert.equal(receipt.tool_versions.cvc5.version, "cvc5 version 1.4.2 (STUB)");
  assert.ok(receipt.steps[2].result.verdict === "AGREE_UNSAT");
  const inputFile = await readFile(join(workspaceDir, "steps", "z3-solve", "input.smt2"), "utf8");
  assert.equal(inputFile, UNSAT_SMT);
});

test("V3: SAT variant agrees (AGREE_SAT)", async () => {
  const root = await makeFakeRoot();
  const capture = stubCapture({z3: {stdout: "sat\n"}, cvc5: {stdout: "sat\n"}});
  const {receipt} = await executeWorkflowPlan(crossPlan("sat\n", "sat\n", SAT_SMT), runOptions(root, capture));
  assert.equal(receipt.overall.cross_tool_verdict, "AGREE_SAT");
  assert.equal(receipt.overall.claim_verdict, "PASS");
  assert.equal(receipt.overall.solver_answer.value, "sat");
});

test("V3: contradiction fails closed with non-PASS claim but OK process", async () => {
  const root = await makeFakeRoot();
  const capture = stubCapture({z3: {stdout: "sat\n"}, cvc5: {stdout: "unsat\n"}});
  const {receipt} = await executeWorkflowPlan(crossPlan(), runOptions(root, capture));
  assert.equal(receipt.overall.process_outcome, "OK", "solver processes ran fine");
  assert.equal(receipt.overall.cross_tool_verdict, "CONTRADICTION");
  assert.equal(receipt.overall.claim_verdict, "UNSUPPORTED_BY_MVP");
  assert.notEqual(receipt.overall.claim_verdict, "PASS");
  assert.equal(receipt.overall.fail_closed_reason, "CROSS_TOOL_CONTRADICTION");
  assert.equal(receipt.overall.solver_answer.value, null);
  assert.equal(receipt.steps[2].result.verdict, "CONTRADICTION");
});

test("V3: solver UNKNOWN stays UNKNOWN and never passes", async () => {
  const root = await makeFakeRoot();
  const capture = stubCapture({z3: {stdout: "unknown\n"}, cvc5: {stdout: "unknown\n"}});
  const {receipt} = await executeWorkflowPlan(crossPlan(), runOptions(root, capture));
  assert.equal(receipt.overall.cross_tool_verdict, "UNKNOWN");
  assert.equal(receipt.overall.claim_verdict, "UNSUPPORTED_BY_MVP");
  assert.equal(receipt.overall.process_outcome, "OK");
  assert.equal(receipt.overall.solver_answer.value, null);
  assert.equal(receipt.steps[2].result.unknown_reason, "solver_reported_unknown");
});

test("V3: missing portable root blocks preflight with ABORTED receipt", async () => {
  const calls = [];
  const capture = stubCapture({}, calls);
  const env = {...process.env};
  delete env.FORMAL_PORTABLE_ROOT;
  await assert.rejects(
    executeWorkflowPlan(crossPlan(), {captureImpl: capture, env}),
    e => e instanceof WorkflowBlockedError && e.code === "BLOCKED_TOOL_MISSING");
  assert.equal(calls.length, 0, "no process may run before preflight passes");
  // The blocked error still carries a full ABORTED receipt for evidence.
  const env2 = {...process.env, FORMAL_PORTABLE_ROOT: join(tmpdir(), "formal-definitely-missing-")};
  let blocked = /** @type {any} */ (null);
  await assert.rejects(executeWorkflowPlan(crossPlan(), {captureImpl: stubCapture({}, []), env: env2}),
    e => { blocked = e; return true; });
  assert.equal(blocked.code, "BLOCKED_TOOL_MISSING");
  assert.equal(blocked.receipt.overall.process_outcome, "ABORTED");
  assert.equal(blocked.receipt.overall.claim_verdict, "BLOCKED");
  assert.equal(blocked.receipt.overall.fail_closed_reason, "BLOCKED_TOOL_MISSING");
  assert.ok(blocked.receipt.steps.every(s => s.status === "NOT_RUN"));
});

test("V3: missing solver binary blocks preflight before any version probe", async () => {
  const root = await makeFakeRoot({withCvc5: false});
  const calls = [];
  await assert.rejects(
    executeWorkflowPlan(crossPlan(), runOptions(root, stubCapture({}, calls))),
    e => e instanceof WorkflowBlockedError && e.code === "BLOCKED_TOOL_MISSING");
  assert.equal(calls.length, 0, "binary existence is checked before probes");
});

test("V3: version probe failure blocks (BLOCKED_TOOL_VERSION_PROBE)", async () => {
  const root = await makeFakeRoot();
  const capture = async (argv) => ({
    exit_code: 1, timed_out: false, output_limit: false, error: null,
    stdout: "", stderr: "stub refuses"
  });
  await assert.rejects(
    executeWorkflowPlan(crossPlan(), runOptions(root, capture)),
    e => e instanceof WorkflowBlockedError && e.code === "BLOCKED_TOOL_VERSION_PROBE");
});

test("V3: tampered input_sha256 rejected before any execution", async () => {
  const root = await makeFakeRoot();
  const calls = [];
  const plan = buildPlan([smtStep("z3-solve", "z3", UNSAT_SMT)]);
  plan.steps[0].input_sha256 = "0".repeat(64);
  await assert.rejects(
    executeWorkflowPlan(plan, runOptions(root, stubCapture({}, calls))),
    e => e instanceof WorkflowPlanError && e.code === "PLAN_HASH_MISMATCH");
  assert.equal(calls.length, 0);
  let workspaceSeen = null;
  await assert.rejects(
    executeWorkflowPlan(plan, runOptions(root, stubCapture({}, calls))),
    e => { workspaceSeen = e; return true; });
  assert.equal(calls.length, 0, "tampered plans must never execute");
});

test("V3: plan validation rejects unknown tool, operation mismatch, dup, unbound, cycle, compare misuse", () => {
  assert.throws(() => validateExecutionPlan(buildPlan([smtStep("s", "mathsat", UNSAT_SMT)])),
    e => e instanceof WorkflowPlanError && e.code === "PLAN_TOOL_NOT_ALLOWED");
  const wrongOp = smtStep("s", "z3", UNSAT_SMT); wrongOp.operation = "solve-lp";
  assert.throws(() => validateExecutionPlan(buildPlan([wrongOp])),
    planErrorCode("PLAN_OPERATION_MISMATCH"));
  assert.throws(() => validateExecutionPlan(buildPlan([
    smtStep("s", "z3", UNSAT_SMT), smtStep("s", "cvc5", UNSAT_SMT)])),
    planErrorCode("PLAN_DUP_STEP"));
  assert.throws(() => validateExecutionPlan(buildPlan([smtStep("s", "z3", UNSAT_SMT, ["ghost"])])),
    planErrorCode("PLAN_UNBOUND_DEPENDENCY"));
  assert.throws(() => validateExecutionPlan(buildPlan([
    smtStep("s1", "z3", UNSAT_SMT, ["s2"]), smtStep("s2", "z3", SAT_SMT, ["s1"])])),
    planErrorCode("PLAN_CYCLE"));
  assert.throws(() => validateExecutionPlan(buildPlan([
    compareStep("x", "z3-solve", "ghost", ["z3-solve"]), smtStep("z3-solve", "z3", UNSAT_SMT)])),
    planErrorCode("PLAN_COMPARE_INVALID"));
  const badKind = smtStep("s", "z3", UNSAT_SMT); badKind.expected_output_kind = "lp-status";
  assert.throws(() => validateExecutionPlan(buildPlan([badKind])),
    planErrorCode("PLAN_EXPECTED_KIND_INVALID"), "a contract-valid kind is still per-operation");
  const badCompareKind = compareStep("x", "z3-solve", "s2", ["z3-solve"]);
  badCompareKind.expected_output_kind = "smt-answer";
  assert.throws(() => validateExecutionPlan(buildPlan([
    smtStep("z3-solve", "z3", UNSAT_SMT), smtStep("s2", "cvc5", UNSAT_SMT), badCompareKind])),
    planErrorCode("PLAN_EXPECTED_KIND_INVALID"));
  // agree_on must be the frozen V0 compareInput shape: non-empty unique array
  // over {sat, unsat, optimal-status} — not a string, not foreign tokens.
  const withAgree = agreeOn => buildPlan([
    smtStep("z3-solve", "z3", UNSAT_SMT), smtStep("s2", "cvc5", UNSAT_SMT),
    compareStep("x", "z3-solve", "s2", ["z3-solve", "s2"], agreeOn)]);
  assert.throws(() => validateExecutionPlan(withAgree("answer")),
    planErrorCode("PLAN_INPUT_INVALID"), "pre-fix deviant string shape must be rejected");
  assert.throws(() => validateExecutionPlan(withAgree(["sat", "bogus"])),
    planErrorCode("PLAN_INPUT_INVALID"));
  assert.throws(() => validateExecutionPlan(withAgree(["sat", "sat"])),
    planErrorCode("PLAN_INPUT_INVALID"));
  assert.throws(() => validateExecutionPlan(withAgree([])),
    planErrorCode("PLAN_INPUT_INVALID"));
  assert.doesNotThrow(() => validateExecutionPlan(withAgree(["sat", "unsat", "optimal-status"])));
  const badTimeout = smtStep("s", "z3", UNSAT_SMT); badTimeout.timeout_s = 121;
  assert.throws(() => validateExecutionPlan(buildPlan([badTimeout])),
    planErrorCode("PLAN_TIMEOUT_INVALID"));
  const lpBadTimeout = lpStep("h", FEASIBLE_LP); lpBadTimeout.timeout_s = 31;
  assert.throws(() => validateExecutionPlan(buildPlan([lpBadTimeout])),
    planErrorCode("PLAN_TIMEOUT_INVALID"));
  assert.throws(() => validateExecutionPlan(buildPlan([lpStep("h", {...FEASIBLE_LP, sense: "minimize"})])),
    planErrorCode("PLAN_INPUT_INVALID"));
  assert.throws(() => validateExecutionPlan(buildPlan([smtStep("s", "z3", UNSAT_SMT), smtStep("s2", "cvc5", UNSAT_SMT)],
    {budgets: {max_steps: 1, max_total_timeout_s: 120}})),
    planErrorCode("PLAN_BUDGET_EXCEEDED"));
  assert.throws(() => validateExecutionPlan(buildPlan([smtStep("s", "z3", UNSAT_SMT, [], 60),
    smtStep("s2", "cvc5", UNSAT_SMT, [], 60)],
    {budgets: {max_steps: 8, max_total_timeout_s: 60}})),
    planErrorCode("PLAN_BUDGET_EXCEEDED"));
});

test("V3: topological order is stable and cycle-free chains execute in order", async () => {
  const root = await makeFakeRoot();
  const calls = [];
  const plan = buildPlan([
    smtStep("z3-a", "z3", UNSAT_SMT),
    smtStep("z3-b", "z3", SAT_SMT, ["z3-a"])
  ]);
  const ordered = validateExecutionPlan(plan).orderedSteps.map(s => s.id);
  assert.deepEqual(ordered, ["z3-a", "z3-b"]);
  const capture = stubCapture({z3: {stdout: "unsat\n"}}, calls);
  const {receipt} = await executeWorkflowPlan(plan, runOptions(root, capture));
  assert.deepEqual(receipt.steps.map(s => s.step_id), ["z3-a", "z3-b"]);
  const z3RunCalls = calls.filter(c => c.argv[1] === "input.smt2");
  assert.ok(z3RunCalls[0].cwd.endsWith("z3-a"), "first run must target step a workspace");
  assert.ok(z3RunCalls[1].cwd.endsWith("z3-b"), "second run must target step b workspace");
});

test("V3: timeout maps to TIMEOUT and downstream steps are skipped", async () => {
  const root = await makeFakeRoot();
  const capture = stubCapture({z3: {timed_out: true, stdout: "", stderr: ""}, cvc5: {stdout: "unsat\n"}});
  const plan = buildPlan([
    smtStep("z3-slow", "z3", UNSAT_SMT, [], 1),
    smtStep("z3-dependent", "z3", SAT_SMT, ["z3-slow"]),
    smtStep("cvc5-solve", "cvc5", UNSAT_SMT),
    compareStep("xcheck", "z3-slow", "cvc5-solve", ["z3-slow", "cvc5-solve"])
  ]);
  const {receipt} = await executeWorkflowPlan(plan, runOptions(root, capture));
  const byId = Object.fromEntries(receipt.steps.map(s => [s.step_id, s]));
  assert.equal(byId["z3-slow"].status, "TIMEOUT");
  assert.equal(byId["z3-dependent"].status, "SKIPPED_DOWNSTREAM");
  assert.equal(byId["cvc5-solve"].status, "EXECUTED");
  assert.equal(byId["xcheck"].status, "SKIPPED_DOWNSTREAM");
  assert.equal(receipt.overall.process_outcome, "FAILED");
  assert.equal(receipt.overall.claim_verdict, "UNSUPPORTED_BY_MVP");
  assert.equal(receipt.overall.fail_closed_reason, "STEP_TIMEOUT");
  assert.equal(receipt.overall.cross_tool_verdict, "NOT_APPLICABLE");
});

test("V3: malformed solver output is a fail-closed step error, never a guess", async () => {
  const root = await makeFakeRoot();
  const capture = stubCapture({z3: {exit_code: 0, stdout: "I have no idea what you mean\n"}});
  const {receipt} = await executeWorkflowPlan(buildPlan([smtStep("z3-solve", "z3", UNSAT_SMT)]),
    runOptions(root, capture));
  const step = receipt.steps[0];
  assert.equal(step.status, "ERROR");
  assert.equal(step.exit_code, 0, "exit zero is recorded but is not success");
  assert.match(step.result.error, /no smt answer token/);
  assert.equal(receipt.overall.process_outcome, "FAILED");
  assert.equal(receipt.overall.fail_closed_reason, "SOLVER_OUTPUT_UNPARSABLE");
  assert.equal(receipt.overall.claim_verdict, "UNSUPPORTED_BY_MVP");
});

test("V3: nonzero solver exit is an error even with answer-like output", async () => {
  const root = await makeFakeRoot();
  const capture = stubCapture({z3: {exit_code: 1, stdout: "unsat\n", stderr: "boom (STUB)\n"}});
  const {receipt} = await executeWorkflowPlan(buildPlan([smtStep("z3-solve", "z3", UNSAT_SMT)]),
    runOptions(root, capture));
  assert.equal(receipt.steps[0].status, "ERROR");
  assert.equal(receipt.overall.fail_closed_reason, "SOLVER_NONZERO_EXIT");
  assert.ok(receipt.steps[0].stderr_bounded.includes("boom"));
});

test("V3: solve-lp delegates to the portfolio gateway result object (stubbed highs)", async () => {
  const root = await makeFakeRoot();
  const {receipt} = await executeWorkflowPlan(buildPlan([lpStep("highs-feasible", FEASIBLE_LP)]),
    runOptions(root, () => Promise.resolve({}), {solveLpImpl: stubLpImpl(FEASIBLE_LP, "kOptimal")}));
  const step = receipt.steps[0];
  assert.equal(step.status, "EXECUTED");
  assert.equal(step.result.model_status, "kOptimal");
  assert.equal(step.tool, "highs");
  assert.equal(receipt.tool_versions.highs.version, "highspy 1.15.1");
  assert.equal(receipt.overall.process_outcome, "OK");
  assert.equal(receipt.overall.solver_answer.kind, "solve-lp");
  assert.equal(receipt.overall.solver_answer.by_step[0].answer, "kOptimal");
  assert.equal(receipt.overall.cross_tool_verdict, "NOT_APPLICABLE");
  assert.equal(receipt.overall.claim_verdict, "NOT_APPLICABLE", "no independent cross-check in MVP for single-tool LP");
});

test("V3: infeasible LP and portfolio failure both fail honestly", async () => {
  const root = await makeFakeRoot();
  const {receipt} = await executeWorkflowPlan(buildPlan([lpStep("highs-bad", INFEASIBLE_LP)]),
    runOptions(root, () => Promise.resolve({}), {solveLpImpl: stubLpImpl(INFEASIBLE_LP, "kInfeasible")}));
  assert.equal(receipt.steps[0].result.model_status, "kInfeasible");
  assert.equal(receipt.overall.solver_answer.value, "unsat");
  const failing = async () => ({status: "PORTFOLIO_OPERATION_FAILED",
    process: {exit_code: 1, timed_out: false, output_limit: false, error: "STUB adapter failure"},
    streams: {stdout: "", stderr: ""}});
  const {receipt: r2} = await executeWorkflowPlan(buildPlan([lpStep("highs-feasible", FEASIBLE_LP)]),
    runOptions(root, () => Promise.resolve({}), {solveLpImpl: failing}));
  assert.equal(r2.steps[0].status, "ERROR");
  assert.equal(r2.overall.fail_closed_reason, "HIGHS_ADAPTER_FAIL_CLOSED");
  const notRun = async () => ({status: "NOT_RUN_FAIL_CLOSED", reason: "PORTABLE_ROOT_NOT_CONFIGURED"});
  const {receipt: r3} = await executeWorkflowPlan(buildPlan([lpStep("highs-feasible", FEASIBLE_LP)]),
    runOptions(root, () => Promise.resolve({}), {solveLpImpl: notRun}));
  assert.equal(r3.steps[0].status, "ERROR");
  assert.match(r3.steps[0].result.error, /PORTABLE_ROOT_NOT_CONFIGURED/);
  const syncThrow = async () => { throw new TypeError("HIGHS_MODEL_SCHEMA_INVALID"); };
  const {receipt: r4} = await executeWorkflowPlan(buildPlan([lpStep("highs-feasible", FEASIBLE_LP)]),
    runOptions(root, () => Promise.resolve({}), {solveLpImpl: syncThrow}));
  assert.equal(r4.steps[0].status, "ERROR");
  assert.match(r4.steps[0].result.error, /HIGHS_MODEL_SCHEMA_INVALID/);
});

test("V3: wall-clock budget guard marks unlaunched steps NOT_RUN", async () => {
  const root = await makeFakeRoot();
  let t = 0;
  const advancingNow = () => { const v = t; t += 61000; return v; };
  const plan = buildPlan([
    smtStep("z3-a", "z3", UNSAT_SMT),
    smtStep("z3-b", "z3", SAT_SMT, ["z3-a"])
  ], {budgets: {max_steps: 8, max_total_timeout_s: 120}});
  const capture = stubCapture({z3: {stdout: "unsat\n"}});
  const {receipt} = await executeWorkflowPlan(plan, runOptions(root, capture, {now: advancingNow}));
  const byId = Object.fromEntries(receipt.steps.map(s => [s.step_id, s]));
  assert.equal(byId["z3-a"].status, "EXECUTED");
  assert.equal(byId["z3-b"].status, "NOT_RUN");
  assert.equal(receipt.overall.process_outcome, "PARTIAL", "budget stop is a harness stop, not a tool failure");
  assert.equal(receipt.overall.fail_closed_reason, "BUDGET_WALL_CLOCK_EXCEEDED");
  assert.equal(receipt.overall.claim_verdict, "UNSUPPORTED_BY_MVP");
});

test("V3: receipt schema, hash and artifact invariants hold on disk", async () => {
  const root = await makeFakeRoot();
  const capture = stubCapture({z3: {stdout: "unsat\n"}, cvc5: {stdout: "unsat\n"}});
  const plan = crossPlan();
  const {receipt, workspaceDir} = await executeWorkflowPlan(plan, runOptions(root, capture, {
    runId: "run-invariant-1", sourceSha: "b".repeat(64), host: "receipt-test-host", now: 1700000000000
  }));
  assert.equal(receipt.run_id, "run-invariant-1");
  assert.equal(receipt.source_sha, "b".repeat(64));
  assert.equal(receipt.created_at, "2023-11-14T22:13:20.000Z");
  assert.equal(receipt.plan_id, "plan-v3-test-001");
  assert.equal(receipt.plan_sha256, sha(canonicalJsonBytes(plan)));
  const z3 = receipt.steps[0];
  assert.equal(z3.stdout_sha256, sha("unsat\n"));
  assert.equal(z3.stdout_bounded, "unsat\n");
  assert.ok(z3.stdout_bounded.length <= 4096);
  assert.ok(z3.artifacts.length >= 1);
  const art = z3.artifacts.find(a => a.name === "steps/z3-solve/input.smt2");
  assert.ok(art, "input artifact must be recorded");
  const artBytes = await readFile(join(workspaceDir, "steps", "z3-solve", "input.smt2"));
  assert.equal(art.sha256, sha(artBytes));
  assert.equal(art.bytes, artBytes.length);
  const receiptOnDisk = JSON.parse(await readFile(join(workspaceDir, "receipt.json"), "utf8"));
  assert.deepEqual(receiptOnDisk, receipt);
  const manifest = JSON.parse(await readFile(join(workspaceDir, "manifest.json"), "utf8"));
  assert.equal(manifest.schema, ARTIFACT_MANIFEST_SCHEMA);
  assert.equal(manifest.receipt_sha256,
    sha(await readFile(join(workspaceDir, "receipt.json"))));
  const logBytes = await readFile(join(workspaceDir, "logs", "z3-solve.stdout.txt"));
  assert.equal(logBytes.toString("utf8"), "unsat\n");
  assert.equal(sha(logBytes), z3.stdout_sha256, "committed log must match the receipt hash");
  assert.ok(manifest.artifacts.some(a => a.name === "logs/z3-solve.stdout.txt"));
});

test("V3: receipts are deterministic under injected now/runId/host", async () => {
  const root = await makeFakeRoot();
  const fixed = {runId: "run-det-1", sourceSha: "c".repeat(64), host: "det-host", now: 1700000000000};
  const r1 = await executeWorkflowPlan(crossPlan(), runOptions(root, stubCapture({z3: {stdout: "unsat\n"}, cvc5: {stdout: "unsat\n"}}), fixed));
  const r2 = await executeWorkflowPlan(crossPlan(), runOptions(root, stubCapture({z3: {stdout: "unsat\n"}, cvc5: {stdout: "unsat\n"}}), fixed));
  assert.deepEqual(r1.receipt, r2.receipt);
  assert.notEqual(r1.workspaceDir, r2.workspaceDir, "each run gets its own workspace");
});

test("V3: large stdout stays bounded at 4KB while the hash covers full bytes", async () => {
  const root = await makeFakeRoot();
  const bigStdout = "unsat\n" + "x".repeat(10000);
  const capture = stubCapture({z3: {stdout: bigStdout}});
  const {receipt} = await executeWorkflowPlan(buildPlan([smtStep("z3-solve", "z3", UNSAT_SMT)]),
    runOptions(root, capture));
  assert.equal(receipt.steps[0].stdout_sha256, sha(bigStdout));
  assert.ok(Buffer.byteLength(receipt.steps[0].stdout_bounded, "utf8") <= 4096);
  assert.ok(receipt.steps[0].stdout_bounded.startsWith("unsat\n"));
});

// --- i180/V3-fix2 cross-lane interop lock -----------------------------------
// Regression for the P1 integration-gate defect: V3's validator used deviant
// expected_output_kind values ("lp-result"/"cross-check-verdict") and a
// deviant compare input shape (agree_on:"answer") that no other lane emits,
// so every plan built by V2's buildExecutionPlan was rejected
// (PLAN_EXPECTED_KIND_INVALID first). These tests pin the frozen V0 contract
// shapes end-to-end using the exact V2 fixture method from the frozen
// contract lane (mirrors tests/workflow-plan.test.mjs).

/** @param {any} problem @returns {any} two-solver method proposal (G2 shape, native ops) */
function v2Method(problem) {
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

/** @returns {any[]} typed steps exactly as tests/workflow-plan.test.mjs builds them */
function v2Steps(problem) {
  const inputs = { "step-z3": { smt_lib: UNSAT_SMT }, "step-cvc5": { smt_lib: UNSAT_SMT } };
  const compare = {
    id: "step-agree", tool: "compare", operation: "cross-check",
    depends_on: ["step-z3", "step-cvc5"],
    input: { left_step: "step-z3", right_step: "step-cvc5", agree_on: ["sat", "unsat"] },
    timeout_s: 5, expected_output_kind: "cross-tool-verdict"
  };
  return stepsFromMethod(v2Method(problem), inputs, { compareSteps: [compare] });
}

function v2BuiltPlan() {
  const f = normalizeUserProblem(
    "Check with two independent SMT solvers whether this bounded integer problem is unsat.",
    { assumptions: ["input is bounded linear integer arithmetic", "solvers run locally"] });
  return { f, plan: buildExecutionPlan({
    problem: f.problem, method: v2Method(f.problem), steps: v2Steps(f.problem),
    assumptions: f.assumptions }) };
}

test("V3-fix2 interop: a V2-built z3+cvc5+compare plan passes V3 validation unchanged", () => {
  const { plan } = v2BuiltPlan();
  assert.deepEqual(plan.steps.map(s => s.tool), ["z3", "cvc5", "compare"]);
  // The exact frozen-V0 kinds the V2 compiler emits must equal V3's pin.
  assert.deepEqual(plan.steps.map(s => s.expected_output_kind), ["smt-answer", "smt-answer", "cross-tool-verdict"]);
  for (const step of plan.steps)
    assert.equal(step.expected_output_kind, EXECUTOR_CONSTANTS.EXPECTED_OUTPUT_KINDS[step.operation]);
  assert.deepEqual(plan.steps[2].input.agree_on, ["sat", "unsat"]);
  // No PLAN_EXPECTED_KIND_INVALID / PLAN_INPUT_INVALID: full acceptance.
  const { orderedSteps, plan_sha256 } = validateExecutionPlan(plan);
  assert.deepEqual(orderedSteps.map(s => [s.tool, s.operation]),
    [["z3", "solve-smt"], ["cvc5", "solve-smt"], ["compare", "cross-check"]]);
  // Canonical-JSON hashing agrees byte-for-byte across lanes.
  assert.equal(plan_sha256, sha(canonicalJsonBytes(plan)));
});

test("V3-fix2 interop: without tools the V2-built plan fails closed at preflight, honestly", async () => {
  const { plan } = v2BuiltPlan();
  const calls = [];
  const env = {...process.env};
  delete env.FORMAL_PORTABLE_ROOT;
  let blocked = /** @type {any} */ (null);
  await assert.rejects(
    executeWorkflowPlan(plan, {captureImpl: stubCapture({}, calls), env}),
    e => { blocked = e; return e instanceof WorkflowBlockedError && e.code === "BLOCKED_TOOL_MISSING"; });
  assert.equal(calls.length, 0, "no process may launch before preflight passes");
  assert.equal(blocked.receipt.overall.process_outcome, "ABORTED");
  assert.equal(blocked.receipt.overall.claim_verdict, "BLOCKED");
  assert.equal(blocked.receipt.overall.fail_closed_reason, "BLOCKED_TOOL_MISSING");
  assert.equal(blocked.receipt.plan_id, plan.plan_id, "blocked receipt binds the V2-built plan");
  assert.ok(blocked.receipt.steps.every(s => s.status === "NOT_RUN"));
});

test("V3-fix2 interop: the V2-built plan executes end-to-end to AGREE_UNSAT / PASS", async () => {
  const { plan } = v2BuiltPlan();
  const root = await makeFakeRoot();
  const capture = stubCapture({z3: {stdout: "unsat\n"}, cvc5: {stdout: "unsat\n"}});
  const {receipt} = await executeWorkflowPlan(plan, runOptions(root, capture,
    {runId: "run-interop-fix2", host: "interop-test-host"}));
  assert.equal(receipt.plan_id, plan.plan_id);
  assert.equal(receipt.plan_sha256, sha(canonicalJsonBytes(plan)));
  assert.equal(receipt.overall.process_outcome, "OK");
  assert.equal(receipt.overall.solver_answer.kind, "solve-smt");
  assert.equal(receipt.overall.solver_answer.value, "unsat");
  assert.equal(receipt.overall.cross_tool_verdict, "AGREE_UNSAT");
  assert.equal(receipt.overall.claim_verdict, "PASS");
  assert.equal(receipt.steps[2].result.verdict, "AGREE_UNSAT");
});
