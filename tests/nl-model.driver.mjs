#!/usr/bin/env node
/**
 * Issue #182 follow-up R2-C — REAL NL-model journeys driver.
 *
 * NOT part of the CI test glob (tests/*.test.mjs): this driver calls the real
 * DeepSeek provider and, on the trusted host, the real pinned z3 / cvc5 /
 * HiGHS from the portable bundle. Run it as (trusted Debian host):
 *
 *   cd <synced worktree>
 *   set -a && . ./.dsenv && set +a          # DEEPSEEK_API_KEY, 0600 file
 *   FORMAL_PORTABLE_ROOT=$B FORMAL_PORTABLE_RUNNER_SHA256=<bundle sha> \
 *     $B/bin/tool-runner node tests/nl-model.driver.mjs \
 *     --source-sha <40hex git SHA> --out validation/local-runtime-receipts
 *
 * Journeys (each one is a REAL end-to-end pass; nothing is simulated except
 * the user's click — the approval gate is exercised by a driver surrogate,
 * which every receipt records explicitly):
 *   J1 sat          — Chinese NL text -> real DeepSeek proposal -> (surrogate)
 *                     approval -> SMT plan -> real z3 + cvc5 -> AGREE_SAT ->
 *                     z3 witness probe (get-value) checked against every
 *                     rendered constraint. The witness proves the MODEL's
 *                     answer, NOT the translation's fidelity to the Chinese
 *                     text — that is exactly what the human approval gate is
 *                     for and the receipts say so.
 *   J2 unsat        — false Chinese claim -> AGREE_UNSAT under the rendered
 *                     model => claim disproved in the model.
 *   J3 vague        — "prove our system is safe" -> NEEDS_CLARIFICATION with
 *                     the model's own questions; never rendered, never
 *                     executed; approval must be impossible.
 *   J4 optimize(lp) — maximize 3x+2y (nonneg integers, x+y<=4, x<=3) -> R3
 *                     fail-closed probe (approval WITHOUT acknowledgement ->
 *                     UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION, plan:null) ->
 *                     explicit lpRelaxationAcknowledged:true -> LP plan with
 *                     LP_RELAXATION_ONLY metadata -> HiGHS kOptimal with
 *                     objective 11 (hand-provable LP optimum at (3,1)).
 *
 * Receipts: --out (default validation/local-runtime-receipts), files
 * nl-model-*.json plus nl-model-run.json summary and nl-model-driver.log.
 * DEEPSEEK_API_KEY is read from the environment only and is never written to
 * any receipt, log or transcript (provider errors are classified upstream and
 * never embed key material). Exit: 0 all journeys matched; 1 honest surprise;
 * 2 BLOCKED_HOST; 3 BLOCKED_PROVIDER; 5 usage error.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  proposeConstraintModel, approveModel, buildPlanFromApprovedModel, renderSmtLib,
  NL_UNSUPPORTED_EXACT_INTEGER, NL_LP_RELAXATION_ONLY
} from "../packages/runner/js/nl-model.mjs";
import { WorkflowError } from "../packages/runner/js/workflow-plan.mjs";
import { executeWorkflowPlan } from "../packages/runner/js/workflow-executor.mjs";

// ---------------------------------------------------------------- utilities
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SOURCE_SHA = arg("--source-sha", null);
if (!SOURCE_SHA || !/^[a-f0-9]{40}$/.test(SOURCE_SHA)) {
  process.stderr.write(JSON.stringify({ driver_error: "--source-sha <40hex git SHA> is required" }) + "\n");
  process.exit(5);
}
const OUT_DIR = resolve(process.cwd(), arg("--out", "validation/local-runtime-receipts"));
const PORTABLE_ROOT = process.env.FORMAL_PORTABLE_ROOT ?? null;
const HAS_KEY = typeof process.env.DEEPSEEK_API_KEY === "string" && process.env.DEEPSEEK_API_KEY.length > 0;
const PROVIDER = { name: "deepseek", model: "deepseek-chat" };

const LOG_PATH = join(OUT_DIR, "nl-model-driver.log");
async function log(line) {
  const text = "[" + new Date().toISOString() + "] " + line + "\n";
  process.stdout.write(text);
  await appendFile(LOG_PATH, text, "utf8");
}

async function save(name, obj) {
  await writeFile(join(OUT_DIR, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
  await log("saved " + name);
}

function codeOfThrew(fn) {
  try { fn(); return null; }
  catch (e) { return e instanceof WorkflowError ? e.code : "THREW:" + String(e); }
}

const sha256HexText = text => createHash("sha256").update(text, "utf8").digest("hex");

// ---------------------------------------------------------------- journeys
const J1_TEXT =
  "找出整数 x 和 y:x 至少是 3,y 至少是 1,两个都不超过 50,x+y 恰好是 7 的倍数,并且 y 不超过 x。这样的整数对存在吗?";
const J2_TEXT = "x 是一个整数,它至少是 5,同时又不超过 3。请问:满足这两个条件的 x 存在吗?";
const J3_TEXT = "证明我们的系统总体上是安全的";
const J4_TEXT = "最大化 3x+2y,其中 x 和 y 都是非负整数,x+y 不超过 4,并且 x 不超过 3";

/** Real proposal; up to two single-shot attempts, each recorded. */
async function realPropose(text) {
  if (!HAS_KEY) return { blocked: "BLOCKED_PROVIDER", proposal: null, attempts: [] };
  /** @type {any[]} */
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p = await proposeConstraintModel({ text, provider: "deepseek" });
    attempts.push(p);
    if (p.status === "MODEL_PROPOSED" || p.status === "NEEDS_CLARIFICATION")
      return { proposal: p, attempts };
  }
  return { proposal: attempts[attempts.length - 1], attempts };
}

