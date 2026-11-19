#!/usr/bin/env node
/**
 * mvp-user-e2e LIVE negatives driver (issue #186, V6 @ 646859f).
 *
 * Every negative must fail closed BEFORE any solver launch. Two layers are
 * exercised and recorded separately:
 *   1. harness policy layer (classifyPlan, offline): the class from the
 *      fixture table (PLAN_UNKNOWN_TOOL / PLAN_HASH_MISMATCH / TIMEOUT_BUDGET).
 *   2. the REAL CLI executor (`workflow execute --plan-file ...`) on the host:
 *      must exit non-zero with a PLAN_* fail-closed error and must NOT write
 *      any receipt artifact.
 * Plus the malformed-SMT2 journey: planned and executed for real so the
 * solvers' own parse failure is observed (step ERROR, process FAILED,
 * claim UNSUPPORTED_BY_MVP) — an honest PARSE_ERROR class, never a guess.
 *
 * Exit codes: 0 every negative failed closed as expected, 2 an expectation
 * did not hold, 5 harness error.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, copyFile, access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPlan } from "./lib.mjs";

const HARNESS_ROOT = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HARNESS_ROOT, "..", "..", "..");
const CLI = join(REPO_ROOT, "packages", "runner", "js", "cli.mjs");
const NEG = join(REPO_ROOT, "validation", "mvp-user-e2e", "fixtures", "negatives");

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const OUT_DIR = resolve(process.cwd(), arg("--out", "validation/mvp-user-e2e/evidence/live-negatives"));
const SOURCE_SHA = arg("--source-sha", null);
if (!SOURCE_SHA || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(SOURCE_SHA)) {
  process.stderr.write(JSON.stringify({ driver_error: "--source-sha <40hex git SHA> is required" }) + "\n");
  process.exit(5);
}

function runCli(args, timeoutMs = 120000) {
  const p = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: timeoutMs, cwd: REPO_ROOT });
  let parsed;
  try { parsed = JSON.parse(p.stdout ?? ""); } catch { parsed = undefined; }
  let errParsed;
  try { errParsed = JSON.parse(p.stderr ?? ""); } catch { errParsed = undefined; }
  return {
    argv: args, exit_code: p.status,
    stdout: (p.stdout ?? "").slice(0, 100000), stderr: (p.stderr ?? "").slice(0, 100000),
    parsed: parsed ?? null, errParsed: errParsed ?? null
  };
}

const expectations = [];
const expect = (name, pass, detail) => {
  expectations.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}\n`);
};

async function artifactExists(planId) {
  try { await access(join(REPO_ROOT, "artifacts", planId, "receipt.json"), fsConstants.F_OK); return true; }
  catch { return false; }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const allOk = { value: true };

  // --- layer 1: harness policy classification of the three plan fixtures ---
  const table = [
    ["unknown-tool.plan.json", "PLAN_UNKNOWN_TOOL"],
    ["tampered-hash.plan.json", "PLAN_HASH_MISMATCH"],
    ["timeout-crush.plan.json", "TIMEOUT_BUDGET"]
  ];
  const classifications = {};
  for (const [name, expectedClass] of table) {
    const plan = JSON.parse(await readFile(join(NEG, name), "utf8"));
    const cls = classifyPlan(plan, { recomputeInputSha: true, repoRoot: REPO_ROOT });
    classifications[name] = { harness_class: cls, expected: expectedClass };
    expect(`policy layer: ${name} -> ${expectedClass}`, cls === expectedClass, `observed ${cls}`);
  }

  // --- layer 2: the real CLI executor must reject each fixture before launch ---
  const executor = {};
  for (const [name] of table) {
    const before = await artifactExists(JSON.parse(await readFile(join(NEG, name), "utf8")).plan_id);
    const run = runCli(["workflow", "execute", "--plan-file", `validation/mvp-user-e2e/fixtures/negatives/${name}`]);
    // The CLI reports hard errors as {status:"ERROR", code, message} on STDERR.
    const errJson = run.errParsed?.status === "ERROR" ? run.errParsed : null;
    const failClosed = run.exit_code === 2 && errJson !== null && /^PLAN_[A-Z_]+$/.test(String(errJson.code ?? ""));
    executor[name] = {
      exit_code: run.exit_code, error_code: errJson?.code ?? null, message: String(errJson?.message ?? run.stderr).slice(0, 300),
      receipt_written: await artifactExists(JSON.parse(await readFile(join(NEG, name), "utf8")).plan_id),
      receipt_existed_before: before
    };
    expect(`executor: ${name} fails closed with a PLAN_* code and no receipt`,
      failClosed && !executor[name].receipt_written,
      `exit=${run.exit_code} code=${executor[name].error_code}`);
    await writeFile(join(OUT_DIR, `executor-${name}.json`),
      JSON.stringify({ fixture: name, ...executor[name], argv: run.argv, stdout: run.stdout.slice(0, 2000) }, null, 2) + "\n", "utf8");
    if (!(failClosed && !executor[name].receipt_written)) allOk.value = false;
  }

  // --- malformed.smt2: planned + executed for real; solvers must fail closed ---
  {
    const planRun = runCli(["workflow", "plan", "--problem-file", "validation/mvp-user-e2e/fixtures/negatives/malformed.smt2", "--compile"]);
    const planId = planRun.parsed?.plan?.plan_id;
    const record = { plan_exit_code: planPlanSafe(planRun), plan_id: planId ?? null };
    if (planId) {
      const exec = runCli(["workflow", "execute", "--plan-file", `artifacts/${planId}/plan.json`, "--source-sha", SOURCE_SHA], 180000);
      record.execute_exit_code = exec.exit_code;
      record.execute_summary = exec.parsed; // receiptSummary (overall + step statuses)
      const receiptPath = join(REPO_ROOT, "artifacts", planId, "receipt.json");
      try {
        const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
        record.overall = receipt.overall;
        record.step_statuses = receipt.steps.map((s) => ({ step_id: s.step_id, tool: s.tool, status: s.status, exit_code: s.exit_code }));
        record.fail_closed_reason = receipt.overall.fail_closed_reason ?? null;
        await copyFile(receiptPath, join(OUT_DIR, "malformed.receipt.json"));
        const honest = exec.exit_code === 2 &&
          receipt.overall.process_outcome === "FAILED" &&
          receipt.overall.claim_verdict === "UNSUPPORTED_BY_MVP" &&
          receipt.steps.every((s) => s.tool === "compare" || s.status === "ERROR" || s.status === "SKIPPED_DOWNSTREAM");
        expect("malformed.smt2: solvers fail closed (FAILED outcome, UNSUPPORTED_BY_MVP, no sat/unsat invented)",
          honest, JSON.stringify({ overall: receipt.overall, fail_closed_reason: record.fail_closed_reason }));
        if (!honest) allOk.value = false;
      } catch {
        expect("malformed.smt2: receipt artifact present", false, receiptPath);
        allOk.value = false;
      }
    } else {
      expect("malformed.smt2: planning succeeded", false, planRun.stderr.slice(0, 200));
      allOk.value = false;
    }
    await writeFile(join(OUT_DIR, "malformed-journey.json"), JSON.stringify({ fixture: "negatives/malformed.smt2", ...record }, null, 2) + "\n", "utf8");
  }

  const summary = {
    schema: "formal-tools/user-e2e-live-negatives/1.0",
    generated_at: new Date().toISOString(),
    source_sha: SOURCE_SHA,
    classifications,
    executor,
    assertions: expectations,
    summary: { checks: expectations.length, passed: expectations.filter((e) => e.pass).length, failed: expectations.filter((e) => !e.pass).length }
  };
  await writeFile(join(OUT_DIR, "negatives.report.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  process.stdout.write(`receipt: ${join(OUT_DIR, "negatives.report.json")} — ${summary.summary.passed}/${summary.summary.checks} checks passed\n`);
  return allOk.value && summary.summary.failed === 0 ? 0 : 2;
}

function planPlanSafe(run) {
  return run.exit_code;
}

try {
  process.exitCode = await main();
} catch (e) {
  process.stderr.write(JSON.stringify({ driver_error: String(e && e.stack || e).slice(0, 1000) }) + "\n");
  process.exit(5);
}
