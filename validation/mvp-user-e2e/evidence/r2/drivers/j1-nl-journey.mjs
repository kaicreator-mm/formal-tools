#!/usr/bin/env node
/**
 * i180 R2 E2E acceptance — Journey 1 (P0 core NL lane), two phases.
 * OUTPUT_LABEL=FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE.
 *
 *   phase "propose":
 *     real DeepSeek (deepseek-chat, temperature 0) proposes a structured model
 *     for inputs/nl-sat-puzzle.txt (a NEW bounded-integer puzzle written by the
 *     R2 E2E validator, distinct from the R2-C driver texts). The proposal is
 *     UNTRUSTED DATA; nothing is approved or executed here. Up to two single
 *     -shot attempts are recorded (no hidden retries). Exit 0 when a usable
 *     proposal state (MODEL_PROPOSED or NEEDS_CLARIFICATION) was reached.
 *
 *   phase "approve-execute" --review <review.json>:
 *     reads the saved proposal and a SEPARATELY authored review record (the
 *     validator's actual line-by-line check of the rendering against the
 *     question text). If review.decision.approved is true, approveModel turns
 *     the proposal into a USER_APPROVED record (the ONLY path to a plan),
 *     buildPlanFromApprovedModel builds the typed plan, executeWorkflowPlan
 *     runs it against REAL pinned z3 + cvc5, and an AGREE_SAT verdict triggers
 *     the z3 witness probe (get-value) checked against every rendered bound
 *     and constraint. The witness proves the RENDERED model's answer only —
 *     never translation fidelity. review.decision.approved === false records
 *     an honest NEEDS_CORRECTION finding and executes nothing.
 *
 * Exit codes: 0 ok, 1 honest mismatch/finding, 2 BLOCKED_HOST (no bundle),
 * 3 BLOCKED_PROVIDER (no key), 5 usage error.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  R2_ROOT, REPO_ROOT, arg, requireSourceSha, saveJson, logTo,
  hasDeepSeekKey, assertNoKeyMaterial, sha256HexText
} from "./lib-r2.mjs";
import {
  proposeConstraintModel, approveModel, buildPlanFromApprovedModel, renderSmtLib
} from "../../../../../packages/runner/js/nl-model.mjs";
import { WorkflowError } from "../../../../../packages/runner/js/workflow-plan.mjs";
import { executeWorkflowPlan } from "../../../../../packages/runner/js/workflow-executor.mjs";

const SOURCE_SHA = requireSourceSha();
const PHASE = arg("--phase", "propose");
const OUT_DIR = resolve(process.cwd(), arg("--out", join(R2_ROOT, "nl-journey")));
const INPUT = join(R2_ROOT, "inputs", "nl-sat-puzzle.txt");
const PORTABLE_ROOT = process.env.FORMAL_PORTABLE_ROOT ?? null;
const PROVIDER = { name: "deepseek", model: "deepseek-chat" };
const EXPECTED_VERDICT = "AGREE_SAT"; // hand analysis: (p,e)=(1,7) satisfies 3p+2e=17, e-p=6>=2

async function realPropose(text) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p = await proposeConstraintModel({ text, provider: "deepseek" });
    attempts.push(p);
    if (p.status === "MODEL_PROPOSED" || p.status === "NEEDS_CLARIFICATION")
      return { proposal: p, attempts };
  }
  return { proposal: attempts[attempts.length - 1], attempts };
}

function codeOfThrew(fn) {
  try { fn(); return null; }
  catch (e) { return e instanceof WorkflowError ? e.code : "THREW:" + String(e); }
}

/** z3 witness probe (pattern from tests/nl-model.driver.mjs, host-only). */
function witnessProbe(model, renderingText) {
  const z3 = join(PORTABLE_ROOT, "tools", "z3", "bin", "z3");
  const dir = mkdtempSync(join(tmpdir(), "r2e2e-witness-"));
  const script = renderSmtLib(model, { mode: "witness" });
  const path = join(dir, "witness.smt2");
  writeFileSync(path, script, "utf8");
  const p = spawnSync(z3, ["witness.smt2"], { cwd: dir, encoding: "utf8", timeout: 30000 });
  const stdout = String(p.stdout ?? "");
  const values = {};
  for (const m of stdout.matchAll(/\(([a-z][a-z0-9_]*)\s+(\([^()]*\)|-?\d+)\)/g)) {
    const raw = m[2].trim();
    const neg = /^\(-\s*(\d+)\)$/.exec(raw);
    values[m[1]] = neg ? -Number(neg[1]) : Number(raw);
  }
  const firstLine = stdout.trim().split(/\r?\n/)[0];
  if (firstLine !== "sat" || Object.keys(values).length !== model.variables.length) {
    return {
      ok: false, stage: "probe", values,
      stdout_bounded: stdout.slice(0, 4096), stderr_bounded: String(p.stderr ?? "").slice(0, 1024),
      exit_code: p.status,
      note: "witness probe could not retrieve a full integer model"
    };
  }
  const checks = [];
  for (const v of model.variables) {
    const val = values[v.name];
    checks.push({ desc: `bound ${v.lower} <= ${v.name} <= ${v.upper}`, holds: val >= v.lower && val <= v.upper });
  }
  for (const [i, c] of model.constraints.entries()) {
    const lhs = Object.entries(c.coefficients).reduce((acc, [name, coeff]) => acc + coeff * values[name], 0);
    const holds = c.op === "<" ? lhs < c.rhs : c.op === "<=" ? lhs <= c.rhs :
      c.op === "==" ? lhs === c.rhs : c.op === ">=" ? lhs >= c.rhs : lhs > c.rhs;
    checks.push({
      desc: `constraint#${i} ${JSON.stringify(c.coefficients)} ${c.op} ${c.rhs} at witness ${JSON.stringify(values)}`,
      holds
    });
  }
  return {
    ok: checks.every((c) => c.holds), stage: "checked",
    script_sha256: sha256HexText(script),
    rendering_sha256: renderingText ? sha256HexText(renderingText) : null,
    values, checks,
    stdout_bounded: stdout.slice(0, 4096),
    honesty_note: "witness consistency is a check against the RENDERED constraints only; it is NOT evidence that the translation matches the natural-language text"
  };
}

