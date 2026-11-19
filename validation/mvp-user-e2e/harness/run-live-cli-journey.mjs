#!/usr/bin/env node
/**
 * mvp-user-e2e LIVE CLI journey driver (issue #186, V6 @ 646859f).
 *
 * Runs on the trusted host (Debian, FORMAL_PORTABLE_ROOT set, bundled node),
 * where the real z3 / cvc5 / HiGHS binaries live. Orchestrates the real
 * end-user CLI journeys and records EVERYTHING honestly — argv, exit code,
 * stdout, stderr, artifacts — without interpreting any verdict:
 *
 *   J1 scenario-a (UNSAT) via the REAL DeepSeek provider:
 *      first proves the provider path fails closed without a key
 *      (BLOCKED_PROVIDER), then plans with --provider deepseek --compile,
 *      executes with --source-sha, prints results.
 *   J2 scenario-a-sat via the deterministic template (plan/execute/results).
 *   J3 user-prompt-a.txt (prose) via DeepSeek: the honest fail-closed journey —
 *      the planner proposes a method, but prose is not SMT-LIB, so execution
 *      fails closed (never a fabricated verdict).
 *   J4 scenario-b-lp.json (feasible LP): plan via the workflow-plan APIs with
 *      the frozen template shape (the CLI template is SMT-only by design),
 *      execute -> kOptimal with the hand-proven objective 11.
 *   J5 scenario-b-infeasible.json -> kInfeasible.
 *   J6 template-parity plan: deterministic scenario-a plan (same assumptions as
 *      the MCP/Web entries) executed for the cross-entry compare.
 *
 * DEEPSEEK_API_KEY comes from the environment (never logged, never persisted
 * here). Exit 0 when every journey produced its evidence files; individual
 * honest fail-closed outcomes (parse errors, blocked provider) are EXPECTED
 * results and do not fail the driver.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, copyFile, access, rm, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HARNESS_ROOT, "..", "..", "..");
const CLI = join(REPO_ROOT, "packages", "runner", "js", "cli.mjs");
const FX = join(REPO_ROOT, "validation", "mvp-user-e2e", "fixtures");

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT_DIR = resolve(process.cwd(), arg("--out", "validation/mvp-user-e2e/evidence/live-cli"));
const ONLY = arg("--only", null); // e.g. --only j4,j5 re-runs a subset of the journeys
const SOURCE_SHA = arg("--source-sha", null);
if (!SOURCE_SHA || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(SOURCE_SHA)) {
  process.stderr.write(JSON.stringify({ driver_error: "--source-sha <40hex git SHA> is required" }) + "\n");
  process.exit(5);
}
const wanted = (name) => !ONLY || ONLY.split(",").map((s) => s.trim()).some((s) => name === s || name.startsWith(s + "-"));

const journeys = [];
const childEnvStripKey = { ...process.env };
delete childEnvStripKey.DEEPSEEK_API_KEY;

function runCli(args, { timeoutMs = 240000, env = process.env } = {}) {
  const p = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: timeoutMs, cwd: REPO_ROOT, env
  });
  let parsed;
  try { parsed = JSON.parse(p.stdout ?? ""); } catch { parsed = undefined; }
  return {
    argv: args,
    exit_code: p.status,
    timed_out: Boolean(p.error && /** @type {{code?: string}} */ (p.error).code === "ETIMEDOUT"),
    stdout: (p.stdout ?? "").slice(0, 200000),
    stderr: (p.stderr ?? "").slice(0, 200000),
    parsed: parsed ?? null
  };
}

