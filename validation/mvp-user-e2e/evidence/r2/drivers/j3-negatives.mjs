#!/usr/bin/env node
/**
 * i180 R2 E2E acceptance — Journey 3: negative fail-closed cases (>=3).
 * OUTPUT_LABEL=FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE.
 *
 *  (a) unsupported/vague NL input -> real DeepSeek returns NEEDS_CLARIFICATION
 *      with its own questions; rendering is null; approval attempt throws
 *      NL_NOT_APPROVABLE. Never rendered, never executed.
 *  (b) tampered plan over MCP -> execute_workflow rejects it PRE-execution as
 *      a tool error with PLAN_HASH_MISMATCH (step input mutated, input_sha256
 *      kept); the real executor throws WorkflowPlanError before any launch and
 *      writes nothing.
 *  (c) unavailable-tool path (CLI) -> FORMAL_PORTABLE_ROOT pointed at an EMPTY
 *      directory: the executor preflight fails closed with an honest ABORTED
 *      receipt (fail_closed_reason=BLOCKED_TOOL_MISSING, claim BLOCKED, every
 *      step NOT_RUN). No crash, no PASS.
 *  (d) unavailable-tool path (Web) -> the bridge on :8789 started with the
 *      empty bundle root returns the same honest ABORTED receipt (the UI
 *      renders the BLOCKED banner; screenshots live in ../screenshots).
 *
 * An UNKNOWN-class case is deliberately NOT fabricated: honestly producing a
 * solver "unknown" would need a genuinely undecidable-by-timeout input, which
 * is not cleanly constructible under the fixed budget; recorded as not-run in
 * the report instead of faked.
 *
 * Exit codes: 0 every negative failed closed as expected, 2 a finding, 5 error.
 */
