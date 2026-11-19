#!/usr/bin/env node
/**
 * mvp-user-e2e harness entry: Web HTTP (issue #186).
 *
 * Client for the apps/web endpoints (/api/meta, /api/plan, /api/runs,
 * /api/runs/:id, /api/runs/:id/evidence) with the same shape-conformance checks
 * against the pinned contracts as the CLI/MCP entries.
 *
 * apps/web does not exist at r0 (33bd3d0), so the expected honest outcome today is
 * SKIP_WEB_NOT_RUNNING on connection refusal — reported, never fabricated.
 *
 * Exit codes: 0 = report produced (SKIP_WEB_NOT_RUNNING is OK), 2 = endpoint shape
 * mismatch while the server IS running, 5 = harness error.
 */
import { resolve } from "node:path";
import {
  EXECUTION_PLAN_SCHEMA, EXECUTION_RECEIPT_SCHEMA,
  validateExecutionPlanShape, validateExecutionReceiptShape
} from "./lib.mjs";

export const WEB_BASE_DEFAULT = "http://127.0.0.1:8787";

function connectionRefused(err) {
  const causes = [err?.cause?.code, err?.code, String(err?.cause ?? "")].join(" ");
  return /ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN/.test(causes);
}

async function fetchJson(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const method = opts.method ?? "GET";
  const body = opts.body;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method, signal: controller.signal,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { ok: resp.ok, status: resp.status, json, text: text.slice(0, 65536), fetch_error: null };
  } catch (e) {
    return { ok: false, status: null, json: undefined, text: "", fetch_error: e, connection_refused: connectionRefused(e) };
  } finally { clearTimeout(timer); }
}

/** Best-guess endpoint map until the web app lands; extend here when it does. */
export const WEB_ENDPOINTS = {
  meta: "/api/meta",
  plan: "/api/plan",
  runs: "/api/runs",
  run: "/api/runs/PROBE-RUN-ID",
  evidence: "/api/runs/PROBE-RUN-ID/evidence"
};

export async function buildReport({ baseUrl = process.env.WEB_E2E_BASE_URL ?? WEB_BASE_DEFAULT } = {}) {
  const report = {
    schema: "formal-tools/user-e2e-report/1.0",
    entry: "web",
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    checks: [],
    receipt_conformance: null,
    plan_conformance: null,
    entry_outcome_class: null
  };

  const meta = await fetchJson(new URL(WEB_ENDPOINTS.meta, baseUrl).href);
  if (meta.fetch_error && meta.connection_refused) {
    report.checks.push({
      name: "server-reachable",
      outcome: "CONNECTION_REFUSED",
      detail: `no web server at ${baseUrl} (apps/web not present at r0)`
    });
    report.entry_outcome_class = "SKIP_WEB_NOT_RUNNING";
    return report;
  }
  if (meta.fetch_error) {
    report.checks.push({ name: "server-reachable", outcome: "HARNESS_ERROR", detail: String(meta.fetch_error).slice(0, 300) });
    report.entry_outcome_class = "FAIL_CLOSED_OTHER";
    return report;
  }
  report.checks.push({ name: "server-reachable", outcome: "OK", detail: `/api/meta -> ${meta.status}` });

  // POST /api/plan with a user prompt; conform the response to the pinned plan contract.
  const plan = await fetchJson(new URL(WEB_ENDPOINTS.plan, baseUrl).href, {
    method: "POST",
    body: { user_prompt: "PROBE: verify integers x,y in [0,1] cannot sum to 4 (see fixtures/user-prompt-a.txt)." }
  });
  if (plan.json?.schema === EXECUTION_PLAN_SCHEMA) {
    const conf = validateExecutionPlanShape(plan.json);
    report.plan_conformance = { ok: conf.ok, errors: conf.errors };
    report.checks.push({ name: "api-plan-shape", outcome: conf.ok ? "OK" : "MISMATCH", detail: `plan_id=${plan.json.plan_id}` });
  } else {
    report.checks.push({
      name: "api-plan-shape", outcome: plan.ok ? "OBSERVED" : "OBSERVED",
      detail: `/api/plan -> ${plan.status}; response is not an ExecutionPlan yet (PENDING-LIVE-RUN)`
    });
  }

  for (const [name, path] of [["runs-list", WEB_ENDPOINTS.runs], ["run-detail", WEB_ENDPOINTS.run], ["run-evidence", WEB_ENDPOINTS.evidence]]) {
    const r = await fetchJson(new URL(path, baseUrl).href);
    if (name !== "runs-list" && r.json?.schema === EXECUTION_RECEIPT_SCHEMA) {
      const conf = validateExecutionReceiptShape(r.json);
      report.receipt_conformance = { endpoint: path, ok: conf.ok, errors: conf.errors };
      report.checks.push({ name: `${name}-shape`, outcome: conf.ok ? "OK" : "MISMATCH", detail: `status=${r.status}` });
    } else {
      report.checks.push({ name: `${name}-shape`, outcome: r.ok ? "OBSERVED" : "OBSERVED", detail: `${path} -> ${r.status ?? String(r.fetch_error).slice(0, 120)} (PENDING-LIVE-RUN)` });
    }
  }

  report.entry_outcome_class = report.checks.some((c) => c.outcome === "MISMATCH")
    ? "WEB_SHAPE_MISMATCH"
    : "WEB_REACHABLE_PARTIAL_SEE_CHECKS";
  return report;
}

async function main() {
  let report;
  try { report = await buildReport(); }
  catch (e) {
    process.stderr.write(JSON.stringify({ schema: "formal-tools/user-e2e-report/1.0", entry: "web", harness_error: String(e) }) + "\n");
    return 5;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.entry_outcome_class === "SKIP_WEB_NOT_RUNNING") return 0;
  return report.entry_outcome_class === "WEB_SHAPE_MISMATCH" ? 2 : 0;
}

const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
