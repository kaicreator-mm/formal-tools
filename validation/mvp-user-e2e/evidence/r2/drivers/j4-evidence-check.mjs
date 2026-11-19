#!/usr/bin/env node
/**
 * i180 R2 E2E acceptance — Journey 4: web evidence correctness (R2-D
 * regression at the E2E level). OUTPUT_LABEL=FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE.
 *
 * Against the running bridge (loopback on the trusted host), for ONE completed
 * run (the three-entry parity web run), over real HTTP with exact bytes:
 *   1. GET /api/runs/:id                      -> run summary + receipt (saved).
 *   2. GET /api/runs/:id/evidence             -> receipt.json bytes; sha256 must
 *      equal manifest.receipt_sha256.
 *   3. GET /api/runs/:id/evidence?part=manifest -> manifest labels every
 *      bounded-copy and full-stream artifact with its OWN sha256 and records
 *      bounded_matches_full_stream (true only when verified/provable).
 *   4. For every receipt step stream: GET
 *      ?part=stdout|stderr&step=<id>&scope=full and &scope=bounded:
 *        - X-Formal-Evidence-Scope is exactly "full-stream" / "bounded-copy";
 *        - X-Formal-Full-Stream-Sha256 equals the receipt's full-stream hash on
 *          BOTH scopes (the header must never be the bounded hash);
 *        - sha256(full bytes) == receipt full-stream hash (this run is short
 *          -output, so the full artifact exists and is retained);
 *        - sha256(bounded bytes) == manifest bounded_sha256;
 *        - manifest bounded_matches_full_stream === true for these short
 *          streams, and full bytes == bounded bytes as observed — consistent
 *          with the claim, and the claim's authority is the hash verification
 *          itself, never an assumption.
 *   5. A wrong scope value is refused fail-closed (422 EVIDENCE_SCOPE_INVALID).
 *
 * Exit codes: 0 every verification holds, 2 finding, 5 usage/transport error.
 */
import { join, resolve } from "node:path";
import {
  R2_ROOT, arg, saveJson, check, sha256HexBytes
} from "./lib-r2.mjs";

const OUT_DIR = resolve(process.cwd(), arg("--out", join(R2_ROOT, "evidence-check")));
const BASE = arg("--base", "http://127.0.0.1:8788");
const RUN_ID = arg("--run-id", null);
if (!RUN_ID || !/^[A-Za-z0-9-]+$/.test(RUN_ID)) {
  process.stderr.write(JSON.stringify({ driver_error: "--run-id <id> is required" }) + "\n");
  process.exit(5);
}

const findings = [];

async function getBytes(pathAndQuery) {
  const res = await fetch(BASE + pathAndQuery);
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf };
}

