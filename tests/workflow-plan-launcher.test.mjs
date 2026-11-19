import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  normalizeUserProblem, stepsFromMethod,
  buildExecutionPlan, validateExecutionPlan
} from "../packages/runner/js/workflow-plan.mjs";
import { compilePlan, RUNNER_ROOT_ENV_VAR } from "../packages/runner/js/workflow-compiler.mjs";

/** Repository root of this worktree: the trusted runner root for R2 locator tests. */
const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

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
function smtSteps() {
  const inputs = { "step-z3": { smt_lib: SMT }, "step-cvc5": { smt_lib: SMT } };
  const compare = {
    id: "step-agree", tool: "compare", operation: "cross-check",
    depends_on: ["step-z3", "step-cvc5"],
    input: { left_step: "step-z3", right_step: "step-cvc5", agree_on: ["sat", "unsat"] },
    timeout_s: 5, expected_output_kind: "cross-tool-verdict"
  };
  return stepsFromMethod(smtMethod(fixtureProblem().problem), inputs, { compareSteps: [compare] });
}

/** @returns {any} a built, valid two-solver execution plan */
function fixturePlan() {
  const f = fixtureProblem();
  const plan = buildExecutionPlan({
    problem: f.problem, method: smtMethod(f.problem), steps: smtSteps(), assumptions: f.assumptions
  });
  validateExecutionPlan(plan);
  return plan;
}

/** Child env without ambient locator/portable vars, so each test pins its own scenario. */
function childEnv(...deletions) {
  const env = { ...process.env };
  for (const name of ["FORMAL_TOOLS_RUNNER_ROOT", "FORMAL_PORTABLE_ROOT", ...deletions]) delete env[name];
  return env;
}

/** @param {string} verdict @returns {string} minimal trusted-executor stub module */
function stubExecutor(verdict) {
  return [
    "export async function executeWorkflowPlan() {",
    '  const receipt = {schema:"formal-tools/execution-receipt/1.0",overall:{claim_verdict:' +
      JSON.stringify(verdict) + "}};",
    '  return {receipt,workspaceDir:"/tmp/not-a-receipt"};',
    "}"
  ].join("\n");
}

/** @param {string} rootDir @param {string} verdict Stub executor at <root>/packages/runner/js/. */
function installStub(rootDir, verdict) {
  const dir = join(rootDir, "packages", "runner", "js");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workflow-executor.mjs"), stubExecutor(verdict));
}