async function saveJourney(name, steps, extra = {}) {
  const dir = join(OUT_DIR, name);
  await mkdir(dir, { recursive: true });
  for (const [i, step] of steps.entries()) {
    await writeFile(join(dir, `${String(i + 1).padStart(2, "0")}-${step.name}.json`),
      JSON.stringify(step, null, 2) + "\n", "utf8");
  }
  const record = { journey: name, source_sha: SOURCE_SHA, steps: steps.map((s) => ({ name: s.name, exit_code: s.exit_code, parsed_summary: s.summary ?? null })), ...extra };
  journeys.push({ name, record });
  await writeFile(join(OUT_DIR, `${name}.report.json`), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

const stepSummary = (run) => {
  const parsed = run.parsed;
  if (parsed?.schema === "formal-tools/execution-receipt/1.0")
    return { kind: "receipt-summary", plan_id: parsed.plan_id, run_id: parsed.run_id, overall: parsed.overall, blocked: parsed.blocked ?? null };
  if (parsed?.plan?.schema === "formal-tools/execution-plan/1.0")
    return { kind: "plan", plan_id: parsed.plan.plan_id, steps: parsed.plan.steps.map((s) => ({ id: s.id, tool: s.tool, operation: s.operation })), artifacts: parsed.artifacts };
  if (parsed?.status === "ERROR")
    return { kind: "cli-error", code: parsed.code ?? null, message: String(parsed.message).slice(0, 300) };
  return { kind: run.parsed ? "json" : "non-json" };
};

async function readReceiptArtifact(planId) {
  const p = join(REPO_ROOT, "artifacts", planId, "receipt.json");
  try { await access(p, fsConstants.F_OK); return p; } catch { return null; }
}

/** Pull {plan} out of a `workflow plan` stdout and persist the plan file. */
async function persistPlan(run, dir, filename) {
  if (!run.parsed?.plan) return null;
  await writeFile(join(dir, filename), JSON.stringify(run.parsed.plan, null, 2) + "\n", "utf8");
  return run.parsed.plan;
}

// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const SAT_ASSUMPTIONS = [
    "Input is UTF-8 SMT-LIB2 text intended for QF-style solving.",
    "Solvers may return \"unknown\" within the per-step timeout; that is an honest outcome, not an error."
  ];

  // ---------------- J1: scenario-a via the REAL DeepSeek provider ----------------
  if (wanted("j1")) {
    const steps = [];
    // 1a. provider path must fail closed WITHOUT the key.
    const blocked = runCli(["workflow", "plan", "--problem-file", "validation/mvp-user-e2e/fixtures/scenario-a.smt2", "--provider", "deepseek"], { env: childEnvStripKey });
    steps.push({ name: "plan-deepseek-no-key-fails-closed", ...blocked, summary: stepSummary(blocked) });
    // 1b. the real provider call.
    const plan = runCli(["workflow", "plan", "--problem-file", "validation/mvp-user-e2e/fixtures/scenario-a.smt2",
      "--provider", "deepseek", "--compile",
      ...SAT_ASSUMPTIONS.flatMap((a) => ["--assumption", a])]);
    steps.push({ name: "plan-deepseek-compile", ...plan, summary: stepSummary(plan) });
    const planId = plan.parsed?.plan?.plan_id;
    let receipt = null;
    if (planId) {
      const planFile = `artifacts/${planId}/plan.json`;
      const exec = runCli(["workflow", "execute", "--plan-file", planFile, "--source-sha", SOURCE_SHA]);
      steps.push({ name: "execute", ...exec, summary: stepSummary(exec) });
      const results = runCli(["workflow", "results", "--receipt", `artifacts/${planId}/receipt.json`]);
      steps.push({ name: "results", ...results, summary: stepSummary(results) });
      const rp = await readReceiptArtifact(planId);
      if (rp) {
        receipt = JSON.parse(await readFile(rp, "utf8"));
        await copyFile(rp, join(OUT_DIR, "j1-unsat-deepseek.receipt.json"));
      }
      const planObj = plan.parsed.plan;
      await writeFile(join(OUT_DIR, "j1-unsat-deepseek.plan.json"), JSON.stringify(planObj, null, 2) + "\n", "utf8");
    }
    await saveJourney("j1-unsat-deepseek", steps, { provider: "deepseek", plan_id: planId ?? null, receipt_captured: Boolean(receipt) });
  }

  // ---------------- J2: scenario-a-sat via the deterministic template ----------------
  if (wanted("j2")) {
    const steps = [];
    const plan = runCli(["workflow", "plan", "--problem-file", "validation/mvp-user-e2e/fixtures/scenario-a-sat.smt2", "--compile"]);
    steps.push({ name: "plan-template", ...plan, summary: stepSummary(plan) });
    const planId = plan.parsed?.plan?.plan_id;
    let receipt = null;
    if (planId) {
      const exec = runCli(["workflow", "execute", "--plan-file", `artifacts/${planId}/plan.json`, "--source-sha", SOURCE_SHA]);
      steps.push({ name: "execute", ...exec, summary: stepSummary(exec) });
      const results = runCli(["workflow", "results", "--receipt", `artifacts/${planId}/receipt.json`]);
      steps.push({ name: "results", ...results, summary: stepSummary(results) });
      const rp = await readReceiptArtifact(planId);
      if (rp) {
        receipt = JSON.parse(await readFile(rp, "utf8"));
        await copyFile(rp, join(OUT_DIR, "j2-sat-template.receipt.json"));
      }
      await writeFile(join(OUT_DIR, "j2-sat-template.plan.json"), JSON.stringify(plan.parsed.plan, null, 2) + "\n", "utf8");
    }
    await saveJourney("j2-sat-template", steps, { provider: "deterministic-template", plan_id: planId ?? null, receipt_captured: Boolean(receipt) });
  }

  // ---------------- J3: prose prompt via DeepSeek — honest fail-closed ----------------
  if (wanted("j3")) {
    const steps = [];
    const plan = runCli(["workflow", "plan", "--problem-file", "validation/mvp-user-e2e/fixtures/user-prompt-a.txt",
      "--provider", "deepseek", "--compile"]);
    steps.push({ name: "plan-deepseek-prose", ...plan, summary: stepSummary(plan) });
    const planId = plan.parsed?.plan?.plan_id;
    let receipt = null;
    if (planId) {
      const exec = runCli(["workflow", "execute", "--plan-file", `artifacts/${planId}/plan.json`, "--source-sha", SOURCE_SHA]);
      steps.push({ name: "execute-honest-fail", ...exec, summary: stepSummary(exec) });
      const rp = await readReceiptArtifact(planId);
      if (rp) {
        receipt = JSON.parse(await readFile(rp, "utf8"));
        await copyFile(rp, join(OUT_DIR, "j3-prose-failclosed.receipt.json"));
      }
      await writeFile(join(OUT_DIR, "j3-prose-failclosed.plan.json"), JSON.stringify(plan.parsed.plan, null, 2) + "\n", "utf8");
    }
    await saveJourney("j3-prose-failclosed", steps, { provider: "deepseek", plan_id: planId ?? null, receipt_captured: Boolean(receipt),
      expected: "prose is not SMT-LIB: execution must fail closed (step ERROR / claim UNSUPPORTED_BY_MVP), never a fabricated answer" });
  }

  // ---------------- J4/J5: LP journeys via the workflow-plan APIs ----------------
  for (const [name, fixture, expect] of [
    ["j4-lp-koptimal", "scenario-b-lp.json", "kOptimal objective 11"],
    ["j5-lp-kinfeasible", "scenario-b-infeasible.json", "kInfeasible"]
  ].filter(([name]) => wanted(name))) {
    const steps = [];
    let receipt = null;
    try {
      // The CLI template is SMT-only by design; the LP plan is built through the
      // SAME public workflow-plan APIs the web bridge uses (frozen template shape).
      const planMod = await import(join(REPO_ROOT, "packages", "runner", "js", "workflow-plan.mjs"));
      const execMod = await import(join(REPO_ROOT, "packages", "runner", "js", "workflow-executor.mjs"));
      const lpModel = JSON.parse(await readFile(join(FX, fixture), "utf8"));
      const lpText = JSON.stringify(lpModel);
      const normalized = planMod.normalizeUserProblem(lpText, {
        problemKind: "lp-json",
        capabilityIds: ["opt.numerical"],
        assumptions: [
          "LP model is well-formed and interpreted with standard HiGHS linear-programming semantics.",
          "Numerical tolerance for optimality follows the solver default."
        ]
      });
      const method = {
        schema: planMod.METHOD_PROPOSAL_SCHEMA,
        method_id: "template-highs-lp",
        problem_id: normalized.problem.problem_id,
        goal_claim_ids: ["claim1"],
        oracle_ids: ["heldout"],
        semantic_review: "PENDING",
        steps: [{
          id: "step-highs", tool_id: "highs", operation: "UNRESOLVED", claim_ids: ["claim1"],
          provides: ["opt.numerical"], depends_on: [], source_refs: ["user-problem-text"],
          estimated_cost_units: 1, timeout_ms: 30000, destination: "LOCAL", output_classification: "PUBLIC"
        }]
      };
      const typed = planMod.stepsFromMethod(method, { "step-highs": lpModel });
      const plan = planMod.buildExecutionPlan({
        problem: normalized.problem, method, steps: typed,
        assumptions: normalized.assumptions, problemKind: "lp-json"
      });
      const dir = join(OUT_DIR, name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");
      steps.push({
        name: "plan-via-sdk", exit_code: 0, stdout: "", stderr: "",
        argv: ["<workflow-plan APIs: normalizeUserProblem + stepsFromMethod + buildExecutionPlan>"],
        plan, summary: { kind: "plan", plan_id: plan.plan_id, steps: plan.steps.map((s) => ({ id: s.id, tool: s.tool, operation: s.operation })) }
      });
      const { receipt: rec, workspaceDir } = await execMod.executeWorkflowPlan(plan, { sourceSha: SOURCE_SHA });
      steps.push({
        name: "execute", exit_code: rec.overall.claim_verdict === "PASS" ? 0 : 2,
        stdout: JSON.stringify({ schema: rec.schema, run_id: rec.run_id, overall: rec.overall }), stderr: "",
        argv: ["<executeWorkflowPlan(plan, {sourceSha})>"], workspaceDir,
        summary: { kind: "receipt", run_id: rec.run_id, overall: rec.overall }
      });
      receipt = rec;
      await writeFile(join(dir, "receipt.json"), JSON.stringify(rec, null, 2) + "\n", "utf8");
      await writeFile(join(OUT_DIR, `${name}.receipt.json`), JSON.stringify(rec, null, 2) + "\n", "utf8");
      // cleanup the executor temp workspace (artifacts were persisted already)
      if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    } catch (e) {
      steps.push({ name: "driver-error", exit_code: 5, stdout: "", stderr: String(e).slice(0, 500), argv: [], summary: { kind: "driver-error" } });
    }
    await saveJourney(name, steps, { provider: "deterministic-template-highs", expected: expect, receipt_captured: Boolean(receipt) });
  }

  // ---------------- J6: deterministic template-parity plan (cross-entry compare) ----------------
  if (wanted("j6")) {
    const steps = [];
    const plan = runCli(["workflow", "plan", "--problem-file", "validation/mvp-user-e2e/fixtures/scenario-a.smt2",
      ...SAT_ASSUMPTIONS.flatMap((a) => ["--assumption", a])]);
    steps.push({ name: "plan-template-uncompiled", ...plan, summary: stepSummary(plan) });
    let receipt = null;
    const planObj = plan.parsed?.plan ?? null;
    if (planObj) {
      const dir = join(OUT_DIR, "j6-template-parity");
      await mkdir(dir, { recursive: true });
      const planFile = join(dir, "plan.json");
      await writeFile(planFile, JSON.stringify(planObj, null, 2) + "\n", "utf8");
      const exec = runCli(["workflow", "execute", "--plan-file", planFile, "--source-sha", SOURCE_SHA]);
      steps.push({ name: "execute", ...exec, summary: stepSummary(exec) });
      const runId = exec.parsed?.run_id;
      if (runId) {
        const abs = await (async () => {
          // CLI wrote the receipt under artifacts/<plan_id>/receipt.json
          const rp = await readReceiptArtifact(planObj.plan_id);
          return rp;
        })();
        if (abs) {
          receipt = JSON.parse(await readFile(abs, "utf8"));
          await copyFile(abs, join(dir, "receipt.json"));
        }
      }
    }
    await saveJourney("j6-template-parity", steps, { provider: "deterministic-template", plan_id: planObj?.plan_id ?? null, receipt_captured: Boolean(receipt) });
  }

  // When --only re-runs a subset, merge with the previous summary so the
  // combined journeys.json keeps every journey that ran (by journey name).
  let previous = [];
  try {
    const prior = JSON.parse(await readFile(join(OUT_DIR, "journeys.json"), "utf8"));
    if (Array.isArray(prior.journeys)) previous = prior.journeys;
  } catch { /* first run */ }
  const merged = new Map(previous.map((r) => [r.journey, r]));
  for (const j of journeys) merged.set(j.record.journey, j.record);
  const ordered = ["j1-unsat-deepseek", "j2-sat-template", "j3-prose-failclosed", "j4-lp-koptimal", "j5-lp-kinfeasible", "j6-template-parity"]
    .map((n) => merged.get(n)).filter(Boolean);
  const summary = {
    schema: "formal-tools/user-e2e-live-cli/1.0",
    generated_at: new Date().toISOString(),
    source_sha: SOURCE_SHA,
    out_dir: OUT_DIR,
    journeys: ordered,
    note: "Every step above is a real subprocess/SDK run on the trusted host. Honest fail-closed outcomes are recorded, never retried into fakes."
  };
  await writeFile(join(OUT_DIR, "journeys.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({
    journeys: journeys.map((j) => ({ name: j.name, steps: j.record.steps.length, receipt_captured: j.record.receipt_captured }))
  }, null, 2) + "\n");
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  process.stderr.write(JSON.stringify({ driver_error: String(e && e.stack || e).slice(0, 1000) }) + "\n");
  process.exit(5);
}