async function main() {
  // 1. run summary + receipt
  const sumRes = await fetch(`${BASE}/api/runs/${encodeURIComponent(RUN_ID)}`);
  const summary = await sumRes.json();
  if (!sumRes.ok || summary.status === "running" || !summary.receipt) {
    process.stderr.write(JSON.stringify({ driver_error: "run not complete or unreachable", status: summary?.status }) + "\n");
    process.exit(5);
  }
  const receipt = summary.receipt;
  await saveJson(OUT_DIR, "web-run-summary.json", { run_id: RUN_ID, fetched_from: BASE, summary });

  // 2. receipt.json bytes
  const rec = await getBytes(`/api/runs/${encodeURIComponent(RUN_ID)}/evidence`);
  check(findings, "evidence receipt.json served with attachment disposition", String(rec.res.headers.get("content-disposition") ?? "").startsWith("attachment"), String(rec.res.headers.get("content-disposition")));
  const receiptJson = JSON.parse(rec.buf.toString("utf8"));
  check(findings, "downloaded receipt.json run_id matches", receiptJson.run_id === RUN_ID);

  // 3. manifest
  const man = await getBytes(`/api/runs/${encodeURIComponent(RUN_ID)}/evidence?part=manifest`);
  const manifest = JSON.parse(man.buf.toString("utf8"));
  check(findings, "manifest.receipt_sha256 == sha256(receipt.json bytes)", manifest.receipt_sha256 === sha256HexBytes(rec.buf),
    JSON.stringify({ manifest: manifest.receipt_sha256, actual: sha256HexBytes(rec.buf) }));
  check(findings, "manifest.labels_note present (bounded copies carry their OWN sha; plain names reserved for verified full streams)",
    typeof manifest.labeling_note === "string" && manifest.labeling_note.includes("bounded_matches_full_stream"));
  const byArtifact = new Map(manifest.artifacts.map((a) => [a.name, a]));

  // 4. per-stream verification
  const streams = [];
  for (const step of receipt.steps) {
    for (const part of ["stdout", "stderr"]) {
      const fullSha = part === "stdout" ? step.stdout_sha256 : step.stderr_sha256;
      const boundedText = part === "stdout" ? step.stdout_bounded : step.stderr_bounded;
      if (typeof fullSha !== "string" || typeof boundedText !== "string" || boundedText.length === 0) continue;
      const mEntry = manifest.streams.find((s) => s.step_id === step.step_id && s.stream === part);

      const full = await getBytes(`/api/runs/${encodeURIComponent(RUN_ID)}/evidence?part=${part}&step=${encodeURIComponent(step.step_id)}&scope=full`);
      const bounded = await getBytes(`/api/runs/${encodeURIComponent(RUN_ID)}/evidence?part=${part}&step=${encodeURIComponent(step.step_id)}&scope=bounded`);

      const rec = {
        step_id: step.step_id, stream: part,
        receipt_full_stream_sha256: fullSha,
        full_http_status: full.res.status,
        full_scope_header: full.res.headers.get("x-formal-evidence-scope"),
        full_stream_header: full.res.headers.get("x-formal-full-stream-sha256"),
        full_bytes_sha256: sha256HexBytes(full.buf),
        full_bytes_len: full.buf.length,
        bounded_http_status: bounded.res.status,
        bounded_scope_header: bounded.res.headers.get("x-formal-evidence-scope"),
        bounded_stream_header: bounded.res.headers.get("x-formal-full-stream-sha256"),
        bounded_bytes_sha256: sha256HexBytes(bounded.buf),
        bounded_bytes_len: bounded.buf.length,
        manifest_entry: mEntry ?? null
      };

      check(findings, `${step.step_id} ${part} full: X-Formal-Evidence-Scope is full-stream`, rec.full_scope_header === "full-stream", String(rec.full_scope_header));
      check(findings, `${step.step_id} ${part} full: X-Formal-Full-Stream-Sha256 equals the receipt full-stream hash`, rec.full_stream_header === fullSha, String(rec.full_stream_header));
      check(findings, `${step.step_id} ${part} full: sha256(bytes) == receipt full-stream hash`, rec.full_bytes_sha256 === fullSha, rec.full_bytes_sha256);

      check(findings, `${step.step_id} ${part} bounded: X-Formal-Evidence-Scope is bounded-copy`, rec.bounded_scope_header === "bounded-copy", String(rec.bounded_scope_header));
      check(findings, `${step.step_id} ${part} bounded: X-Formal-Full-Stream-Sha256 still the FULL-stream hash (never the bounded hash)`, rec.bounded_stream_header === fullSha, String(rec.bounded_stream_header));
      check(findings, `${step.step_id} ${part} bounded: sha256(bytes) == manifest bounded_sha256`, mEntry ? rec.bounded_bytes_sha256 === mEntry.bounded_sha256 : false,
        JSON.stringify({ actual: rec.bounded_bytes_sha256, manifest: mEntry?.bounded_sha256 ?? null }));
      check(findings, `${step.step_id} ${part} manifest full_stream_sha256 == receipt hash`, mEntry?.full_stream_sha256 === fullSha, String(mEntry?.full_stream_sha256));
      check(findings, `${step.step_id} ${part} manifest bounded_matches_full_stream === true (verified/provable on this short-output run)`, mEntry?.bounded_matches_full_stream === true, String(mEntry?.bounded_matches_full_stream));
      check(findings, `${step.step_id} ${part} observed: full bytes == bounded bytes (consistent with the verified claim, authority = hashes above)`,
        rec.full_bytes_sha256 === rec.bounded_bytes_sha256,
        `${rec.full_bytes_len} vs ${rec.bounded_bytes_len}`);
      const fullArt = byArtifact.get(mEntry?.full_artifact ?? "");
      const boundedArt = byArtifact.get(mEntry?.bounded_artifact ?? "");
      check(findings, `${step.step_id} ${part} manifest artifact scopes labeled (full-stream / bounded-copy)`,
        fullArt?.scope === "full-stream" && boundedArt?.scope === "bounded-copy",
        JSON.stringify({ full: fullArt?.scope ?? null, bounded: boundedArt?.scope ?? null }));
      check(findings, `${step.step_id} ${part} manifest artifact hashes match served bytes`,
        fullArt?.sha256 === rec.full_bytes_sha256 && boundedArt?.sha256 === rec.bounded_bytes_sha256);
      streams.push(rec);
    }
  }
  check(findings, "at least one stream verified", streams.length > 0, String(streams.length));

  // 5. invalid scope refused fail-closed
  const bad = await fetch(`${BASE}/api/runs/${encodeURIComponent(RUN_ID)}/evidence?part=stdout&step=${encodeURIComponent(receipt.steps[0].step_id)}&scope=everything`);
  const badBody = await bad.json().catch(() => ({}));
  check(findings, "scope=everything refused fail-closed (422 EVIDENCE_SCOPE_INVALID)", bad.status === 422 && badBody?.error?.code === "EVIDENCE_SCOPE_INVALID",
    JSON.stringify({ status: bad.status, code: badBody?.error?.code }));

  const report = {
    schema: "formal-tools/r2e2e-evidence-verification/1.0",
    label: "FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE",
    journey: "j4-web-evidence-correctness",
    base: BASE,
    run_id: RUN_ID,
    receipt_full_stream_hashes: receipt.steps.map((s) => ({ step_id: s.step_id, stdout: s.stdout_sha256 ?? null, stderr: s.stderr_sha256 ?? null })),
    manifest_remit: { receipt_sha256: manifest.receipt_sha256, stream_cap_bytes: manifest.stream_cap_bytes },
    streams,
    findings,
    all_checks_passed: findings.every((f) => f.pass),
    honesty_note: "Verification is over real HTTP bytes and headers. bounded_matches_full_stream is asserted TRUE only because the manifest recorded verified identity AND the served bytes hash-verify; no identity claim is made beyond that."
  };
  await saveJson(OUT_DIR, "evidence-verification.json", report);
  await saveJson(OUT_DIR, "http-headers.json", {
    run_id: RUN_ID,
    receipt_headers: Object.fromEntries(rec.res.headers.entries()),
    manifest_headers: Object.fromEntries(man.res.headers.entries()),
    per_stream: streams.map((s) => ({ step_id: s.step_id, stream: s.stream, full_scope_header: s.full_scope_header, full_stream_header: s.full_stream_header, bounded_scope_header: s.bounded_scope_header, bounded_stream_header: s.bounded_stream_header }))
  });
  process.exitCode = report.all_checks_passed ? 0 : 2;
}

try {
  await main();
} catch (e) {
  process.stderr.write(JSON.stringify({ driver_error: String(e && e.stack || e).slice(0, 1200) }) + "\n");
  process.exit(5);
}