/** Surrogate approval: demonstrates the gate; NOT a human review. The
 * reviewer metadata is part of the hash-covered approval decision itself.
 * `extra` carries additional decision fields (e.g. the R3
 * lpRelaxationAcknowledged acknowledgement for the LP arm). */
function surrogateApprove(proposal, extra = {}) {
  return approveModel(proposal, {
    approved: true,
    reviewer: "driver-surrogate (NOT a human; demonstrates the approval gate; a human must review the recorded model before any production use)",
    note: "basis: the full structured model and rendered text are preserved verbatim in the proposal receipt for the human reviewer",
    ...extra
  });
}

async function executeApproved(approved) {
  const built = buildPlanFromApprovedModel(approved);
  const { receipt, workspaceDir } = await executeWorkflowPlan(built.plan, {
    sourceSha: SOURCE_SHA,
    host: "cc@192.168.100.200 (trusted Debian 13 host, portable bundle)"
  });
  return { built, receipt, workspaceDir };
}

function crossVerdict(receipt) {
  const step = (receipt.steps ?? []).find(s => s.tool === "compare");
  return step?.result?.verdict ?? null;
}

/** Parse z3 get-value output: pairs like (x 4) or negatives like (x (- 5)). */
function parseGetValues(stdout) {
  /** @type {Record<string, number>} */
  const values = {};
  for (const m of String(stdout).matchAll(/\(([a-z][a-z0-9_]*)\s+(\([^()]*\)|-?\d+)\)/g)) {
    const raw = m[2].trim();
    const neg = /^\(-\s*(\d+)\)$/.exec(raw);
    values[m[1]] = neg ? -Number(neg[1]) : Number(raw);
  }
  return values;
}

/** z3 witness probe: run the witness rendering (get-value) and check every
 * rendered bound/constraint against the retrieved integers. */
