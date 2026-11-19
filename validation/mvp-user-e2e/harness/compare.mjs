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
  plan_sha256: "EXACT",
  outcome_class: "EXACT",
  cross_tool_verdict: "EXACT"
};

/** Pull the comparable, normalized core out of an entry report (or a receipt). */
export function normalizeReport(report) {
  if (!report || typeof report !== "object") return { entry: "unknown", comparable: false, reason: "NOT_A_REPORT" };
  const comparable =
    report.entry_outcome_class !== "SKIP_NOT_WIRED" &&
    report.entry_outcome_class !== "NOT_REGISTERED_YET" &&
    report.entry_outcome_class !== "SKIP_WEB_NOT_RUNNING";
  const receipt = report.normalized?.receipt ?? report.receipt ?? null;
  const planRef = report.normalized?.plan ?? report.plan ?? null;
  return {
    entry: report.entry ?? "unknown",
    comparable,
    reason: comparable ? null : `entry outcome ${report.entry_outcome_class}`,
    run_id: comparable ? (receipt?.run_id ?? report.normalized?.run_id ?? null) : null,
    plan_sha256: comparable ? (receipt?.plan_sha256 ?? planRef?.plan_sha256 ?? report.normalized?.plan_sha256 ?? null) : null,
    // A not-yet-executed entry has NO outcome yet: its skip label must never be
    // compared as if it were an outcome class.
    outcome_class: comparable ? (receipt?.overall?.solver_answer ?? report.normalized?.outcome_class ?? null) : null,
    cross_tool_verdict: comparable ? (receipt?.overall?.cross_tool_verdict ?? report.normalized?.cross_tool_verdict ?? null) : null
  };
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
      else fields[field] = { policy, verdict: a === b ? "MATCH" : "MISMATCH", a, b };
    }
  }
  // Comparability is decided by the EXACT-policy fields only: tolerated/ignored
  // fields can never make a pair comparable, and a pair whose EXACT fields are
  // all missing (entries not executed yet) compares as SKIP, never MATCH.
  const exactFields = Object.entries(fields).filter(([f]) => TOLERANCE_TABLE[f] === "EXACT").map(([f]) => f);
  const verdict = exactFields.some((f) => fields[f].verdict === "MISMATCH") ? "MISMATCH"
    : exactFields.every((f) => fields[f].verdict === "SKIP") ? "SKIP"
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
