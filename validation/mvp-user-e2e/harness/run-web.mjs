#!/usr/bin/env node
/**
 * mvp-user-e2e harness entry: Web HTTP (issue #186).
 *
 * Client for the real apps/web bridge endpoints (GET /api/meta,
 * POST /api/plan {problem_text, provider?}, POST /api/runs {plan},
 * GET /api/runs/:id, GET /api/runs/:id/evidence) with the same
 * shape-conformance checks against the pinned contracts as the CLI/MCP
 * entries. Without a running server the honest outcome is
 * SKIP_WEB_NOT_RUNNING on connection refusal — reported, never fabricated.
 *
 * LIVE mode (`node run-web.mjs --live --problem <file> [--provider deepseek]
 * --out <dir>`) drives the full user path over HTTP: plan -> run -> poll ->
 * evidence download, saving the served bytes verbatim.
 *
 * Exit codes: 0 = report produced (SKIP_WEB_NOT_RUNNING is OK), 2 = endpoint shape
 * mismatch while the server IS running (or an incomplete live journey), 5 = harness error.
 */
import { resolve } from "node:path";
import {
  EXECUTION_PLAN_SCHEMA, EXECUTION_RECEIPT_SCHEMA,
  validateExecutionPlanShape, validateExecutionReceiptShape
} from "./lib.mjs";

export const WEB_BASE_DEFAULT = "http://127.0.0.1:8788";

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

/** Real apps/web endpoints (V5-b @ 646859f). There is no GET /api/runs list;
 * run state is per-id. */
export const WEB_ENDPOINTS = {
  meta: "/api/meta",
  plan: "/api/plan",
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
      detail: `no web server at ${baseUrl} (apps/web not started)`
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

  // POST /api/plan with a real SMT2 problem; conform the response to the pinned plan contract.
  const plan = await fetchJson(new URL(WEB_ENDPOINTS.plan, baseUrl).href, {
    method: "POST",
    body: { problem_text: "(set-logic QF_LIA)\n(declare-const x Int)\n(declare-const y Int)\n(assert (>= x 0))\n(assert (<= x 1))\n(assert (>= y 0))\n(assert (<= y 1))\n(assert (>= (+ x y) 4))\n(check-sat)\n(exit)" }
  });
  if (plan.json?.plan?.schema === EXECUTION_PLAN_SCHEMA) {
    const conf = validateExecutionPlanShape(plan.json.plan);
    report.plan_conformance = { ok: conf.ok, errors: conf.errors, plan_source: plan.json.plan_source ?? null };
    report.checks.push({ name: "api-plan-shape", outcome: conf.ok ? "OK" : "MISMATCH", detail: `plan_id=${plan.json.plan.plan_id}` });
  } else {
    report.checks.push({
      name: "api-plan-shape", outcome: "OBSERVED",
      detail: `/api/plan -> ${plan.status}; response is not an {plan, plan_source} envelope`
    });
  }

  for (const [name, path] of [["run-detail", WEB_ENDPOINTS.run], ["run-evidence", WEB_ENDPOINTS.evidence]]) {
    const r = await fetchJson(new URL(path, baseUrl).href);
    // A probe id must fail closed with the honest 404 error envelope.
    const honest404 = r.status === 404 && r.json?.error?.code === "RUN_NOT_FOUND";
    report.checks.push({
      name: `${name}-probe`,
      outcome: honest404 ? "OK" : "OBSERVED",
      detail: `${path} -> ${r.status ?? String(r.fetch_error).slice(0, 120)} ${r.json?.error?.code ?? ""}`
    });
  }

  report.entry_outcome_class = report.checks.some((c) => c.outcome === "MISMATCH")
    ? "WEB_SHAPE_MISMATCH"
    : "WEB_REACHABLE_PARTIAL_SEE_CHECKS";
  return report;
}

/**
 * LIVE journey (V6): full HTTP user path — plan -> run -> poll -> evidence —
 * against a RUNNING apps/web server. provider: "deepseek" needs the key on the
 * SERVER host; the deterministic template is the default. Every artifact is
 * the served bytes, saved under outDir. Nothing is interpreted into a verdict:
 * the receipt speaks for itself.
 * @param {{baseUrl?: string, problemText?: string, provider?: string,
 *          outDir?: string, pollIntervalMs?: number, pollTimeoutMs?: number}} [options]
 */