async function witnessProbe(model, renderingText) {
  const z3 = join(PORTABLE_ROOT, "tools", "z3", "bin", "z3");
  const dir = mkdtempSync(join(tmpdir(), "nl-witness-"));
  const script = renderSmtLib(model, { mode: "witness" });
  const path = join(dir, "witness.smt2");
  await writeFile(path, script, "utf8");
  const p = spawnSync(z3, ["witness.smt2"], { cwd: dir, encoding: "utf8", timeout: 30000 });
  const stdout = String(p.stdout ?? "");
  const values = parseGetValues(stdout);
  const firstLine = stdout.trim().split(/\r?\n/)[0];
  if (firstLine !== "sat" || Object.keys(values).length !== model.variables.length) {
    return {
      ok: false, stage: "probe",
      stdout_bounded: stdout.slice(0, 4096), stderr_bounded: String(p.stderr ?? "").slice(0, 1024),
      exit_code: p.status, values,
      note: "witness probe could not retrieve a full integer model"
    };
  }
  const checks = [];
  for (const v of model.variables) {
    const val = values[v.name];
    checks.push({ desc: "bound " + v.lower + " <= " + v.name + " <= " + v.upper, holds: val >= v.lower && val <= v.upper });
  }
  for (const [i, c] of model.constraints.entries()) {
    const lhs = Object.entries(c.coefficients).reduce((acc, [name, coeff]) => acc + coeff * values[name], 0);
    const holds = c.op === "<" ? lhs < c.rhs : c.op === "<=" ? lhs <= c.rhs :
      c.op === "==" ? lhs === c.rhs : c.op === ">=" ? lhs >= c.rhs : lhs > c.rhs;
    checks.push({
      desc: "constraint#" + i + " " + JSON.stringify(c.coefficients) + " " + c.op + " " + c.rhs +
        " at witness " + JSON.stringify(values),
      holds
    });
  }
  return {
    ok: checks.every(c => c.holds), stage: "checked",
    script_sha256: sha256HexText(script), rendering_sha256: renderingText ? sha256HexText(renderingText) : null,
    values, checks,
    stdout_bounded: stdout.slice(0, 4096),
    honesty_note: "witness consistency is a check against the RENDERED constraints only; it is NOT evidence that the translation matches the natural-language text"
  };
}

