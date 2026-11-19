/**
 * i180 R2 closeout — R2 E2E acceptance (branch i180/r2-e2e).
 * OUTPUT_LABEL=FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE.
 *
 * OFFLINE, CI-SAFE integrity pass over the COMMITTED live evidence produced by
 * the R2 non-Writer E2E acceptance validator on the trusted Debian host
 * (cc@192.168.100.200, portable bundle with z3 5.4.0 / cvc5 1.4.2, real
 * deepseek-chat) at base main 7b85e82e434152e139d0d93bfb76ef72ad076f21:
 *   1. evidence/r2/SHA256SUMS pins EVERY r2 evidence byte (nothing can drift);
 *   2. the P0 NL journey artifacts carry the exact source SHA, the real tool
 *      versions, the AGREE_SAT verdict and a witness consistent with the
 *      rendered model;
 *   3. the three-entry parity artifacts prove identical plan_sha256 across
 *      CLI / MCP / Web, identical AGREE_UNSAT verdicts, distinct run_ids and
 *      source_sha recorded everywhere (web binds problem_sha256 by design);
 *   4. the negatives failed closed exactly as expected (NEEDS_CLARIFICATION,
 *      PLAN_HASH_MISMATCH pre-execution, BLOCKED_TOOL_MISSING x2);
 *   5. the web evidence verification labels full-stream vs bounded honestly;
 *   6. no API-key-shaped material anywhere in the committed r2 evidence.
 *
 * No network, no binaries, no solver re-runs: the live evidence is integrity-
 * checked, never re-executed. (The journeys themselves live in
 * evidence/r2/drivers/*.mjs and run on the trusted host only.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  sha256Hex, REPO_ROOT, canonicalJsonSha256, validateExecutionReceiptShape
} from "../validation/mvp-user-e2e/harness/lib.mjs";

const R2 = join(REPO_ROOT, "validation", "mvp-user-e2e", "evidence", "r2");
const read = (p) => readFileSync(p, "utf8");
const readJson = (p) => JSON.parse(read(p));
const readBytes = (p) => readFileSync(p);

const R2_HEAD_SHA = "7b85e82e434152e139d0d93bfb76ef72ad076f21";

// ---------------------------------------------------------------------------
// 1. Integrity of the whole r2 evidence set
// ---------------------------------------------------------------------------
test("r2 evidence: SHA256SUMS exists and pins every committed file with a matching hash", () => {
  const manifestPath = join(R2, "SHA256SUMS");
  assert.ok(existsSync(manifestPath), "evidence/r2/SHA256SUMS is committed");
  const lines = read(manifestPath).trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 40, "manifest lists the full r2 evidence set: " + lines.length);
  const seen = new Set();
  for (const line of lines) {
    const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(m, "manifest line format: " + line.slice(0, 80));
    const [, hash, rel] = m;
    assert.ok(rel.startsWith("evidence/r2/"), "manifest paths live under evidence/r2: " + rel);
    const p = join(REPO_ROOT, "validation", "mvp-user-e2e", rel);
    assert.ok(existsSync(p), "evidence file present: " + rel);
    assert.equal(sha256Hex(readBytes(p)), hash, "hash match for " + rel);
    seen.add(rel);
  }
  // every non-manifest file under evidence/r2 is pinned (no unlisted drift)
  const all = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else all.push(p);
    }
  })(R2);
  for (const p of all) {
    const rel = "evidence/r2/" + p.slice(R2.length + 1).split("\\").join("/");
    if (rel === "evidence/r2/SHA256SUMS") continue;
    assert.ok(seen.has(rel), "file is pinned by SHA256SUMS: " + rel);
  }
});

test("r2 evidence: no API-key-shaped material anywhere in the committed r2 evidence", () => {
  const lines = read(join(R2, "SHA256SUMS")).trim().split("\n").filter(Boolean);
  for (const line of lines) {
    const rel = line.split(/ {2}/)[1];
    if (!/\.(json|md|txt|log|mjs|smt2)$/.test(rel)) continue;
    const text = read(join(REPO_ROOT, "validation", "mvp-user-e2e", rel));
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(text), "no key-shaped material in " + rel);
    const envKey = process.env.DEEPSEEK_API_KEY;
    if (envKey) assert.ok(!text.includes(envKey), "the env key value never appears in " + rel);
  }
});

// ---------------------------------------------------------------------------
// 2. Journey 1 — NL -> DeepSeek -> review -> approve -> execute (P0)
// ---------------------------------------------------------------------------
test("r2 NL journey: real receipt binds the exact HEAD sha, real z3 5.4.0 + cvc5 1.4.2, AGREE_SAT PASS", () => {
  const receipt = readJson(join(R2, "nl-journey", "receipt.json"));
  assert.equal(receipt.schema, "formal-tools/execution-receipt/1.0");
  assert.equal(receipt.source_sha, R2_HEAD_SHA, "receipt binds the exact base-main SHA");
  const shape = validateExecutionReceiptShape(receipt);
  assert.equal(shape.ok, true, "receipt conforms to the pinned shape: " + JSON.stringify(shape.errors));
  assert.equal(receipt.overall.process_outcome, "OK");
  assert.equal(receipt.overall.cross_tool_verdict, "AGREE_SAT");
  assert.equal(receipt.overall.claim_verdict, "PASS");
  assert.match(receipt.tool_versions.z3.version, /Z3 version 5\.4\.0/);
  assert.match(receipt.tool_versions.cvc5.version, /cvc5 1\.4\.2/);
  const answers = receipt.overall.solver_answer.by_step.map((s) => s.answer);
  assert.deepEqual(answers, ["sat", "sat"], "both real solvers answered sat");
});

test("r2 NL journey: proposal/approval/review chain is complete, honest and hash-consistent", () => {
  const proposal = readJson(join(R2, "nl-journey", "proposal.json")).proposal;
  assert.equal(proposal.status, "MODEL_PROPOSED");
  assert.equal(proposal.provider.name, "deepseek");
  assert.match(proposal.provider.model, /deepseek-chat/);
  assert.equal(proposal.rendering.semantic_status, "TRANSLATION_PROPOSAL_NOT_VERIFIED_AGAINST_TEXT");
  assert.match(proposal.honesty_note, /human must review/);
  // approved record
  const approved = readJson(join(R2, "nl-journey", "approved.json"));
  assert.equal(approved.status, "USER_APPROVED");
  assert.equal(approved.proposal_sha256, proposal.proposal_sha256);
  assert.equal(approved.review.approved, true);
  assert.ok(approved.review.reviewer.includes("agent surrogate"), "the approval is honestly labeled as an agent surrogate");
  // review input: per-line checks exist and matched
  const review = readJson(join(R2, "nl-journey", "review.json"));
  assert.equal(review.expected_verdict, "AGREE_SAT");
  assert.ok(review.rendering_checks.length >= 7);
  assert.ok(review.rendering_checks.every((c) => c.verdict === "MATCH"));
  // the report carries the full provenance chain
  const report = readJson(join(R2, "nl-journey", "report.json"));
  assert.equal(report.all_checks_passed, true);
  assert.equal(report.execution.run_id, receiptRunId());
  assert.equal(report.execution.source_sha, R2_HEAD_SHA);
});

test("r2 NL journey: witness is consistent with the rendered model (p,e)=(1,7) and labeled honestly", () => {
  const witness = readJson(join(R2, "nl-journey", "witness.json"));
  assert.equal(witness.ok, true);
  assert.equal(witness.values.p, 1);
  assert.equal(witness.values.e, 7);
  assert.ok(witness.checks.length >= 4 && witness.checks.every((c) => c.holds === true));
  assert.match(witness.honesty_note, /NOT evidence that the translation matches/);
});

test("r2 NL journey: the plan binds the provenance chain (original text + model + rendering) by hash", () => {
  const plan = readJson(join(R2, "nl-journey", "plan.json"));
  assert.equal(plan.schema, "formal-tools/execution-plan/1.0");
  assert.deepEqual(plan.steps.map((s) => s.tool).filter((t) => t !== "compare"), ["z3", "cvc5"]);
  const report = readJson(join(R2, "nl-journey", "report.json"));
  const proposal = readJson(join(R2, "nl-journey", "proposal.json")).proposal;
  // the provenance sha recorded by the driver equals a fresh recomputation over
  // the full chain from the committed proposal (original text preserved verbatim)
  const provenance = {
    original_text: proposal.original_text,
    structured_model: proposal.model,
    rendering: proposal.rendering
  };
  assert.equal(canonicalJsonSha256(provenance), report.plan.provenance_sha256,
    "provenance_sha256 recomputes from the committed proposal");
  // and every solver step input is the rendered SMT text of that chain
  for (const step of plan.steps.filter((s) => s.tool === "z3" || s.tool === "cvc5")) {
    assert.equal(step.input.smt_lib, proposal.rendering.text, "step input is the approved rendering");
    assert.equal(step.input_sha256, canonicalJsonSha256(step.input));
  }
});

function receiptRunId() {
  return JSON.parse(read(join(R2, "nl-journey", "receipt.json"))).run_id;
}

// ---------------------------------------------------------------------------
// 3. Journey 2 — three-entry parity on one fixed plan
// ---------------------------------------------------------------------------
test("r2 parity: identical plan_sha256 across CLI, MCP and Web; verdicts agree; run_ids distinct", () => {
  const report = readJson(join(R2, "parity", "parity-report.json"));
  assert.equal(report.all_checks_passed, true, JSON.stringify(report.findings.filter((f) => !f.pass)));
  const cli = readJson(join(R2, "parity", "cli-receipt.json"));
  const mcp = readJson(join(R2, "parity", "mcp-execute-response.json"));
  const web = readJson(join(R2, "parity", "web-receipt.json"));
  const plan = readJson(join(R2, "parity", "plan.json"));
  // one fixed plan object
  assert.equal(cli.plan_id, plan.plan_id);
  assert.equal(web.plan_id, plan.plan_id);
  assert.equal(mcp.plan_id, plan.plan_id);
  // identical plan hash across all three
  assert.equal(cli.plan_sha256, mcp.plan_sha256);
  assert.equal(cli.plan_sha256, web.plan_sha256);
  // identical honest verdicts (hand-certain UNSAT input)
  assert.equal(cli.overall.cross_tool_verdict, "AGREE_UNSAT");
  assert.equal(mcp.overall.cross_tool_verdict, "AGREE_UNSAT");
  assert.equal(web.overall.cross_tool_verdict, "AGREE_UNSAT");
  assert.equal(cli.overall.claim_verdict, "PASS");
  assert.equal(mcp.overall.claim_verdict, "PASS");
  assert.equal(web.overall.claim_verdict, "PASS");
  // distinct runs
  assert.notEqual(cli.run_id, mcp.run_id);
  assert.notEqual(cli.run_id, web.run_id);
  assert.notEqual(mcp.run_id, web.run_id);
  // source labels: CLI/MCP required 40-hex git sha; Web records problem_sha256 (design)
  assert.equal(cli.source_sha, R2_HEAD_SHA);
  assert.equal(mcp.source_sha, R2_HEAD_SHA);
  assert.equal(web.source_sha, plan.source.problem_sha256);
  assert.notEqual(web.source_sha, R2_HEAD_SHA);
});

test("r2 parity: the fixed plan is the hand-certain UNSAT fixture and its step hashes bind it", () => {
  const plan = readJson(join(R2, "parity", "plan.json"));
  const fixture = read(join(REPO_ROOT, "validation", "mvp-user-e2e", "evidence", "r2", "inputs", "scenario-r2.smt2"));
  assert.match(fixture, /\(assert \(>= \(\+ x y\) 9\)\)/);
  const z3Step = plan.steps.find((s) => s.tool === "z3");
  assert.equal(z3Step.input.smt_lib, fixture.trim(), "the solvers solved exactly the committed fixture text");
  assert.equal(z3Step.input_sha256, canonicalJsonSha256(z3Step.input));
});

test("r2 parity: MCP transcript records a real execute_workflow tools/call and no key material", () => {
  const transcript = readJson(join(R2, "parity", "mcp-transcript.json"));
  const raw = JSON.stringify(transcript);
  assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(raw));
  const calls = transcript.transcript.filter((e) => e.outbound && e.outbound.method === "tools/call");
  assert.ok(calls.length >= 1, "at least one tools/call recorded");
  const response = readJson(join(R2, "parity", "mcp-execute-response.json"));
  assert.equal(response.execution, "REAL_WORKFLOW_EXECUTOR");
  assert.equal(response.status, "EXECUTION_RECEIPT_RETURNED");
  assert.equal(response.executed, true);
});

// ---------------------------------------------------------------------------
// 4. Journey 3 — negatives fail closed
// ---------------------------------------------------------------------------
test("r2 negatives: vague NL -> NEEDS_CLARIFICATION, nothing rendered, approval impossible", () => {
  const result = readJson(join(R2, "negatives", "needs-clarification.result.json"));
  assert.equal(result.status, "NEEDS_CLARIFICATION");
  assert.ok(Array.isArray(result.clarification_needed) && result.clarification_needed.length > 0);
  assert.equal(result.rendering_present, false);
  assert.equal(result.approval_attempt_threw, "NL_NOT_APPROVABLE");
  assert.equal(result.matched, true);
  const proposal = readJson(join(R2, "negatives", "needs-clarification.proposal.json")).proposal;
  assert.equal(proposal.rendering, null);
  assert.equal(proposal.model, null);
});

test("r2 negatives: tampered plan over MCP rejected PRE-execution with PLAN_HASH_MISMATCH", () => {
  const result = readJson(join(R2, "negatives", "mcp-tampered-result.json"));
  assert.equal(result.isError, true);
  assert.equal(result.code, "PLAN_HASH_MISMATCH");
  assert.equal(result.executed, false);
  assert.equal(result.matched, true);
});

test("r2 negatives: empty FORMAL_PORTABLE_ROOT fails closed honestly via CLI and Web", () => {
  for (const [name, file] of [["cli", "cli-blocked-tool-missing.receipt.json"], ["web", "web-blocked-tool-missing.receipt.json"]]) {
    const receipt = readJson(join(R2, "negatives", file));
    assert.equal(receipt.schema, "formal-tools/execution-receipt/1.0", name + " receipt is real");
    assert.equal(receipt.overall.process_outcome, "ABORTED", name);
    assert.equal(receipt.overall.claim_verdict, "BLOCKED", name);
    assert.equal(receipt.overall.fail_closed_reason, "BLOCKED_TOOL_MISSING", name);
    assert.equal(receipt.overall.solver_answer.value, null, name + " claims no solver answer");
    assert.ok(receipt.steps.every((s) => s.status === "NOT_RUN"), name + " steps never ran");
  }
  const report = readJson(join(R2, "negatives", "negatives-report.json"));
  assert.equal(report.all_checks_passed, true);
  assert.equal(report.unknown_class_case.status, "NOT_RUN", "the UNKNOWN-class case is honestly not fabricated");
});

// ---------------------------------------------------------------------------
// 5. Journey 4 — web evidence honesty (R2-D regression at E2E level)
// ---------------------------------------------------------------------------
test("r2 evidence-check: full-stream vs bounded labels and hashes verified over HTTP bytes", () => {
  const report = readJson(join(R2, "evidence-check", "evidence-verification.json"));
  assert.equal(report.all_checks_passed, true, JSON.stringify(report.findings.filter((f) => !f.pass)));
  assert.ok(report.streams.length >= 2, "both solver stdout streams verified");
  for (const s of report.streams) {
    assert.equal(s.full_scope_header, "full-stream");
    assert.equal(s.bounded_scope_header, "bounded-copy");
    assert.equal(s.full_stream_header, s.receipt_full_stream_sha256, "the full-stream header is the receipt hash on both scopes");
    assert.equal(s.bounded_stream_header, s.receipt_full_stream_sha256);
    assert.equal(s.full_bytes_sha256, s.receipt_full_stream_sha256, "full bytes hash-verify");
    assert.equal(s.bounded_bytes_sha256, s.manifest_entry.bounded_sha256, "bounded bytes hash-verify");
    assert.equal(s.manifest_entry.bounded_matches_full_stream, true, "identity claimed only via verification");
  }
  const summary = readJson(join(R2, "evidence-check", "web-run-summary.json"));
  assert.equal(summary.summary.receipt.overall.cross_tool_verdict, "AGREE_UNSAT");
});

// ---------------------------------------------------------------------------
// 6. Screenshots + drivers committed
// ---------------------------------------------------------------------------
test("r2 evidence: browser screenshots and drivers are committed", () => {
  for (const shot of [
    "01-input-scenario-r2.png", "02-plan-review-deterministic.png", "03-run-real-solvers.png",
    "04-results-agree-unsat.png", "05-evidence-section-hash-lines.png",
    "06-evidence-download-attempt.png", "07-blocked-tool-missing-banner.png"
  ]) {
    const p = join(R2, "screenshots", shot);
    assert.ok(existsSync(p), "screenshot committed: " + shot);
    assert.ok(statSize(p) > 5000, "screenshot has real content: " + shot);
  }
  for (const driver of ["lib-r2.mjs", "j1-nl-journey.mjs", "j2-parity-cli-mcp.mjs", "j3-negatives.mjs", "j4-evidence-check.mjs"]) {
    assert.ok(existsSync(join(R2, "drivers", driver)), "driver committed: " + driver);
  }
});

function statSize(p) {
  return statSync(p).size;
}
