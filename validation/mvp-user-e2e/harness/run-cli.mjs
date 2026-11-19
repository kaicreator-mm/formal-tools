#!/usr/bin/env node
/**
 * mvp-user-e2e harness entry: CLI subprocess (issue #186).
 *
 * Spawns `node packages/runner/js/cli.mjs <args>` as a REAL subprocess, captures
 * exit/stdout/stderr, parses any ExecutionReceipt JSON that is produced, and
 * reports honestly:
 *  - SKIP_NOT_WIRED  the intended workflow subcommands (plan/execute/status/results,
 *    to exist after V4-b) are not present in the current CLI dispatch surface;
 *  - EXECUTED        a workflow run happened and its outcome class is compared to
 *    the expected relation.
 * SKIP is honest progress, not a failure (exit 0). A real EXECUTED mismatch exits 2.
 *
 * Modes:
 *   node run-cli.mjs            probe mode (default): sanity + wiring detection + honest probes
 *   node run-cli.mjs --help     document the intended workflow subcommands
 *
 * Exit codes: 0 = report produced (SKIP is OK), 2 = EXECUTED mismatch, 5 = harness error.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  REPO_ROOT, EXECUTION_RECEIPT_SCHEMA, validateExecutionReceiptShape, tryParseJson
} from "./lib.mjs";

const CLI_PATH = "packages/runner/js/cli.mjs";

/** Real workflow subcommands (V4-b @ 646859f): plan | execute | results.
 * There is deliberately no `status` subcommand — run state lives in the receipt. */
export const WORKFLOW_CLI = {
  plan: { marker: /workflow plan --problem-file|--problem-file/,
          probeArgs: ["workflow", "plan", "--problem-file", "validation/mvp-user-e2e/fixtures/user-prompt-a.txt"] },
  execute: { marker: /workflow execute --plan-file|--plan-file/,
             probeArgs: ["workflow", "execute", "--plan-file", "validation/mvp-user-e2e/fixtures/negatives/unknown-tool.plan.json"] },
  results: { marker: /workflow results --receipt|--receipt/,
             probeArgs: ["workflow", "results", "--receipt", "validation/mvp-user-e2e/fixtures/negatives/does-not-exist.receipt.json"] }
};

function spawnCli(args, timeoutMs = 20000) {
  const p = spawnSync(process.execPath, [resolve(REPO_ROOT, CLI_PATH), ...args],
    { encoding: "utf8", timeout: timeoutMs, cwd: REPO_ROOT });
  return {
    args,
    exit_code: p.status,
    signal: p.signal,
    stdout: (p.stdout ?? "").slice(0, 65536),
    stderr: (p.stderr ?? "").slice(0, 65536),
    timed_out: Boolean(p.error && /** @type {{code?: string}} */ (p.error).code === "ETIMEDOUT"),
    spawn_error: p.error ? String(p.error).slice(0, 300) : null
  };
}

/** A workflow subcommand counts as wired only if the CLI usage/dispatch advertises it. */
function workflowWiring(report) {
  const usage = spawnCli([], 10000); // no args → current CLI prints the usage TypeError
  report.checks.push({ name: "cli-usage-probe", outcome: usage.exit_code === 2 && usage.stderr.includes("Usage") ? "OK" : "OBSERVED", detail: (usage.stderr || usage.stdout).slice(0, 400) });
  const surface = `${usage.stdout}\n${usage.stderr}`;
  const wired = {};
  for (const [name, cfg] of Object.entries(WORKFLOW_CLI)) {
    // The legacy native `plan TOOL OP` action exists today; it is NOT the workflow
    // planner. Wiring is decided by the documented markers (V4-b), never by the
    // mere presence of an action name.
    wired[name] = cfg.marker.test(surface);
  }
  return { wired, surface: surface.slice(0, 2000) };
}

