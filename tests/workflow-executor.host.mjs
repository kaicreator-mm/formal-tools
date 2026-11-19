/**
 * Issue #183 V3 REAL execution driver — trusted Debian 13 host only.
 *
 * NOT part of the CI glob (tests/*.test.mjs): this file spawns the real
 * pinned tools from the portable bundle and therefore must never run in a
 * no-binary CI. Run it as:
 *
 *   FORMAL_PORTABLE_ROOT=<bundle> <bundle>/bin/tool-runner node tests/workflow-executor.host.mjs
 *
 * Scenarios (V0 MVP set):
 *   A  — UNSAT SMT-LIB2 solved by z3 + cvc5 + cross-check  -> AGREE_UNSAT, claim PASS
 *   A2 — SAT variant of the same problem                   -> AGREE_SAT,   claim PASS
 *   B  — feasible + infeasible LP via the typed HiGHS path -> kOptimal / kInfeasible
 *   N1 — malformed SMT must fail closed                    -> step ERROR,  overall FAILED
 *
 * Exit code: 0 every scenario matched its expectation; 1 any surprise (the
 * surprise receipts are still written to disk for inspection — a fail-closed
 * result is honest evidence, but this driver refuses to bless it silently).
 * Without FORMAL_PORTABLE_ROOT the driver records BLOCKED_HOST and exits 2;
 * it never invents receipts.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { executeWorkflowPlan } from "../packages/runner/js/workflow-executor.mjs";
import { canonicalJsonBytes, sha256Hex } from "../packages/runner/js/workflow-evidence.mjs";

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
const MALFORMED_SMT = [
  "(set-logic QF_LIA)",
  "(declare-fun x () Int)",
  "(assert (> x definitely-not-a-term))",
  "(check-sat)",
  "(exit)",
  ""
].join("\n");
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

function smtStep(id, tool, smtLib, deps = [], timeout = 10) {
  const input = {smt_lib: smtLib};
  return {id, tool, operation: "solve-smt", depends_on: deps, input,
    input_sha256: sha256Hex(canonicalJsonBytes(input)), timeout_s: timeout,
    expected_output_kind: "smt-answer"};
}
function compareStep(id, left, right, deps) {
  const input = {left_step: left, right_step: right, agree_on: "answer"};
  return {id, tool: "compare", operation: "cross-check", depends_on: deps, input,
    input_sha256: sha256Hex(canonicalJsonBytes(input)), timeout_s: 5,
    expected_output_kind: "cross-check-verdict"};
}
function lpStep(id, model, deps = [], timeout = 25) {
  return {id, tool: "highs", operation: "solve-lp", depends_on: deps, input: model,
    input_sha256: sha256Hex(canonicalJsonBytes(model)), timeout_s: timeout,
    expected_output_kind: "lp-result"};
}
function buildPlan(planId, problemKind, steps) {
  return {
    schema: "formal-tools/execution-plan/1.0",
    plan_id: planId,
    source: {problem_sha256: sha256Hex(Buffer.from(steps[0].input.smt_lib ?? JSON.stringify(steps[0].input), "utf8")),
      problem_kind: problemKind},
    assumptions: ["mvp-scenario-inputs-committed-in-driver"],
    method_dag: steps.map(s => ({id: s.id, kind: s.operation, depends_on: [...s.depends_on]})),
    steps,
    budgets: {max_steps: 8, max_total_timeout_s: 120},
    compiled: {launcher_sha256: null, manifest_sha256: null}
  };
}

const root = process.env.FORMAL_PORTABLE_ROOT;
const outDir = resolve(process.env.FORMAL_WORKFLOW_HOST_OUT ?? join(tmpdir(), "formal-workflow-host-out"));
if (typeof root !== "string" || !root) {
  const blocked = {
    blocked: "BLOCKED_HOST",
    reason: "FORMAL_PORTABLE_ROOT is not set; real receipts require the pinned portable bundle",
    trigger: "FORMAL_PORTABLE_ROOT=<bundle> <bundle>/bin/tool-runner node tests/workflow-executor.host.mjs"
  };
  console.log(JSON.stringify(blocked));
  process.exit(2);
}
await mkdir(outDir, {recursive: true});
let sourceSha = process.env.FORMAL_WORKFLOW_SOURCE_SHA ?? null;
try { sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(); } catch {}
const runLabel = process.env.FORMAL_WORKFLOW_RUN_LABEL ?? "host-run";

const scenarios = [
  {
    name: "scenario-a-unsat",
    plan: buildPlan("plan-v3-host-a-unsat", "cross-tool-smt-unsat", [
      smtStep("z3-solve", "z3", UNSAT_SMT),
      smtStep("cvc5-solve", "cvc5", UNSAT_SMT),
      compareStep("xcheck", "z3-solve", "cvc5-solve", ["z3-solve", "cvc5-solve"])
    ]),
    expect: r => r.overall.process_outcome === "OK" &&
      r.overall.cross_tool_verdict === "AGREE_UNSAT" && r.overall.claim_verdict === "PASS" &&
      r.steps.every(s => s.status === "EXECUTED") &&
      r.steps[0].result.answer === "unsat" && r.steps[1].result.answer === "unsat"
  },
  {
    name: "scenario-a2-sat",
    plan: buildPlan("plan-v3-host-a2-sat", "cross-tool-smt-sat", [
      smtStep("z3-solve", "z3", SAT_SMT),
      smtStep("cvc5-solve", "cvc5", SAT_SMT),
      compareStep("xcheck", "z3-solve", "cvc5-solve", ["z3-solve", "cvc5-solve"])
    ]),
    expect: r => r.overall.process_outcome === "OK" &&
      r.overall.cross_tool_verdict === "AGREE_SAT" && r.overall.claim_verdict === "PASS" &&
      r.steps[0].result.answer === "sat" && r.steps[1].result.answer === "sat"
  },
  {
    name: "scenario-b-lp",
    plan: buildPlan("plan-v3-host-b-lp", "highs-lp-feasible-and-infeasible", [
      lpStep("highs-feasible", FEASIBLE_LP),
      lpStep("highs-infeasible", INFEASIBLE_LP)
    ]),
    expect: r => r.overall.process_outcome === "OK" &&
      r.overall.cross_tool_verdict === "NOT_APPLICABLE" &&
      r.steps[0].status === "EXECUTED" && r.steps[0].result.model_status === "kOptimal" &&
      r.steps[1].status === "EXECUTED" && r.steps[1].result.model_status === "kInfeasible"
  },
  {
    name: "scenario-n1-malformed",
    plan: buildPlan("plan-v3-host-n1-malformed", "malformed-smt-fail-closed", [
      smtStep("z3-bad", "z3", MALFORMED_SMT),
      smtStep("cvc5-bad", "cvc5", MALFORMED_SMT)
    ]),
    // Both solvers must refuse; the exact fail-closed code may differ per tool
    // (nonzero exit vs unparsable stdout) — both are honest ERROR outcomes.
    expect: r => r.overall.process_outcome === "FAILED" &&
      r.overall.claim_verdict === "UNSUPPORTED_BY_MVP" &&
      r.steps.every(s => s.status === "ERROR") &&
      ["SOLVER_NONZERO_EXIT","SOLVER_OUTPUT_UNPARSABLE","STEP_PROCESS_ERROR"].includes(r.overall.fail_closed_reason)
  }
];

let failures = 0;
for (const scenario of scenarios) {
  const workspace = join(outDir, scenario.name);
  const started = new Date().toISOString();
  let outcome;
  try {
    const {receipt, workspaceDir} = await executeWorkflowPlan(scenario.plan, {
      workspaceDir: workspace,
      sourceSha: sourceSha ?? undefined,
      runId: `${runLabel}-${scenario.name}`
    });
    const ok = scenario.expect(receipt);
    if (!ok) failures++;
    outcome = {
      scenario: scenario.name,
      expectation_met: ok,
      started,
      workspace: workspaceDir,
      plan_id: receipt.plan_id,
      plan_sha256: receipt.plan_sha256,
      tool_versions: receipt.tool_versions,
      steps: receipt.steps.map(s => ({step_id: s.step_id, tool: s.tool, status: s.status,
        exit_code: s.exit_code, elapsed_ms: s.elapsed_ms,
        answer: s.result?.answer ?? s.result?.model_status ?? s.result?.verdict ?? null})),
      overall: receipt.overall
    };
  } catch (e) {
    failures++;
    outcome = {scenario: scenario.name, expectation_met: false, started,
      thrown: e?.constructor?.name, code: e?.code, message: String(e?.message ?? e)};
  }
  console.log("HOSTRUN " + JSON.stringify(outcome));
}
process.exit(failures === 0 ? 0 : 1);