// ---------------------------------------------------------------- main
/** @type {any[]} */
const journeys = [];
let exitCode = 0;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await log("nl-model driver start: source=" + SOURCE_SHA + " out=" + OUT_DIR +
    " key=" + (HAS_KEY ? "set" : "ABSENT") + " portable_root=" + (PORTABLE_ROOT ? "set" : "ABSENT"));

  // ---- J3 first: needs only the provider (never rendered, never executed).
  if (HAS_KEY) {
    await log("J3 vague-text journey (NEEDS_CLARIFICATION expected)");
    const r3 = await realPropose(J3_TEXT);
    const p3 = r3.proposal;
    const approvalAttempt = p3 && p3.status === "NEEDS_CLARIFICATION"
      ? { approve_threw: codeOfThrew(() => approveModel(p3, { approved: true })) }
      : { approve_threw: null, note: "proposal did not reach NEEDS_CLARIFICATION" };
    /** @type {any} */
    const j3 = {
      journey: "j3-vague-clarification",
      expectation: "NEEDS_CLARIFICATION with specific questions; no rendering; no execution; approval impossible",
      text: J3_TEXT,
      provider: PROVIDER,
      attempts: r3.attempts.map(a => ({ attempt_status: a.status, reason: a.reason ?? null, issues: a.issues ?? null })),
      status: p3?.status ?? null,
      clarification_needed: p3?.clarification_needed ?? null,
      rendering_present: Boolean(p3?.rendering),
      approval_attempt: approvalAttempt,
      matched: p3?.status === "NEEDS_CLARIFICATION" &&
        Array.isArray(p3?.clarification_needed) && p3.clarification_needed.length > 0 &&
        !p3.rendering && approvalAttempt.approve_threw === "NL_NOT_APPROVABLE",
      source_sha: SOURCE_SHA
    };
    await save("nl-model-j3-clarification.proposal.json", { journey: j3, proposal: p3 });
    journeys.push(j3);
    if (!j3.matched) exitCode = 1;
    await log("J3 status=" + j3.status + " matched=" + j3.matched);
  } else {
    const blocked = { journey: "j3-vague-clarification", blocked: "BLOCKED_PROVIDER", matched: false, source_sha: SOURCE_SHA };
    journeys.push(blocked);
    await save("nl-model-j3-clarification.proposal.json", blocked);
    exitCode = 3;
  }

  // ---- SMT/LP journeys need the portable bundle; provider needs the key.
  const executable = Boolean(PORTABLE_ROOT) && HAS_KEY;
  if (executable) {
    for (const [name, text, expectVerdict] of [
      ["j1-sat", J1_TEXT, "AGREE_SAT"],
      ["j2-unsat", J2_TEXT, "AGREE_UNSAT"]
    ]) {
      await log(name + " journey (" + expectVerdict + " expected)");
      const r = await realPropose(text);
      const p = r.proposal;
      /** @type {any} */
      const j = {
        journey: "nl-" + name,
        expectation: expectVerdict + " from real z3+cvc5 on the rendered model",
        text,
        provider: PROVIDER,
        attempts: r.attempts.map(a => ({ attempt_status: a.status, reason: a.reason ?? null, issues: a.issues ?? null })),
        proposal_status: p?.status ?? null,
        model: p?.model ?? null,
        rendering: p?.rendering ?? null,
        matched: false,
        source_sha: SOURCE_SHA
      };
      if (p?.status !== "MODEL_PROPOSED") {
        j.surprise = "proposal did not reach MODEL_PROPOSED";
        await save("nl-model-" + name + ".report.json", j);
        journeys.push(j);
        exitCode = 1;
        continue;
      }
      const approved = surrogateApprove(p);
      j.approval = { status: approved.status, reviewer: approved.review.reviewer };
      /** @type {any} */
      let executed = null;
      try {
        executed = await executeApproved(approved);
      } catch (e) {
        j.surprise = "plan build/execution threw: " + String(e && e.message || e);
        await save("nl-model-" + name + ".report.json", j);
        journeys.push(j);
        exitCode = 1;
        continue;
      }
      const { built, receipt, workspaceDir } = executed;
      const verdict = crossVerdict(receipt);
      j.plan = {
        plan_id: built.plan.plan_id,
        plan_sha256: receipt.plan_sha256,
        provenance_sha256: built.provenance_sha256,
        steps: built.plan.steps.map(s => ({ id: s.id, tool: s.tool, operation: s.operation })),
        target: built.target
      };
      j.execution = {
        run_id: receipt.run_id,
        overall: receipt.overall ?? null,
        fail_closed_reason: receipt.fail_closed_reason ?? null,
        workspace_dir: workspaceDir,
        tool_versions: receipt.tool_versions ?? null
      };
      j.verdict = verdict;
      let witness = null;
      if (verdict === "AGREE_SAT") {
        witness = await witnessProbe(p.model, p.rendering.text);
        j.witness = witness;
      }
      j.matched = verdict === expectVerdict && (verdict !== "AGREE_SAT" || witness?.ok === true);
      await save("nl-model-" + name + ".proposal.json", { journey: "nl-" + name, approval_note: j.approval, proposal: p });
      await save("nl-model-" + name + ".execution-receipt.json", { journey: "nl-" + name, plan: built.plan, receipt });
      if (witness) await save("nl-model-" + name + ".witness.json", { journey: "nl-" + name, witness });
      await save("nl-model-" + name + ".report.json", j);
      journeys.push(j);
      if (!j.matched) exitCode = 1;
      await log(name + " verdict=" + verdict + " witness=" + (witness ? String(witness.ok) : "n/a") + " matched=" + j.matched);
    }

    // ---- J4: LP / optimize arm on real HiGHS.
    await log("j4-lp journey (kOptimal objective 11 expected)");
    const r4 = await realPropose(J4_TEXT);
    const p4 = r4.proposal;
    /** @type {any} */
    const j4 = {
      journey: "nl-j4-lp-optimize",
      expectation: "fail-closed UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION without the acknowledgement; " +
        "with lpRelaxationAcknowledged:true, HiGHS kOptimal with objective 11 on the LP relaxation " +
        "(integrality dropped; LP_RELAXATION_ONLY metadata recorded in plan + approval)",
      text: J4_TEXT,
      provider: PROVIDER,
      attempts: r4.attempts.map(a => ({ attempt_status: a.status, reason: a.reason ?? null, issues: a.issues ?? null })),
      proposal_status: p4?.status ?? null,
      model: p4?.model ?? null,
      matched: false,
      source_sha: SOURCE_SHA
    };
    if (p4?.status === "MODEL_PROPOSED" && p4.model?.question === "optimize") {
      // R3 fail-closed probe: surrogate approval WITHOUT the LP acknowledgement
      // must return the restricted unsupported record, never a plan.
      const noAck = surrogateApprove(p4);
      j4.fail_closed_probe = {
        decision: "approved:true WITHOUT lpRelaxationAcknowledged",
        status: noAck.status ?? null,
        reason: noAck.unsupported?.reason ?? null,
        plan: noAck.plan
      };
      const approved = surrogateApprove(p4, { lpRelaxationAcknowledged: true });
      j4.approval = {
        status: approved.status, reviewer: approved.review.reviewer,
        lp_relaxation_ack: approved.review.lp_relaxation_ack ?? null
      };
      try {
        const { built, receipt, workspaceDir } = await executeApproved(approved);
        const step = receipt.steps.find(s => s.tool === "highs");
        const solver = step?.result ?? null;
        j4.plan = {
          plan_id: built.plan.plan_id, plan_sha256: receipt.plan_sha256,
          provenance_sha256: built.provenance_sha256, target: built.target,
          assumptions: built.plan.assumptions
        };
        j4.relaxation = built.relaxation ?? null;
        j4.execution = {
          run_id: receipt.run_id, overall: receipt.overall ?? null,
          fail_closed_reason: receipt.fail_closed_reason ?? null, workspace_dir: workspaceDir
        };
        j4.solver = solver;
        j4.objective = solver?.objective ?? null;
        j4.model_status = solver?.model_status ?? null;
        j4.matched = j4.fail_closed_probe.status === NL_UNSUPPORTED_EXACT_INTEGER &&
          j4.fail_closed_probe.plan === null &&
          j4.fail_closed_probe.reason === "LP_RELAXATION_NOT_ACKNOWLEDGED" &&
          approved.review?.lp_relaxation_ack?.kind === NL_LP_RELAXATION_ONLY &&
          built.relaxation?.kind === NL_LP_RELAXATION_ONLY &&
          solver?.model_status === "kOptimal" &&
          typeof solver?.objective === "number" && Math.abs(solver.objective - 11) < 1e-9;
        await save("nl-model-j4-lp.proposal.json", { journey: "nl-j4-lp-optimize", proposal: p4 });
        await save("nl-model-j4-lp.execution-receipt.json", { journey: "nl-j4-lp-optimize", plan: built.plan, receipt });
      } catch (e) {
        j4.surprise = "plan build/execution threw: " + String(e && e.message || e);
      }
    } else {
      j4.surprise = "proposal did not reach MODEL_PROPOSED with question=optimize";
    }
    await save("nl-model-j4-lp.report.json", j4);
    journeys.push(j4);
    if (!j4.matched) exitCode = 1;
    await log("j4 model_status=" + j4.model_status + " objective=" + j4.objective + " matched=" + j4.matched);
  } else {
    for (const name of ["j1-sat", "j2-unsat", "j4-lp"]) {
      const blocked = {
        journey: "nl-" + name,
        blocked: !HAS_KEY ? "BLOCKED_PROVIDER" : "BLOCKED_HOST (FORMAL_PORTABLE_ROOT missing)",
        matched: false, source_sha: SOURCE_SHA
      };
      journeys.push(blocked);
      await save("nl-model-" + name + ".report.json", blocked);
    }
    exitCode = HAS_KEY ? 2 : 3;
  }

  const summary = {
    schema: "formal-tools/nl-model-driver-run/1.0",
    label: "FORMAL_TOOLS_I180_R2_NL_TO_MODEL",
    source_sha: SOURCE_SHA,
    provider: PROVIDER,
    portable_root_present: Boolean(PORTABLE_ROOT),
    key_present: HAS_KEY,
    journeys: journeys.map(j => ({
      journey: j.journey, matched: j.matched, status: j.status ?? j.proposal_status ?? null,
      verdict: j.verdict ?? j.model_status ?? null, blocked: j.blocked ?? null, surprise: j.surprise ?? null
    })),
    all_matched: journeys.every(j => j.matched === true),
    honesty_note: "All verdicts answer the RENDERED models. The DeepSeek output is a translation proposal; the approval gate in these journeys was exercised by a driver surrogate, not a human. Render validity and witness consistency never imply translation fidelity.",
    exit_code: exitCode
  };
  await save("nl-model-run.json", summary);
  await log("driver done exit=" + exitCode);
  return exitCode;
}

process.exitCode = await main();