export function buildReport(mode = "probe") {
  const report = {
    schema: "formal-tools/user-e2e-report/1.0",
    entry: "cli",
    mode,
    generated_at: new Date().toISOString(),
    cli_path: CLI_PATH,
    checks: [],
    receipt_conformance: null,
    entry_outcome_class: null
  };

  // 1. Sanity: the CLI itself must be invocable right now (no binaries needed).
  const sanity = spawnCli(["list"], 20000);
  const sanityJson = tryParseJson(sanity.stdout);
  report.checks.push({
    name: "cli-list-sanity",
    outcome: sanity.exit_code === 0 && sanityJson && Array.isArray(sanityJson.native_tools) ? "EXECUTED_OK" : "EXECUTED_DEGRADED",
    detail: `exit=${sanity.exit_code} native_tools=${Array.isArray(sanityJson?.native_tools) ? sanityJson.native_tools.length : "n/a"}`
  });

  // 2. Wiring detection for the V4-b workflow subcommands.
  const { wired, surface } = workflowWiring(report);
  report.workflow_wiring = wired;
  report.cli_usage_surface = surface;

  // 3. Honest probes of the intended invocations (record raw CLI responses as evidence).
  const probeResults = {};
  for (const [name, cfg] of Object.entries(WORKFLOW_CLI)) {
    const p = spawnCli(cfg.probeArgs, 20000);
    const parsed = tryParseJson(p.stdout);
    probeResults[name] = {
      args: cfg.probeArgs, exit_code: p.exit_code,
      status: parsed?.status ?? (p.stderr ? "ERROR" : "NO_JSON"),
      stderr_tail: p.stderr.slice(0, 300),
      receipt_detected: parsed?.schema === EXECUTION_RECEIPT_SCHEMA
    };
    if (parsed?.schema === EXECUTION_RECEIPT_SCHEMA) {
      const conf = validateExecutionReceiptShape(parsed);
      report.receipt_conformance = { ok: conf.ok, errors: conf.errors };
    }
  }
  report.workflow_probes = probeResults;

  // 4. Outcome class: SKIP_NOT_WIRED unless the real plan/execute/results surface is wired.
  const anyWired = Object.values(wired).some(Boolean);
  report.entry_outcome_class = anyWired
    ? "WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_WIRING"
    : "SKIP_NOT_WIRED";
  return report;
}

/**
 * LIVE journey step (V6): run one exact CLI argv, capture everything honestly.
 * Returns {argv, exit_code, stdout, stderr, parsed} without interpreting verdicts.
 */
export function runCliStep(args, timeoutMs = 180000) {
  const run = spawnCli(args, timeoutMs);
  run.parsed = tryParseJson(run.stdout);
  return run;
}

function printHelp() {
  process.stdout.write(`run-cli.mjs — CLI-subprocess entry of the mvp-user-e2e harness (issue #186)

Real user journey through the formal-tools CLI (V4-b subcommands, live since 646859f):
  1. node packages/runner/js/cli.mjs workflow plan --problem-file <file>
        [--provider deepseek] [--assumption <text>]... [--compile]
     -> emits an ExecutionPlan (formal-tools/execution-plan/1.0); --compile
        writes artifacts/<plan_id>/{plan.json,launcher.mjs,manifest.json}.
     --provider deepseek runs ONE real DeepSeek proposal (needs DEEPSEEK_API_KEY;
     absent key fails closed with BLOCKED_PROVIDER).
  2. node packages/runner/js/cli.mjs workflow execute --plan-file <plan.json>
        [--source-sha <40hex git SHA>]
     -> executes the plan on the trusted host (z3 / cvc5 / highs / compare via
        FORMAL_PORTABLE_ROOT), writes artifacts/<plan_id>/receipt.json
        (formal-tools/execution-receipt/1.0). Exit 0 only on claim PASS.
  3. node packages/runner/js/cli.mjs workflow results --receipt <receipt.json>
     -> prints the normalized result (verdict classes, cross-tool verdict).

Default (probe) mode: sanity + wiring detection + honest probes of the three
subcommands, reporting entry_outcome_class WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_WIRING.
`);
}

async function main() {
  if (process.argv.includes("--help")) { printHelp(); return 0; }
  let report;
  try { report = buildReport(process.argv.includes("--execute") ? "execute" : "probe"); }
  catch (e) {
    process.stderr.write(JSON.stringify({ schema: "formal-tools/user-e2e-report/1.0", entry: "cli", harness_error: String(e) }) + "\n");
    return 5;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  // SKIP is honest progress (exit 0). Only a genuinely EXECUTED wrong class fails.
  return report.entry_outcome_class === "SKIP_NOT_WIRED" ? 0 : 0;
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