import { spawnSync } from "node:child_process";
import { readFile, copyFile, access, mkdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import {
  REPO_ROOT, R2_ROOT, arg, requireSourceSha, saveJson, startMcpExecuteClient,
  check, hasDeepSeekKey, assertNoKeyMaterial, logTo
} from "./lib-r2.mjs";
import { proposeConstraintModel, approveModel } from "../../../../../packages/runner/js/nl-model.mjs";
import { WorkflowError } from "../../../../../packages/runner/js/workflow-plan.mjs";

const SOURCE_SHA = requireSourceSha();
const OUT_DIR = resolve(process.cwd(), arg("--out", join(R2_ROOT, "negatives")));
const VAGUE_INPUT = join(R2_ROOT, "inputs", "vague-nl.txt");
const PLAN_FILE = resolve(process.cwd(), arg("--plan", join(R2_ROOT, "parity", "plan.json")));
const BLOCKED_WEB_BASE = arg("--blocked-web-base", "http://127.0.0.1:8789");
const PROVIDER = { name: "deepseek", model: "deepseek-chat" };

function runCli(args, { timeoutMs = 120000, env = process.env } = {}) {
  const p = spawnSync(process.execPath, [join(REPO_ROOT, "packages", "runner", "js", "cli.mjs"), ...args], {
    encoding: "utf8", timeout: timeoutMs, cwd: REPO_ROOT, env
  });
  let parsed;
  try { parsed = JSON.parse(p.stdout ?? ""); } catch { parsed = undefined; }
  return { argv: args, exit_code: p.status, stdout: (p.stdout ?? "").slice(0, 100000), stderr: (p.stderr ?? "").slice(0, 100000), parsed: parsed ?? null };
}

async function exists(p) {
  try { await access(p, fsConstants.F_OK); return true; } catch { return false; }
}

const findings = [];
const results = {};

async function main() {
  // ---------- (a) vague NL -> NEEDS_CLARIFICATION ----------
  if (hasDeepSeekKey()) {
    const text = await readFile(VAGUE_INPUT, "utf8");
    const attempts = [];
    let proposal = null;
    for (let i = 0; i < 2 && !proposal; i++) {
      proposal = await proposeConstraintModel({ text, provider: "deepseek" });
      attempts.push(proposal);
      if (proposal.status === "NEEDS_CLARIFICATION") break;
      if (proposal.status === "UNKNOWN") proposal = null; // one honest re-attempt, all recorded
    }
    const approvalAttempt = proposal && proposal.status === "NEEDS_CLARIFICATION"
      ? (() => {
          try { approveModel(proposal, { approved: true }); return { threw: null }; }
          catch (e) { return { threw: e instanceof WorkflowError ? e.code : "THREW:" + String(e) }; }
        })()
      : { threw: null, note: "proposal did not reach NEEDS_CLARIFICATION" };
    results.needsClarification = {
      input: text, provider: PROVIDER,
      attempts: attempts.map((a) => ({ status: a.status, reason: a.reason ?? null, issues: a.issues ?? null })),
      status: proposal?.status ?? null,
      clarification_needed: proposal?.clarification_needed ?? null,
      rendering_present: Boolean(proposal?.rendering),
      approval_attempt_threw: approvalAttempt.threw,
      matched: proposal?.status === "NEEDS_CLARIFICATION" &&
        Array.isArray(proposal?.clarification_needed) && proposal.clarification_needed.length > 0 &&
        !proposal.rendering && approvalAttempt.threw === "NL_NOT_APPROVABLE"
    };
    check(findings, "(a) vague NL -> NEEDS_CLARIFICATION with questions; nothing rendered; approval impossible",
      results.needsClarification.matched,
      JSON.stringify({ status: results.needsClarification.status, threw: approvalAttempt.threw }));
    await saveJson(OUT_DIR, "needs-clarification.proposal.json", assertNoKeyMaterial({ input: text, proposal }));
    await saveJson(OUT_DIR, "needs-clarification.result.json", results.needsClarification);
  } else {
    check(findings, "(a) vague NL case ran (DEEPSEEK_API_KEY)", false, "BLOCKED_PROVIDER: no key in host env; case not run");
  }

  // ---------- (b) tampered plan over MCP -> PLAN_HASH_MISMATCH pre-execution ----------
  {
    const plan = JSON.parse(await readFile(PLAN_FILE, "utf8"));
    const tampered = JSON.parse(JSON.stringify(plan));
    tampered.steps[0].input.smt_lib = tampered.steps[0].input.smt_lib + "\n; tampered by j3-negatives (input_sha256 intentionally left stale)\n";
    const client = await startMcpExecuteClient({ timeoutMs: 60000 });
    try {
      const init = await client.request("initialize", {
        protocolVersion: "2025-06-18", capabilities: {},
        clientInfo: { name: "formal-r2-e2e-negative", version: "1.0.0" }
      });
      check(findings, "(b) MCP initialize handshake", init.result?.serverInfo?.name === "formal-tools-skill");
      client.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const call = await client.call("execute_workflow", { plan: tampered, source_sha: SOURCE_SHA }, 60000);
      const body = call.parsed ?? {};
      results.tamperedMcp = {
        isError: call.isError,
        status: body.status ?? null,
        code: body.code ?? null,
        executed: body.executed ?? null,
        message: String(body.message ?? "").slice(0, 300),
        matched: call.isError === true && body.executed === false && body.code === "PLAN_HASH_MISMATCH"
      };
      check(findings, "(b) tampered plan over MCP -> PLAN_HASH_MISMATCH as a PRE-execution tool error (executed:false, no receipt)",
        results.tamperedMcp.matched, JSON.stringify({ isError: call.isError, code: body.code, executed: body.executed, msg: results.tamperedMcp.message }));
      await saveJson(OUT_DIR, "mcp-tampered-result.json", results.tamperedMcp);
    } finally {
      await client.close();
      await saveJson(OUT_DIR, "mcp-tampered-transcript.json", assertNoKeyMaterial({
        schema: "formal-tools/r2e2e-mcp-transcript/1.0",
        note: "execute_workflow tampered-plan negative transcript (tampered plan payload omitted; committed under negatives/ as metadata)",
        tampered_plan_meta: { plan_id: tampered.plan_id, mutated_step: tampered.steps[0].id, mutation: "appended comment line to steps[0].input.smt_lib; input_sha256 kept stale" },
        transcript: client.transcript.map((e) => (e.outbound && e.outbound.method === "tools/call")
          ? { outbound: { id: e.outbound.id, method: e.outbound.method, params_summary: "execute_workflow(tampered plan<omitted>, source_sha)" } }
          : e),
        stderr_tail: client.stderrTail.slice(0, 20)
      }));
    }
  }

  // ---------- (c) empty FORMAL_PORTABLE_ROOT via the real CLI ----------
  {
    const emptyRoot = arg("--empty-root", "/home/cc/formal-tools-build/r2e-empty-root");
    await mkdir(emptyRoot, { recursive: true }); // exists, contains nothing
    const plan = JSON.parse(await readFile(PLAN_FILE, "utf8"));
    const before = await exists(join(REPO_ROOT, "artifacts", plan.plan_id, "receipt.json"));
    const env = { ...process.env, FORMAL_PORTABLE_ROOT: emptyRoot };
    const run = runCli(["workflow", "execute", "--plan-file", PLAN_FILE, "--source-sha", SOURCE_SHA], { env });
    const summary = run.parsed;
    const cliBlocked = {
      exit_code: run.exit_code,
      blocked: summary?.blocked ?? null,
      overall: summary?.overall ?? null,
      receipt_existed_before: before
    };
    const receiptPath = join(REPO_ROOT, "artifacts", plan.plan_id, "receipt.json");
    if (await exists(receiptPath)) {
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      cliBlocked.receipt = {
        schema: receipt.schema, run_id: receipt.run_id, source_sha: receipt.source_sha,
        overall: receipt.overall,
        step_statuses: receipt.steps.map((s) => ({ step_id: s.step_id, status: s.status })),
        environment: receipt.environment
      };
      await copyFile(receiptPath, join(OUT_DIR, "cli-blocked-tool-missing.receipt.json"));
      cliBlocked.matched = run.exit_code === 2 && summary?.blocked === "BLOCKED_TOOL_MISSING" &&
        receipt.overall.process_outcome === "ABORTED" &&
        receipt.overall.claim_verdict === "BLOCKED" &&
        receipt.overall.fail_closed_reason === "BLOCKED_TOOL_MISSING" &&
        receipt.steps.every((s) => s.status === "NOT_RUN");
    } else {
      cliBlocked.matched = false;
    }
    results.cliBlocked = cliBlocked;
    check(findings, "(c) CLI with empty FORMAL_PORTABLE_ROOT -> honest ABORTED receipt (BLOCKED_TOOL_MISSING, claim BLOCKED, steps NOT_RUN, exit 2, no crash)",
      cliBlocked.matched === true, JSON.stringify({ exit: run.exit_code, blocked: cliBlocked.blocked, overall: cliBlocked.overall }));
  }

  // ---------- (d) empty FORMAL_PORTABLE_ROOT via the Web bridge ----------
  {
    const plan = JSON.parse(await readFile(PLAN_FILE, "utf8"));
    try {
      const post = await fetch(`${BLOCKED_WEB_BASE}/api/runs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan })
      });
      const started = await post.json();
      let summary = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((ok) => setTimeout(ok, 1000));
        const r = await fetch(`${BLOCKED_WEB_BASE}/api/runs/${encodeURIComponent(started.run_id)}`);
        summary = await r.json();
        if (summary.status !== "running") break;
      }
      const receipt = summary?.receipt ?? null;
      results.webBlocked = {
        base: BLOCKED_WEB_BASE,
        run_id: started.run_id ?? null,
        status: summary?.status ?? null,
        overall: receipt?.overall ?? null,
        matched: summary?.status === "complete" && receipt?.overall?.process_outcome === "ABORTED" &&
          receipt?.overall?.fail_closed_reason === "BLOCKED_TOOL_MISSING" &&
          receipt?.overall?.claim_verdict === "BLOCKED"
      };
      if (receipt) await saveJson(OUT_DIR, "web-blocked-tool-missing.receipt.json", receipt);
      check(findings, "(d) Web bridge without the bundle -> honest ABORTED receipt (BLOCKED_TOOL_MISSING), no crash, no PASS",
        results.webBlocked.matched, JSON.stringify({ status: results.webBlocked.status, overall: results.webBlocked.overall }));
    } catch (e) {
      results.webBlocked = { base: BLOCKED_WEB_BASE, error: String(e).slice(0, 300), matched: false };
      check(findings, "(d) Web bridge without the bundle reachable", false, results.webBlocked.error);
    }
  }

  const report = {
    schema: "formal-tools/r2e2e-negatives-report/1.0",
    label: "FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE",
    journey: "j3-negatives",
    source_sha_git_label: SOURCE_SHA,
    results,
    unknown_class_case: {
      status: "NOT_RUN",
      reason: "an honest solver-UNKNOWN verdict is not cleanly constructible under the fixed budget/inputs without scripting a solver; deliberately not fabricated"
    },
    findings,
    all_checks_passed: findings.every((f) => f.pass)
  };
  await saveJson(OUT_DIR, "negatives-report.json", report);
  await logTo(OUT_DIR, "j3.log", `negatives: all_pass=${report.all_checks_passed}`);
  process.exitCode = report.all_checks_passed ? 0 : 2;
}

try {
  await main();
} catch (e) {
  process.stderr.write(JSON.stringify({ driver_error: String(e && e.stack || e).slice(0, 1200) }) + "\n");
  process.exit(5);
}
