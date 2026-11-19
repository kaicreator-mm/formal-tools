#!/usr/bin/env node
/**
 * mvp-user-e2e harness: normalized outcome comparison across the three entries
 * (CLI / MCP / Web) — issue #186.
 *
 * Takes one or more harness entry reports (run-cli.mjs / run-mcp.mjs / run-web.mjs
 * output, schema formal-tools/user-e2e-report/1.0) and compares the NORMALIZED
 * outcome under a per-field tolerance table:
 *
 *   field            comparison                     tolerance
 *   ---------------- ------------------------------ --------------------------------
 *   run_id           runA == runB                   MAY DIFFER (entries own their runs)
 *   created_at       ignored                        tolerated
 *   elapsed_ms       ignored                        tolerated
 *   plan_sha256      exact equality                 MUST MATCH across entries
 *   outcome_class    exact equality                 MUST MATCH across entries
 *   cross_tool_verdict exact equality               MUST MATCH across entries
 *
 * Reports that did not reach execution (SKIP_* / NOT_REGISTERED_YET) compare as
 * SKIP per field with the honest reason — never as a fabricated match.
 *
 * Exit codes: 0 = no MISMATCH among compared pairs (SKIP included), 2 = at least one
 * MISMATCH, 5 = harness error.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Fields where entries are ALLOWED to differ (documented tolerance table). */
export const TOLERANCE_TABLE = {
  run_id: "MAY_DIFFER",
  created_at: "IGNORED",
  elapsed_ms: "IGNORED",
  environment: "IGNORED",
  plan_sha256: "EXACT_OR_SEMANTIC",
  outcome_class: "EXACT",
  cross_tool_verdict: "EXACT"
};

/**
 * Normalize an executed receipt into the harness outcome class vocabulary.
 * Never invents values: only OBSERVED receipt fields map to classes.
 */
export function outcomeClassFromReceipt(receipt) {
  const overall = receipt?.overall;
  if (!overall) return null;
  if (overall.process_outcome === "ABORTED") return "FAIL_CLOSED_OTHER";
  const cross = overall.cross_tool_verdict;
  if (cross === "AGREE_SAT" || cross === "AGREE_UNSAT" || cross === "CONTRADICTION") return cross;
  const lp = (receipt.steps ?? []).find((s) =>
    s?.status === "EXECUTED" && s?.operation === "solve-lp" &&
    typeof s.result?.model_status === "string");
  if (lp) {
    if (lp.result.model_status === "kOptimal" && Number.isFinite(lp.result.objective))
      return "K_OPTIMAL_OBJECTIVE_" + Number(lp.result.objective);
    if (lp.result.model_status === "kInfeasible") return "K_INFEASIBLE";
    if (lp.result.model_status === "kUnbounded") return "K_UNBOUNDED";
  }
  return null;
}

/** Deterministic step-set signature: id:tool:operation:input_sha256, sorted, joined. */
export function planSignatureFromPlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) return null;
  return plan.steps
    .map((s) => `${s.id}:${s.tool}:${s.operation}:${s.input_sha256}`)
    .sort()
    .join("|");
}

/** Pull the comparable, normalized core out of an entry report (or a receipt). */
export function normalizeReport(report) {
  if (!report || typeof report !== "object") return { entry: "unknown", comparable: false, reason: "NOT_A_REPORT" };
  const comparable =
    report.entry_outcome_class !== "SKIP_NOT_WIRED" &&
    report.entry_outcome_class !== "NOT_REGISTERED_YET" &&
    report.entry_outcome_class !== "SKIP_WEB_NOT_RUNNING";
  const receipt = report.normalized?.receipt ?? report.receipt ?? null;
  const planRef = report.normalized?.plan ?? report.plan ?? null;
  const outcome =
    comparable
      ? (receipt
          ? (outcomeClassFromReceipt(receipt) ?? report.normalized?.outcome_class ?? null)
          : report.normalized?.outcome_class ?? null)
      : null;
  const crossTool = comparable
    ? (receipt?.overall?.cross_tool_verdict ?? report.normalized?.cross_tool_verdict ?? null)
    : null;
  return {
    entry: report.entry ?? "unknown",
    comparable,
    reason: comparable ? null : `entry outcome ${report.entry_outcome_class}`,
    run_id: comparable ? (receipt?.run_id ?? report.normalized?.run_id ?? null) : null,
    plan_sha256: comparable ? (receipt?.plan_sha256 ?? planRef?.plan_sha256 ?? report.normalized?.plan_sha256 ?? null) : null,
    // A not-yet-executed entry has NO outcome yet: its skip label must never be
    // compared as if it were an outcome class.
    outcome_class: outcome,
    cross_tool_verdict: crossTool,
    // Semantic identity of the step set: lets entries that planned the SAME
    // steps through different plan envelopes compare as MATCH_SEMANTIC.
    plan_signature:
      (comparable ? (report.normalized?.plan_signature ?? null) : null) ??
      planSignatureFromPlan(planRef) ??
      planSignatureFromSteps(receipt?.steps)
  };
}