test("R2: launcher outside the repo runs the full chain via FORMAL_TOOLS_RUNNER_ROOT (real executor, no binaries -> honest BLOCKED receipt)", () => {
  const plan = fixturePlan();
  const { launcher } = compilePlan(plan);
  const tmp = mkdtempSync(join(tmpdir(), "wf-r2-external-"));
  try {
    // External cwd layout: launcher NOT two levels below any repo root; the
    // relative fallback cannot resolve here, only the env locator can.
    const launcherPath = join(tmp, "launcher.mjs");
    const receiptPath = join(tmp, "receipt.json");
    writeFileSync(launcherPath, launcher);
    const env = childEnv();
    env.FORMAL_TOOLS_RUNNER_ROOT = REPO_ROOT; // real executor in this worktree
    const run = spawnSync(process.execPath, [launcherPath, receiptPath], {
      cwd: tmp, encoding: "utf8", timeout: 60000, env
    });
    // Executor was found via the env root, revalidated the plan, ran the
    // preflight without solvers and persisted an honest ABORTED receipt.
    assert.equal(run.status, 2, "stderr=" + run.stderr + " stdout=" + run.stdout);
    assert.equal(run.stderr, "", "blocked preflight must persist its receipt, not crash: " + run.stderr);
    assert.ok(existsSync(receiptPath), "receipt must be persisted at the argv path");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.schema, "formal-tools/execution-receipt/1.0");
    assert.equal(receipt.plan_id, plan.plan_id, "receipt must chain back to the launcher's frozen plan");
    assert.equal(receipt.overall.process_outcome, "ABORTED");
    assert.equal(receipt.overall.claim_verdict, "BLOCKED");
    assert.equal(receipt.overall.fail_closed_reason, "BLOCKED_TOOL_MISSING");
    assert.ok(receipt.steps.every(s => s.status === "NOT_RUN"), "no step may run without binaries");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("R2: launcher outside the repo with FORMAL_TOOLS_RUNNER_ROOT unset fails closed with NOT_COMPILED_FOR_EXECUTION", () => {
  const plan = fixturePlan();
  const { launcher } = compilePlan(plan);
  const tmp = mkdtempSync(join(tmpdir(), "wf-r2-unset-"));
  try {
    const launcherPath = join(tmp, "launcher.mjs");
    const receiptPath = join(tmp, "receipt.json");
    writeFileSync(launcherPath, launcher);
    const run = spawnSync(process.execPath, [launcherPath, receiptPath], {
      cwd: tmp, encoding: "utf8", timeout: 30000, env: childEnv()
    });
    assert.equal(run.status, 2, "stderr=" + run.stderr + " stdout=" + run.stdout);
    assert.match(run.stderr, /NOT_COMPILED_FOR_EXECUTION/);
    assert.ok(!existsSync(receiptPath), "no receipt without the executor");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("R2: FORMAL_TOOLS_RUNNER_ROOT set but not a runner root fails closed with RUNNER_ROOT_INVALID (exit 2, no receipt)", () => {
  const plan = fixturePlan();
  const { launcher } = compilePlan(plan);
  const tmp = mkdtempSync(join(tmpdir(), "wf-r2-badroot-"));
  try {
    const launcherPath = join(tmp, "launcher.mjs");
    const receiptPath = join(tmp, "receipt.json");
    writeFileSync(launcherPath, launcher);
    const bogus = join(tmp, "not-a-runner-root");
    mkdirSync(bogus, { recursive: true });
    const env = childEnv();
    env.FORMAL_TOOLS_RUNNER_ROOT = bogus; // exists, but lacks packages/runner/js/...
    const run = spawnSync(process.execPath, [launcherPath, receiptPath], {
      cwd: tmp, encoding: "utf8", timeout: 30000, env
    });
    assert.equal(run.status, 2, "stderr=" + run.stderr + " stdout=" + run.stdout);
    assert.match(run.stderr, /RUNNER_ROOT_INVALID/);
    assert.ok(!/NOT_COMPILED_FOR_EXECUTION/.test(run.stderr),
      "must report the locator error, not the generic fallback one");
    assert.ok(!existsSync(receiptPath), "no receipt when the locator is misconfigured");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("R2: compilePlan bytes are independent of FORMAL_TOOLS_RUNNER_ROOT (no baked absolute paths)", () => {
  const plan = fixturePlan();
  const saved = process.env[RUNNER_ROOT_ENV_VAR];
  try {
    delete process.env[RUNNER_ROOT_ENV_VAR];
    const clean = compilePlan(plan);
    process.env[RUNNER_ROOT_ENV_VAR] = "/tmp/definitely-not-baked-in";
    const withEnv = compilePlan(plan);
    assert.equal(clean.launcher, withEnv.launcher);
    assert.equal(JSON.stringify(clean.manifest), JSON.stringify(withEnv.manifest));
    assert.equal(clean.manifest.launcher_sha256, withEnv.manifest.launcher_sha256);
    assert.ok(!clean.launcher.includes("/tmp/definitely-not-baked-in"),
      "launcher text must never embed the env value");
  } finally {
    if (saved !== undefined) process.env[RUNNER_ROOT_ENV_VAR] = saved;
  }
});

test("R2: FORMAL_TOOLS_RUNNER_ROOT takes precedence over the in-repo relative executor", () => {
  const plan = fixturePlan();
  const { launcher } = compilePlan(plan);
  const tmp = mkdtempSync(join(tmpdir(), "wf-r2-precedence-"));
  try {
    // env-root stub answers UNKNOWN (non-PASS -> exit 2); the in-repo relative
    // stub answers PASS (would exit 0). Persisted verdict discriminates which
    // executor actually ran.
    installStub(join(tmp, "runner-root"), "UNKNOWN");
    const repoLayout = join(tmp, "repo");
    installStub(repoLayout, "PASS");
    const dir = join(repoLayout, "artifacts", plan.plan_id);
    mkdirSync(dir, { recursive: true });
    const launcherPath = join(dir, "launcher.mjs");
    const receiptPath = join(tmp, "receipt.json");
    writeFileSync(launcherPath, launcher);
    const env = childEnv();
    env.FORMAL_TOOLS_RUNNER_ROOT = join(tmp, "runner-root");
    const run = spawnSync(process.execPath, [launcherPath, receiptPath], {
      cwd: repoLayout, encoding: "utf8", timeout: 30000, env
    });
    assert.equal(run.status, 2, "env-root stub verdict UNKNOWN must yield exit 2: " + run.stderr);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.overall.claim_verdict, "UNKNOWN", "env root must win over the relative fallback");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("R2: in-repo relative fallback still works when FORMAL_TOOLS_RUNNER_ROOT is unset", () => {
  const plan = fixturePlan();
  const { launcher } = compilePlan(plan);
  const tmp = mkdtempSync(join(tmpdir(), "wf-r2-inrepo-"));
  try {
    const repoLayout = join(tmp, "repo");
    installStub(repoLayout, "PASS");
    const dir = join(repoLayout, "artifacts", plan.plan_id);
    mkdirSync(dir, { recursive: true });
    const launcherPath = join(dir, "launcher.mjs");
    const receiptPath = join(repoLayout, "receipt.json");
    writeFileSync(launcherPath, launcher);
    const run = spawnSync(process.execPath, [launcherPath, receiptPath], {
      cwd: tmp, encoding: "utf8", timeout: 30000, env: childEnv()
    });
    assert.equal(run.status, 0, "PASS via relative fallback must exit 0: " + run.stderr);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.overall.claim_verdict, "PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("R2: in-process main() surfaces RUNNER_ROOT_INVALID with an exact error code", async () => {
  const plan = fixturePlan();
  const { launcher } = compilePlan(plan);
  const tmp = mkdtempSync(join(tmpdir(), "wf-r2-inproc-"));
  const saved = process.env[RUNNER_ROOT_ENV_VAR];
  try {
    // valid env root -> main() returns the stub receipt
    installStub(join(tmp, "runner-root"), "BLOCKED");
    const launcherPath = join(tmp, "launcher.mjs");
    writeFileSync(launcherPath, launcher);
    process.env[RUNNER_ROOT_ENV_VAR] = join(tmp, "runner-root");
    const mod = await import(pathToFileURL(launcherPath).href);
    const receiptPath = join(tmp, "receipt.json");
    const receipt = await mod.main(["node", "launcher.mjs", receiptPath]);
    assert.equal(receipt.overall.claim_verdict, "BLOCKED");
    assert.equal(JSON.parse(readFileSync(receiptPath, "utf8")).overall.claim_verdict, "BLOCKED");
  } finally {
    if (saved !== undefined) process.env[RUNNER_ROOT_ENV_VAR] = saved;
    else delete process.env[RUNNER_ROOT_ENV_VAR];
    rmSync(tmp, { recursive: true, force: true });
  }
  // invalid env root -> rejects with the precise code (fresh module, no cache hit)
  const tmp2 = mkdtempSync(join(tmpdir(), "wf-r2-inproc2-"));
  try {
    const launcherPath2 = join(tmp2, "launcher.mjs");
    writeFileSync(launcherPath2, launcher);
    process.env[RUNNER_ROOT_ENV_VAR] = join(tmp2, "empty-root");
    mkdirSync(join(tmp2, "empty-root"), { recursive: true });
    const mod2 = await import(pathToFileURL(launcherPath2).href);
    await assert.rejects(
      () => mod2.main(["node", "launcher.mjs", join(tmp2, "unused.json")]),
      e => e instanceof Error && /** @type {any} */ (e).code === "RUNNER_ROOT_INVALID" &&
        /FORMAL_TOOLS_RUNNER_ROOT/.test(e.message)
    );
  } finally {
    if (saved !== undefined) process.env[RUNNER_ROOT_ENV_VAR] = saved;
    else delete process.env[RUNNER_ROOT_ENV_VAR];
    rmSync(tmp2, { recursive: true, force: true });
  }
});