export async function runLiveJourney({
  baseUrl = process.env.WEB_E2E_BASE_URL ?? WEB_BASE_DEFAULT,
  problemText,
  provider,
  outDir,
  pollIntervalMs = 500,
  pollTimeoutMs = 180000
} = {}) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const steps = [];
  const note = (name, data) => { steps.push({ name, at: new Date().toISOString(), ...data }); };
  await mkdir(outDir, { recursive: true });
  const plan = await fetchJson(new URL(WEB_ENDPOINTS.plan, baseUrl).href, {
    method: "POST", timeoutMs: 120000,
    body: provider ? { problem_text: problemText, provider } : { problem_text: problemText }
  });
  note("POST /api/plan", { status: plan.status, has_plan: Boolean(plan.json?.plan), plan_source: plan.json?.plan_source ?? null });
  if (!plan.json?.plan) {
    await writeFile(join(outDir, "plan-response.json"), plan.text, "utf8");
    return { ok: false, steps, error: "no plan in response", status: plan.status };
  }
  await writeFile(join(outDir, "plan.json"), JSON.stringify(plan.json, null, 2) + "\n", "utf8");
  const started = await fetchJson(new URL("/api/runs", baseUrl).href, {
    method: "POST", body: { plan: plan.json.plan }
  });
  note("POST /api/runs", { status: started.status, run_id: started.json?.run_id ?? null });
  if (!started.json?.run_id) {
    await writeFile(join(outDir, "runs-response.json"), started.text, "utf8");
    return { ok: false, steps, error: "run not started", status: started.status };
  }
  const runId = started.json.run_id;
  let summary = null;
  const t0 = Date.now();
  while (Date.now() - t0 < pollTimeoutMs) {
    const poll = await fetchJson(new URL(`/api/runs/${runId}`, baseUrl).href);
    if (poll.json?.status === "complete" || poll.json?.status === "aborted") { summary = poll.json; break; }
    if (poll.fetch_error) note("poll", { error: String(poll.fetch_error).slice(0, 120) });
    await new Promise((ok) => setTimeout(ok, pollIntervalMs));
  }
  if (!summary) return { ok: false, steps, error: "run did not finish in time", run_id: runId };
  await writeFile(join(outDir, "run-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  const receipt = summary.receipt;
  const ev = await fetch(new URL(`/api/runs/${runId}/evidence`, baseUrl).href);
  const evidenceBytes = Buffer.from(await ev.arrayBuffer());
  await writeFile(join(outDir, "receipt-download.json"), evidenceBytes, "utf8");
  note("GET /api/runs/:id/evidence", { status: ev.status, bytes: evidenceBytes.length,
    content_disposition: ev.headers.get("content-disposition") });
  const bytesMatch = evidenceBytes.equals(Buffer.from(JSON.stringify(receipt, null, 2) + "\n", "utf8"));
  note("evidence-bytes-vs-run-summary-receipt", { identical: bytesMatch });
  return {
    ok: true, steps, run_id: runId,
    plan: plan.json.plan, plan_source: plan.json.plan_source ?? null,
    receipt, evidence_bytes_identical_to_summary: bytesMatch
  };
}

async function main() {
  const liveIdx = process.argv.indexOf("--live");
  if (liveIdx >= 0) {
    const { readFile } = await import("node:fs/promises");
    const problemIdx = process.argv.indexOf("--problem");
    const providerIdx = process.argv.indexOf("--provider");
    const outIdx = process.argv.indexOf("--out");
    const problemText = problemIdx >= 0 && process.argv[problemIdx + 1]
      ? await readFile(resolve(process.cwd(), process.argv[problemIdx + 1]), "utf8")
      : undefined;
    let journey;
    try {
      journey = await runLiveJourney({
        problemText,
        provider: providerIdx >= 0 ? process.argv[providerIdx + 1] : undefined,
        outDir: outIdx >= 0 ? resolve(process.cwd(), process.argv[outIdx + 1])
          : resolve("artifacts/web-live-journey")
      });
    } catch (e) {
      process.stderr.write(JSON.stringify({ entry: "web", mode: "live", harness_error: String(e).slice(0, 300) }) + "\n");
      return 5;
    }
    process.stdout.write(JSON.stringify(journey, (k, v) => (k === "problem_text" ? "<omitted>" : v), 2) + "\n");
    return journey.ok && journey.receipt?.schema === EXECUTION_RECEIPT_SCHEMA ? 0 : 2;
  }
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