// ---------------------------------------------------------------- main
async function main() {
  const text = (await readFile(INPUT, "utf8"));
  if (PHASE === "propose") {
    if (!hasDeepSeekKey()) {
      process.exitCode = 3;
      await saveJson(OUT_DIR, "propose.blocked.json", { blocked: "BLOCKED_PROVIDER", source_sha: SOURCE_SHA });
      return;
    }
    const { proposal, attempts } = await realPropose(text);
    const record = {
      schema: "formal-tools/r2e2e-nl-proposal/1.0",
      label: "FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE",
      journey: "j1-nl-core",
      phase: "propose",
      source_sha: SOURCE_SHA,
      provider: PROVIDER,
      input_text: text,
      attempts: attempts.map((a) => ({
        status: a.status, reason: a.reason ?? null, issues: a.issues ?? null,
        clarification_needed: a.clarification_needed ?? null,
        proposal_sha256: a.proposal_sha256 ?? null
      })),
      chosen_status: proposal?.status ?? null
    };
    await saveJson(OUT_DIR, "proposal.json", { record, proposal });
    await logTo(OUT_DIR, "j1.log", `propose: status=${proposal?.status} attempts=${attempts.length}`);
    if (proposal?.status === "MODEL_PROPOSED" || proposal?.status === "NEEDS_CLARIFICATION") return;
    process.exitCode = 1; // honest finding: no usable proposal state
    return;
  }

  if (PHASE === "approve-execute") {
    const reviewPath = arg("--review", null);
    const proposalPath = arg("--proposal", null);
    if (!reviewPath || !proposalPath) {
      process.stderr.write(JSON.stringify({ driver_error: "approve-execute requires --proposal <path> --review <path>" }) + "\n");
      process.exitCode = 5;
      return;
    }
    const { proposal } = JSON.parse(await readFile(proposalPath, "utf8"));
    const review = JSON.parse(await readFile(reviewPath, "utf8"));
    if (review.expected_verdict !== EXPECTED_VERDICT) {
      process.stderr.write(JSON.stringify({ driver_error: `review.expected_verdict must be ${EXPECTED_VERDICT} (hand analysis of the input text)` }) + "\n");
      process.exitCode = 5;
      return;
    }
    /** @type {any[]} */
    const checks = [];
    let approved = null, built = null, receipt = null, witness = null, verdictFinal = null;
    if (review.decision.approved === true) {
      // approveModel itself re-verifies proposal_sha256 (throws NL_TAMPERED).
      approved = approveModel(proposal, {
        approved: true,
        reviewer: review.decision.reviewer,
        note: review.decision.note
      });
      checks.push({ name: "approval record is USER_APPROVED", pass: approved.status === "USER_APPROVED" });
      built = buildPlanFromApprovedModel(approved);
      checks.push({ name: "plan built from approved model", pass: Boolean(built?.plan), detail: built?.plan?.plan_id ?? null });
      if (PORTABLE_ROOT) {
        const executed = await executeWorkflowPlan(built.plan, {
          sourceSha: SOURCE_SHA,
          host: "cc@192.168.100.200 (trusted Debian 13 host, pinned portable bundle)"
        });
        receipt = executed.receipt;
        const step = (receipt.steps ?? []).find((s) => s.tool === "compare");
        verdictFinal = step?.result?.verdict ?? null;
        checks.push({ name: "execution receipt recorded", pass: Boolean(receipt?.run_id), detail: receipt?.run_id ?? null });
        checks.push({ name: `cross-tool verdict is ${EXPECTED_VERDICT}`, pass: verdictFinal === EXPECTED_VERDICT, detail: String(verdictFinal) });
        if (verdictFinal === "AGREE_SAT") {
          witness = witnessProbe(proposal.model, proposal.rendering.text);
          checks.push({ name: "witness probe holds on every rendered bound/constraint", pass: witness.ok === true, detail: JSON.stringify(witness.values ?? {}) });
        }
      } else {
        process.exitCode = 2;
        checks.push({ name: "FORMAL_PORTABLE_ROOT present", pass: false, detail: "BLOCKED_HOST" });
      }
    } else {
      // honest NEEDS_CORRECTION finding: record, execute nothing
      checks.push({ name: "review rejected the translation (NEEDS_CORRECTION)", pass: true, detail: review.decision.reason ?? "" });
    }

    const report = {
      schema: "formal-tools/r2e2e-nl-journey-report/1.0",
      label: "FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE",
      journey: "j1-nl-core",
      source_sha: SOURCE_SHA,
      provider: PROVIDER,
      input_text: text,
      proposal_status: proposal?.status ?? null,
      proposal_sha256: proposal?.proposal_sha256 ?? null,
      review: {
        decision: review.decision,
        review_notes: review.review_notes,
        rendering_checks: review.rendering_checks ?? []
      },
      approved_sha256: approved?.approved_sha256 ?? null,
      plan: built ? {
        plan_id: built.plan.plan_id,
        plan_sha256: receipt?.plan_sha256 ?? null,
        provenance_sha256: built.provenance_sha256,
        target: built.target,
        steps: built.plan.steps.map((s) => ({ id: s.id, tool: s.tool, operation: s.operation }))
      } : null,
      execution: receipt ? {
        run_id: receipt.run_id,
        overall: receipt.overall ?? null,
        fail_closed_reason: receipt.fail_closed_reason ?? null,
        tool_versions: receipt.tool_versions ?? null,
        source_sha: receipt.source_sha ?? null
      } : null,
      verdict: verdictFinal ?? null,
      witness,
      checks,
      all_checks_passed: checks.every((c) => c.pass),
      honesty_note: "All verdicts answer the RENDERED model. The DeepSeek output is a translation proposal; the approval here is the recorded, hash-covered decision of the E2E validator after checking the rendering against the text (agent surrogate, not an independent human). Witness consistency never implies translation fidelity."
    };
    assertNoKeyMaterial(report);
    if (approved) await saveJson(OUT_DIR, "approved.json", approved);
    if (built) await saveJson(OUT_DIR, "plan.json", built.plan);
    if (receipt) await saveJson(OUT_DIR, "receipt.json", receipt);
    if (witness) await saveJson(OUT_DIR, "witness.json", witness);
    await saveJson(OUT_DIR, "report.json", report);
    await logTo(OUT_DIR, "j1.log", `approve-execute: verdict=${verdictFinal} all_pass=${report.all_checks_passed}`);
    if (!report.all_checks_passed) process.exitCode = 1;
    return;
  }

  process.stderr.write(JSON.stringify({ driver_error: "unknown --phase; use propose | approve-execute" }) + "\n");
  process.exitCode = 5;
}

try {
  await main();
} catch (e) {
  process.stderr.write(JSON.stringify({ driver_error: String(e && e.stack || e).slice(0, 1000) }) + "\n");
  process.exit(5);
}
