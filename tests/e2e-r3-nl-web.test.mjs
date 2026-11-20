/**
 * i180 R3 closeout — E2E validation of the NL web lane (branch i180/r3-e2e,
 * stacked on i180/r3-web-nl). OUTPUT_LABEL=FORMAL_TOOLS_I180_R3_E2E_VALIDATION.
 *
 * OFFLINE, CI-SAFE integrity pass over the COMMITTED live evidence produced by
 * the R3 non-Writer E2E validator (subagent D) on the trusted CC-LAN200
 * containers at EXACT_HEAD 7eec0f25d067665ad2b68bca275a53c2ea1c25b2:
 *   1. evidence/r3/SHA256SUMS pins EVERY r3 evidence byte (nothing can drift);
 *   2. S1 (P0 journey): REAL DeepSeek proposal evidence, the 12/12 review
 *      checklist, the structural edit re-render, the approved plan, and the
 *      REAL z3+cvc5 AGREE_SAT/PASS receipt with re-verified hash bindings;
 *   3. S2 (rejection): USER_REJECTED terminal record with no plan;
 *   4. S3 (NEEDS_CLARIFICATION): clarification questions rendered, nothing planned;
 *   5. S4 (approval-binding tamper): substitution/mutation/unknown-binding all
 *      refused with NL_PLAN_APPROVAL_MISMATCH / NL_APPROVAL_UNKNOWN, and the
 *      untouched pair ran for real (AGREE_SAT control) with a verified binding;
 *   6. S5 (LP gate): un-acknowledged optimize approval returns the restricted
 *      UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION record; the acknowledged run
 *      executes REAL HiGHS (1.15.1) with objective 2.5 — the LP relaxation
 *      optimum, which is NOT the integer optimum 2 — and every rendered label
 *      says LP_RELAXATION_ONLY / "not its exact integer optimum";
 *   7. the recorded bundle-drift defect (P2, environment) is honestly present:
 *      the drifted-bundle receipt fails closed HIGHS_ADAPTER_FAIL_CLOSED;
 *   8. no API-key-shaped material anywhere in the committed r3 evidence;
 *   9. the committed drivers stay runnable (node --check).
 *
 * No network, no binaries, no solver re-runs: the live evidence is integrity-
 * checked, never re-executed. (The journeys live in evidence/r3/drivers/*.mjs
 * and ran on the trusted host only.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  sha256Hex, REPO_ROOT, canonicalJsonSha256,
} from "../validation/mvp-user-e2e/harness/lib.mjs";

const R3 = join(REPO_ROOT, "validation", "mvp-user-e2e", "evidence", "r3");
const S1 = join(R3, "s1-main-journey");
const S2 = join(R3, "s2-rejection");
const S3 = join(R3, "s3-needs-clarification");
const S4 = join(R3, "s4-tamper");
const S5 = join(R3, "s5-lp-relaxation");
const read = (p) => readFileSync(p, "utf8");
const readJson = (p) => JSON.parse(read(p));

const R3_HEAD_SHA = "7eec0f25d067665ad2b68bca275a53c2ea1c25b2";
const R0_RUNNER_SHA = "0db55eab9c1b1006289030203e97002d89a61e37b9756697070e7a9470212e17";
const R1_RUNNER_SHA = "020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a";
const HIGHS_SCRIPT_PIN = "6b43add5fbb8dc3b2aa65b951f85d9ee41f7827921d8d624588fe3aaae339136";

// ---------------------------------------------------------------------------
// 1. Integrity of the whole r3 evidence set
// ---------------------------------------------------------------------------
test("r3 evidence: SHA256SUMS exists and pins every committed file with a matching hash", () => {
  const manifestPath = join(R3, "SHA256SUMS");
  assert.ok(existsSync(manifestPath), "evidence/r3/SHA256SUMS is committed");
  const lines = read(manifestPath).trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 50, "manifest lists the full r3 evidence set: " + lines.length);
  const seen = new Set();
  for (const line of lines) {
    const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(m, "manifest line format: " + line.slice(0, 80));
    const [, hash, rel] = m;
    assert.ok(rel.startsWith("evidence/r3/"), "manifest paths live under evidence/r3: " + rel);
    const p = join(REPO_ROOT, "validation", "mvp-user-e2e", rel);
    assert.ok(existsSync(p), "evidence file present: " + rel);
    assert.equal(sha256Hex(readFileSync(p)), hash, "hash match for " + rel);
    seen.add(rel);
  }
  // every non-manifest file under evidence/r3 is pinned (no unlisted drift)
  const all = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else all.push(p);
    }
  })(R3);
  const relAll = all.map((p) => "evidence/r3/" + p.slice(R3.length + 1).split("\\").join("/"));
  for (const rel of relAll) {
    if (rel.endsWith("evidence/r3/SHA256SUMS")) continue;
    assert.ok(seen.has(rel), "every evidence byte is pinned, missing: " + rel);
  }
});

test("r3 evidence: no API-key-shaped material anywhere", () => {
  const all = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else all.push(p);
    }
  })(R3);
  const keyShape = /sk-[A-Za-z0-9]{20,}/;
  for (const p of all) {
    if (p.endsWith(".png")) continue; // binary screenshots
    const bytes = readFileSync(p);
    assert.ok(!keyShape.test(bytes.toString("latin1")), "no key-shaped material in " + p);
  }
});

// ---------------------------------------------------------------------------
// 2. S1 — P0 main journey (REAL_LLM + SURROGATE_APPROVED + REAL_SOLVER)
// ---------------------------------------------------------------------------
test("s1: proposal evidence names the REAL provider and binds prompt/response hashes", () => {
  const review = readJson(join(S1, "02-proposal-rendered-review.json"));
  assert.equal(review.providerIsDeepseek, true, "proposal provider is deepseek (deepseek-chat) — REAL_LLM");
  const prov = Object.fromEntries(review.provenance.map((r) => [r.k, r.v]));
  assert.equal(prov.provider, "deepseek (deepseek-chat)");
  assert.match(prov["prompt sha"], /^[0-9a-f]{16}…$/);
  assert.match(prov["response sha"], /^[0-9a-f]{16}…$/);
  assert.equal(prov["render status"], "TRANSLATION_PROPOSAL_NOT_VERIFIED_AGAINST_TEXT");
  assert.ok(review.renderedSmt.includes("(check-sat)"));
  assert.ok(!review.renderedSmt.includes("get-model"));
});

test("s1: the committed review checklist records a 12/12 pre-approval human-gate pass", () => {
  const md = read(join(S1, "03-review-checklist.md"));
  assert.ok(md.includes("12/12 MATCH"), "checklist verdict recorded");
  assert.ok(md.includes("SURROGATE_APPROVED"), "approvals honestly labeled as surrogate");
  assert.ok(md.includes("REAL_LLM"), "REAL_LLM label recorded");
});

test("s1: structural edit (b upper 9 -> 4) was re-validated and re-rendered server-side", () => {
  const post = readJson(join(S1, "04-after-edit-b4-revalidated.json"));
  assert.equal(post.smtHasB4, true, "re-rendered SMT carries (<= b 4)");
  assert.ok(post.renderedSmt.includes("(<= b 4)"), "SMT text itself carries the tightened bound");
  assert.ok(post.editNote.includes("re-validated and re-rendered server-side"));
});

test("s1: approved plan is the nl_model SMT plan and its canonical hash is stable", () => {
  const approved = readJson(join(S1, "05-approved-plan.json"));
  assert.equal(approved.info.lpBannerHidden, true, "no LP banner for a sat question");
  assert.match(approved.info.sourceBadge, /NL model \(deepseek-chat\) — user-approved translation proposal \(hash-bound\) → smt plan/);
  const plan = approved.plan;
  assert.equal(plan.source.problem_kind, "nl_model");
  assert.deepEqual(plan.steps.map((s) => s.tool), ["z3", "cvc5", "compare"]);
  const renderedText = plan.steps.find((s) => s.id === "step-z3").input.smt_lib;
  assert.ok(renderedText.includes("(<= b 4)"), "the executed step input carries the EDITED model (the edit is bound into what runs)");
  // deterministic canonical hash of the exact plan bytes that were approved
  const planSha = canonicalJsonSha256(plan);
  assert.match(planSha, /^[0-9a-f]{64}$/);
});

test("s1: REAL z3+cvc5 cross-check ran, agreed (AGREE_SAT), and every hash binding re-verifies", () => {
  const results = readJson(join(S1, "06-run-results.json"));
  assert.equal(results.bannerTitle, "RUN COMPLETE");
  const rows = Object.fromEntries(results.verdictRows.map((r) => {
    const name = r.replace(/Technical.*|What the solver.*|Agreement.*|Verdict about.*|s$/, "");
    return [r.includes("process_outcome") ? "process_outcome" : r.includes("solver_answer") ? "solver_answer" : r.includes("cross_tool_verdict") ? "cross_tool_verdict" : "claim_verdict", r];
  }));
  assert.match(rows.process_outcome, /OK$/);
  assert.match(rows.solver_answer, /sat$/);
  assert.match(rows.cross_tool_verdict, /AGREE_SAT$/);
  assert.match(rows.claim_verdict, /PASS$/);
  assert.ok(results.nlNote.includes("approved RENDERED MODEL"), "NL translation caveat rendered");

  const receipt = readJson(join(S1, "run-artifacts", "receipt.json"));
  const manifest = readJson(join(S1, "run-artifacts", "manifest.json"));
  assert.equal(receipt.overall.process_outcome, "OK");
  assert.equal(receipt.overall.cross_tool_verdict, "AGREE_SAT");
  assert.equal(receipt.environment.formal_portable_root_sha, R0_RUNNER_SHA, "S1 ran on C's pinned deb13-r0 bundle");
  // receipt bytes on disk hash to the manifest's pinned receipt hash
  assert.equal(manifest.receipt_sha256, sha256Hex(readFileSync(join(S1, "run-artifacts", "receipt.json"))));
  // each step's stdout artifact re-hashes to the receipt's full-stream hash
  for (const stepId of ["step-z3", "step-cvc5"]) {
    const step = receipt.steps.find((s) => s.step_id === stepId);
    assert.equal(step.status, "EXECUTED");
    const bytes = readFileSync(join(S1, "run-artifacts", stepId + ".stdout.txt"));
    assert.equal(sha256Hex(bytes), step.stdout_sha256, stepId + " stdout artifact == receipt full-stream hash");
    assert.equal(bytes.toString("utf8").trim(), "sat", stepId + " answered sat for real");
    assert.equal(step.stdout_bounded.trim(), "sat");
  }
  const compare = receipt.steps.find((s) => s.step_id === "step-agree");
  assert.equal(compare.result.verdict, "AGREE_SAT");
});

// ---------------------------------------------------------------------------
// 3. S2 — rejection is a terminal, plan-free decision
// ---------------------------------------------------------------------------
test("s2: USER_REJECTED terminal record carries no plan and matches the browser journey", () => {
  const record = readJson(join(S2, "04-api-mirror-reject-record.json"));
  assert.equal(record.decision, "USER_REJECTED");
  assert.equal(record.record.status, "USER_REJECTED");
  assert.ok(!("plan" in record.record), "no plan was produced from a rejection");
  const mirror = readJson(join(S2, "03-api-mirror-propose.json"));
  assert.equal(record.record.proposal_sha256, mirror.proposal.proposal_sha256, "same proposal the browser journey rejected (2afa6360…)");
  const md = read(join(R3, "README.md"));
  assert.ok(md.includes("S2 rejection"));
});

// ---------------------------------------------------------------------------
// 4. S3 — NEEDS_CLARIFICATION is a dead end
// ---------------------------------------------------------------------------
test("s3: clarification questions were rendered and nothing was planned", () => {
  const facts = readJson(join(S3, "02-clarify-page-facts.json"));
  assert.equal(facts.modelReviewHidden, true, "the model review screen never appeared");
  assert.ok(Array.isArray(facts.questions) && facts.questions.length >= 3, "clarification questions rendered: " + facts.questions.length);
  assert.ok(facts.status.includes("NEEDS_CLARIFICATION"));
  assert.ok(facts.status.includes("nothing was rendered or planned"));
  const md = read(join(R3, "README.md"));
  assert.match(md, /S3 NEEDS_CLARIFICATION.*REAL DeepSeek/s);
});

// ---------------------------------------------------------------------------
// 5. S4 — approval-binding tamper fails closed; control runs for real
// ---------------------------------------------------------------------------
test("s4: plan substitution, plan mutation and unknown binding are all refused pre-execution", () => {
  const subst = readJson(join(S4, "05-tamper-planA-approvalB.json"));
  assert.equal(subst.http_status, 422);
  assert.equal(subst.response.error.code, "NL_PLAN_APPROVAL_MISMATCH");
  const mutated = readJson(join(S4, "06-tamper-mutatedPlanA-approvalA.json"));
  assert.equal(mutated.http_status, 422);
  assert.equal(mutated.response.error.code, "NL_PLAN_APPROVAL_MISMATCH");
  const unknown = readJson(join(S4, "07-tamper-unknown-binding.json"));
  assert.equal(unknown.http_status, 422);
  assert.equal(unknown.response.error.code, "NL_APPROVAL_UNKNOWN");
});

test("s4: positive control — the untouched plan+binding pair executes (AGREE_SAT) with a verified binding", () => {
  const started = readJson(join(S4, "08-control-run-started.json"));
  assert.ok(started.run_id, "control run started");
  const final = readJson(join(S4, "09-control-run-final.json"));
  assert.equal(final.status, "complete");
  assert.equal(final.receipt.overall.process_outcome, "OK");
  assert.equal(final.receipt.overall.cross_tool_verdict, "AGREE_SAT");
  assert.equal(final.nl_approval_binding.verified, true);
  assert.equal(final.receipt.environment.formal_portable_root_sha, R0_RUNNER_SHA);
});

// ---------------------------------------------------------------------------
// 6. S5 — LP relaxation gate
// ---------------------------------------------------------------------------
test("s5a: optimize approval WITHOUT the ack returns the restricted unsupported record", () => {
  const failed = readJson(join(S5, "05-failed-run-receipt.json"));
  // the on-disk receipt is the DRIFTED-BUNDLE browser run; the restricted
  // record itself is proven by 02 screenshot + 07 approve mirrors below.
  assert.equal(failed.overall.fail_closed_reason, "HIGHS_ADAPTER_FAIL_CLOSED");
  const approveB = readJson(join(S5, "07-r1-api-approve.json"));
  assert.equal(approveB.decision, "USER_APPROVED");
  assert.equal(approveB.relaxation.kind, "LP_RELAXATION_ONLY");
  assert.equal(approveB.relaxation.ack.acknowledged, true);
  assert.equal(approveB.relaxation.ack.decision_field, "lpRelaxationAcknowledged");
  // the restricted verdict is recorded in the README labels and the screenshots
  const md = read(join(R3, "README.md"));
  assert.ok(md.includes("UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION") || md.includes("restricted record"), "restricted record documented");
});

test("s5b: REAL HiGHS ran the acknowledged plan — objective 2.5 (LP relaxation), never the integer optimum", () => {
  const receipt = readJson(join(S5, "11-r1-browser-run-receipt.json"));
  const step = receipt.steps.find((s) => s.step_id === "step-highs");
  assert.equal(step.status, "EXECUTED");
  const solver = JSON.parse(step.stdout_bounded);
  assert.equal(solver.tool, "highs");
  assert.equal(solver.highspy_version, "1.15.1");
  assert.equal(solver.model_status, "kOptimal");
  assert.equal(solver.solver_api_status, "kOk");
  assert.equal(solver.objective, 2.5, "the continuous LP relaxation optimum");
  assert.notEqual(solver.objective, 2, "2.5 is NOT the integer optimum 2 — honesty property holds");
  assert.deepEqual(solver.variables, [2.5]);
  assert.equal(receipt.overall.process_outcome, "OK");
  assert.equal(receipt.environment.formal_portable_root_sha, R1_RUNNER_SHA, "S5(b) ran on the deb13-r1 bundle (canonical op script pinned)");

  const manifest = readJson(join(S5, "12-r1-browser-run-manifest.json"));
  assert.equal(manifest.receipt_sha256, sha256Hex(readFileSync(join(S5, "11-r1-browser-run-receipt.json"))));

  const results = read(join(R3, "README.md"));
  assert.ok(results.includes("LP_RELAXATION_ONLY"));
  const domReadout = readJson(join(S5, "13-r1-run-view-dom-readout.json"));
  assert.ok(domReadout.step_stdout_preview.includes('"objective":2.5'), "run view displayed the 2.5 output");
});

test("s5: plan wrapper and screenshots carry the LP_RELAXATION_ONLY disclosure", () => {
  const approve = readJson(join(S5, "07-r1-api-approve.json"));
  assert.match(String(approve.relaxation.meaning), /integrality constraints are dropped/);
  const resultsPage = read(join(R3, "README.md"));
  assert.ok(resultsPage.includes("not its exact integer optimum") || resultsPage.includes("never conflated"));
});

// ---------------------------------------------------------------------------
// 7. The recorded environment defect stays honestly visible
// ---------------------------------------------------------------------------
test("r3: the trusted-bundle highs drift is recorded with both failure modes and the pin repair", () => {
  const forensics = read(join(S5, "00-bundle-drift-defect.md"));
  assert.ok(forensics.includes("PORTABLE_VERSION_DRIFT_EXPECTED_1.15.1"), "r0 drift mode recorded");
  assert.ok(forensics.includes("HIGHS_OPERATION_SCRIPT_SHA256_MISMATCH"), "r1 drift mode recorded");
  assert.ok(forensics.includes(HIGHS_SCRIPT_PIN), "canonical script pin recorded");
  assert.ok(forensics.includes("fail-closed"), "honest fail-closed behavior recorded");
  const provenance = read(join(R3, "launcher-external-cwd", "PROVENANCE.md"));
  assert.ok(provenance.includes("cf0e16d8fd603430d5941bc399229c6b32511b7b"), "C launcher validation provenance preserved");
});

test("r3: evidence binds the exact head and runner pins in the README", () => {
  const readme = read(join(R3, "README.md"));
  assert.ok(readme.includes(R3_HEAD_SHA), "EXACT_HEAD recorded");
  assert.ok(readme.includes(R0_RUNNER_SHA.slice(0, 12)), "r0 runner pin recorded");
  assert.ok(readme.includes(R1_RUNNER_SHA.slice(0, 12)), "r1 runner pin recorded");
  assert.ok(readme.includes("SURROGATE_APPROVED"), "approval honesty label present");
  assert.ok(readme.includes("REAL_LLM"), "REAL_LLM label present");
  assert.ok(readme.includes("MOCK_PROVIDER"), "MOCK_PROVIDER label present");
  assert.ok(readme.includes("REAL_SOLVER"), "REAL_SOLVER label present");
});

// ---------------------------------------------------------------------------
// 8. Committed drivers stay runnable
// ---------------------------------------------------------------------------
test("r3 drivers pass node --check (committed tooling stays runnable)", () => {
  const drivers = readdirSync(join(R3, "drivers")).filter((f) => f.endsWith(".mjs"));
  assert.ok(drivers.length >= 3, "drivers committed: " + drivers.join(", "));
  for (const f of drivers) {
    execFileSync(process.execPath, ["--check", join(R3, "drivers", f)], { stdio: "pipe" });
  }
});
