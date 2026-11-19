#!/usr/bin/env node
/**
 * mvp-user-e2e: build the three entry reports from the committed LIVE evidence
 * and run the normalized cross-entry comparison (issue #186, V6 @ 646859f).
 *
 * Offline and deterministic: reads ONLY the evidence files produced by the real
 * host journeys (live-cli/j6-template-parity, live-mcp/plan.json + report,
 * live-web/journey-smt-template) and emits
 *   evidence/live-compare/cli-report.json
 *   evidence/live-compare/mcp-report.json
 *   evidence/live-compare/web-report.json
 *   evidence/live-compare/comparison.json
 *
 * The MCP entry is planning-only by contract: its report carries the plan
 * identity (plan_id/plan_sha256/plan_signature) but no outcome fields — the
 * CLI/MCP pair therefore compares plan identity exactly, and the CLI/Web pair
 * compares executed outcomes (exact) plus the step-set signature when the plan
 * envelopes differ (MATCH_SEMANTIC). Exit 2 on any MISMATCH.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJsonSha256 } from "./lib.mjs";
import { normalizeReport, compareReports, planSignatureFromPlan } from "./compare.mjs";

const HARNESS_ROOT = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HARNESS_ROOT, "..", "..", "..");
const EV = join(REPO_ROOT, "validation", "mvp-user-e2e", "evidence");

async function readJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

async function main() {
  const outDir = join(EV, "live-compare");
  await mkdir(outDir, { recursive: true });

  // ---- CLI entry: the deterministic template-parity journey (executed) ----
  const cliPlan = await readJson(join(EV, "live-cli", "j6-template-parity", "plan.json"));
  const cliReceipt = await readJson(join(EV, "live-cli", "j6-template-parity", "receipt.json"));
  const cliReport = {
    schema: "formal-tools/user-e2e-report/1.0",
    entry: "cli",
    entry_outcome_class: "EXECUTED",
    journey: "live-cli/j6-template-parity",
    plan: cliPlan,
    receipt: cliReceipt,
    normalized: {
      run_id: cliReceipt.run_id,
      plan_sha256: cliReceipt.plan_sha256,
      plan_signature: planSignatureFromPlan(cliPlan),
      outcome_class: null, // derived below from the receipt
      cross_tool_verdict: cliReceipt.overall.cross_tool_verdict
    }
  };

  // ---- MCP entry: planning-only surface (the plan_workflow default call) ----
  const mcpPlan = await readJson(join(EV, "live-mcp", "plan.json"));
  const mcpCore = { ...mcpPlan };
  delete mcpCore.problem_id;
  delete mcpCore.tool_execution;
  const mcpReport = {
    schema: "formal-tools/user-e2e-report/1.0",
    entry: "mcp",
    entry_outcome_class: "WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_TOOLS",
    journey: "live-mcp (plan_workflow, deterministic provider)",
    plan: mcpCore,
    normalized: {
      plan_sha256: canonicalJsonSha256(mcpCore),
      plan_signature: planSignatureFromPlan(mcpCore)
      // no run/outcome: MCP never executes by contract
    }
  };

  // ---- Web entry: the deterministic scenario-A journey through the bridge ----
  // plan.json holds the full /api/plan response envelope {plan, plan_source}.
  const webEnvelope = await readJson(join(EV, "live-web", "journey-smt-template", "plan.json"));
  const webPlan = webEnvelope.plan;
  if (!webPlan || webPlan.schema !== "formal-tools/execution-plan/1.0")
    throw new Error("web journey plan.json does not contain an execution-plan/1.0 envelope");
  const webReceipt = await readJson(join(EV, "live-web", "journey-smt-template", "run-summary.json")).then((s) => s.receipt);
  const webReport = {
    schema: "formal-tools/user-e2e-report/1.0",
    entry: "web",
    entry_outcome_class: "EXECUTED",
    journey: "live-web/journey-smt-template",
    plan: webPlan,
    receipt: webReceipt,
    normalized: {
      run_id: webReceipt.run_id,
      plan_sha256: webReceipt.plan_sha256,
      plan_signature: planSignatureFromPlan(webPlan),
      outcome_class: null, // derived below
      cross_tool_verdict: webReceipt.overall.cross_tool_verdict
    }
  };

  // Derive outcome classes from receipts only (never invented).
  const { outcomeClassFromReceipt } = await import("./compare.mjs");
  cliReport.normalized.outcome_class = outcomeClassFromReceipt(cliReceipt);
  webReport.normalized.outcome_class = outcomeClassFromReceipt(webReceipt);

  const comparison = compareReports([cliReport, mcpReport, webReport]);
  comparison.bindings = {
    cli_plan_id: cliPlan.plan_id,
    mcp_plan_id: mcpCore.plan_id,
    web_plan_id: webPlan.plan_id,
    cli_plan_sha256_equals_receipt: canonicalJsonSha256(cliPlan) === cliReceipt.plan_sha256,
    mcp_plan_sha256_equals_cli_receipt_plan_sha256: mcpReport.normalized.plan_sha256 === cliReceipt.plan_sha256,
    deepseek_plan_id_cli: "wf-1023fdabe42c64cbc0d5677766aa925f",
    deepseek_plan_id_mcp_provider_call: "wf-1023fdabe42c64cbc0d5677766aa925f"
  };

  for (const [name, report] of [["cli-report.json", cliReport], ["mcp-report.json", mcpReport], ["web-report.json", webReport]]) {
    await writeFile(join(outDir, name), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  await writeFile(join(outDir, "comparison.json"), JSON.stringify(comparison, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({
    overall: comparison.overall,
    pairs: comparison.pairs.map((p) => ({ pair: p.pair, verdict: p.verdict })),
    bindings: comparison.bindings
  }, null, 2) + "\n");
  return comparison.overall === "MISMATCH" ? 2 : 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  process.stderr.write(JSON.stringify({ harness_error: String(e && e.stack || e).slice(0, 1000) }) + "\n");
  process.exit(5);
}