/** Receipt-side fallback signature (receipt steps carry no input_sha256, so
 * id:tool:operation is the coarsest honest signature). */
function planSignatureFromSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return steps.map((s) => `${s.step_id}:${s.tool}:${s.operation}`).sort().join("|");
}

/** Compare two normalized entries field-by-field under the tolerance table. */
export function compareEntries(normA, normB) {
  const fields = {};
  for (const [field, policy] of Object.entries(TOLERANCE_TABLE)) {
    const a = normA[field], b = normB[field];
    if (policy === "IGNORED" || policy === "MAY_DIFFER") {
      fields[field] = { policy, verdict: a === undefined || b === undefined ? "SKIP" : "MATCH_TOLERATED" };
    } else {
      if (a === null || a === undefined || b === null || b === undefined)
        fields[field] = { policy, verdict: "SKIP", detail: "field missing on at least one side (entry not executed yet)" };
      else if (a === b) fields[field] = { policy, verdict: "MATCH", a, b };
      else if (field === "plan_sha256" &&
               normA.plan_signature && normA.plan_signature === normB.plan_signature)
        // Different plan envelopes (entries may normalize the same problem with
        // different problem_kind metadata) but the SAME step set: honest
        // semantic parity, explicitly labeled — never reported as an exact match.
        fields[field] = { policy, verdict: "MATCH_SEMANTIC", a, b,
          detail: "plan envelopes differ; step-set signature is identical" };
      else fields[field] = { policy, verdict: "MISMATCH", a, b };
    }
  }
  // Comparability is decided by the EXACT/EXACT_OR_SEMANTIC-policy fields only:
  // tolerated/ignored fields can never make a pair comparable, and a pair whose
  // deciding fields are all missing (entries not executed yet) compares as
  // SKIP, never MATCH.
  const decidingFields = Object.entries(fields)
    .filter(([f]) => TOLERANCE_TABLE[f].startsWith("EXACT")).map(([f]) => f);
  const verdict = decidingFields.some((f) => fields[f].verdict === "MISMATCH") ? "MISMATCH"
    : decidingFields.every((f) => fields[f].verdict === "SKIP") ? "SKIP"
    : "MATCH";
  return { pair: `${normA.entry}-vs-${normB.entry}`, fields, verdict };
}

export function compareReports(reports) {
  const norms = reports.map(normalizeReport);
  const pairs = [];
  for (let i = 0; i < norms.length; i++) {
    for (let j = i + 1; j < norms.length; j++) pairs.push(compareEntries(norms[i], norms[j]));
  }
  const overall = pairs.some((p) => p.verdict === "MISMATCH") ? "MISMATCH"
    : pairs.length === 0 ? "SKIP" : pairs.every((p) => p.verdict === "SKIP") ? "SKIP" : "MATCH";
  return { schema: "formal-tools/user-e2e-comparison/1.0", generated_at: new Date().toISOString(),
    entries: norms, pairs, overall,
    note: "SKIP means at least one entry has not executed yet (honest progress), never a fabricated pass." };
}

async function main() {
  const paths = [];
  /** @type {[string, number][]} */
  const flagSlots = [["--cli", 0], ["--mcp", 1], ["--web", 2]];
  for (const [flag, slot] of flagSlots) {
    const i = process.argv.indexOf(flag);
    if (i >= 0 && process.argv[i + 1]) paths[slot] = resolve(process.cwd(), String(process.argv[i + 1]));
  }
  const loaded = [];
  for (const p of paths.filter(Boolean)) {
    try { loaded.push(JSON.parse(await readFile(p, "utf8"))); }
    catch (e) {
      process.stderr.write(JSON.stringify({ harness_error: `cannot read report ${p}: ${String(e).slice(0, 200)}` }) + "\n");
      return 5;
    }
  }
  if (loaded.length < 2) {
    process.stderr.write(JSON.stringify({ harness_error: "compare needs at least two reports: --cli <f> --mcp <f> --web <f>" }) + "\n");
    return 5;
  }
  const comparison = compareReports(loaded);
  const outIdx = process.argv.indexOf("--out");
  if (outIdx >= 0 && process.argv[outIdx + 1])
    await writeFile(resolve(process.cwd(), process.argv[outIdx + 1]), JSON.stringify(comparison, null, 2) + "\n");
  process.stdout.write(JSON.stringify(comparison, null, 2) + "\n");
  return comparison.overall === "MISMATCH" ? 2 : 0;
}

const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
