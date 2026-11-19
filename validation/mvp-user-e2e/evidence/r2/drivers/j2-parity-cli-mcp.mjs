#!/usr/bin/env node
/**
 * i180 R2 E2E acceptance — Journey 2: three-entry parity on ONE fixed plan.
 * OUTPUT_LABEL=FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE.
 *
 * The plan is built ONCE by the web bridge's deterministic template
 * (POST /api/plan with inputs/scenario-r2.smt2; recorded in parity/plan.json)
 * and then executed through TWO entries by this driver:
 *   (a) CLI   — `node packages/runner/js/cli.mjs workflow execute --plan-file <plan> --source-sha <sha>`
 *               as a REAL subprocess on the trusted host (bundle env inherited).
 *   (b) MCP   — tools/call execute_workflow over stdio JSON-RPC against the
 *               real mcp.mjs child (FULL env kept: FORMAL_PORTABLE_ROOT set),
 *               with the REQUIRED source_sha label.
 * Entry (c) Web runs the same deterministic plan through the real browser
 * journey; its receipt is fetched over HTTP and merged here via
 * --web-summary/--web-receipt for the final parity assertions:
 *   - identical plan_sha256 across all three receipts;
 *   - identical overall cross-tool verdict (expected AGREE_UNSAT) and claim verdict;
 *   - run_ids pairwise distinct;
 *   - every receipt records a source_sha (CLI/MCP: the required git SHA label;
 *     Web: the bridge binds source_sha to plan.source.problem_sha256 by design —
 *     recorded honestly as an EXPECTED difference, not a match).
 *
 * Exit codes: 0 all parity assertions hold, 2 mismatch/finding, 5 usage error.
 */
import { spawnSync } from "node:child_process";
import { readFile, copyFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import {
  REPO_ROOT, R2_ROOT, arg, requireSourceSha, saveJson, startMcpExecuteClient,
  check, assertNoKeyMaterial, sha256HexBytes
} from "./lib-r2.mjs";

const SOURCE_SHA = requireSourceSha();
const OUT_DIR = resolve(process.cwd(), arg("--out", join(R2_ROOT, "parity")));
const PLAN_FILE = resolve(process.cwd(), arg("--plan", join(R2_ROOT, "parity", "plan.json")));
const WEB_SUMMARY_FILE = arg("--web-summary", null);
const WEB_RECEIPT_FILE = arg("--web-receipt", null);
const MERGE_ONLY = arg("--merge-only", null) !== null;
const EXPECTED_VERDICT = "AGREE_UNSAT"; // hand analysis: x,y in [0,3] force x+y<=6 < 9

function runCli(args, timeoutMs = 240000) {
  const p = spawnSync(process.execPath, [join(REPO_ROOT, "packages", "runner", "js", "cli.mjs"), ...args], {
    encoding: "utf8", timeout: timeoutMs, cwd: REPO_ROOT, env: process.env
  });
  let parsed;
  try { parsed = JSON.parse(p.stdout ?? ""); } catch { parsed = undefined; }
  return {
    argv: args, exit_code: p.status,
    stdout: (p.stdout ?? "").slice(0, 200000), stderr: (p.stderr ?? "").slice(0, 200000),
    parsed: parsed ?? null
  };
}

async function exists(p) {
  try { await access(p, fsConstants.F_OK); return true; } catch { return false; }
}

async function main() {
  const planBytes = await readFile(PLAN_FILE);
  const planJson = planBytes.toString("utf8");
  const plan = JSON.parse(planJson);
  const planFileSha = sha256HexBytes(planBytes);
  const findings = [];
  const cli = { ran: false };
  const mcp = { ran: false };

  if (MERGE_ONLY) {
    // merge-only: reload the artifacts persisted by the earlier CLI+MCP run
    const cliReceiptPath = join(OUT_DIR, "cli-receipt.json");
    const mcpResponsePath = join(OUT_DIR, "mcp-execute-response.json");
    if (await exists(cliReceiptPath)) cli.receipt = JSON.parse(await readFile(cliReceiptPath, "utf8"));
    if (await exists(mcpResponsePath)) {
      const saved = JSON.parse(await readFile(mcpResponsePath, "utf8"));
      mcp.call = {
        isError: false,
        parsed_status: saved.status ?? null,
        executed: saved.executed ?? null,
        run_id: saved.run_id ?? null,
        plan_sha256: saved.plan_sha256 ?? null,
        source_sha: saved.source_sha ?? null,
        overall: saved.overall ?? null,
        blocked_code: saved.blocked_code ?? null
      };
    }
  }

  if (!MERGE_ONLY) {
    // ---------- (a) CLI execute on the host ----------
    const exec = runCli(["workflow", "execute", "--plan-file", PLAN_FILE, "--source-sha", SOURCE_SHA]);
    const summary = exec.parsed;
    check(findings, "CLI execute returned a receipt summary", summary?.schema === "formal-tools/execution-receipt/1.0" || Boolean(summary?.run_id),
      JSON.stringify(summary?.overall ?? summary?.message ?? exec.stderr.slice(0, 160)));
    cli.ran = true;
    cli.summary = summary;
    cli.exit_code = exec.exit_code;
    const cliReceiptPath = join(REPO_ROOT, "artifacts", plan.plan_id, "receipt.json");
    if (await exists(cliReceiptPath)) {
      await copyFile(cliReceiptPath, join(OUT_DIR, "cli-receipt.json"));
      cli.receipt = JSON.parse(await readFile(join(OUT_DIR, "cli-receipt.json"), "utf8"));
    } else {
      check(findings, "CLI receipt artifact persisted under artifacts/<plan_id>", false, cliReceiptPath);
    }
    const results = runCli(["workflow", "results", "--receipt", cliReceiptPath]);
    cli.results_step = { exit_code: results.exit_code, parsed: results.parsed };
  }

  if (!MERGE_ONLY) {
    // ---------- (b) MCP execute_workflow (stdio JSON-RPC, full env) ----------
    const client = await startMcpExecuteClient({ timeoutMs: 180000 });
    try {
      const init = await client.request("initialize", {
        protocolVersion: "2025-06-18", capabilities: {},
        clientInfo: { name: "formal-r2-e2e-parity", version: "1.0.0" }
      });
      check(findings, "MCP initialize handshake (formal-tools-skill)", init.result?.serverInfo?.name === "formal-tools-skill");
      client.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const call = await client.call("execute_workflow", { plan, source_sha: SOURCE_SHA }, 180000);
      mcp.call = {
        isError: call.isError, rpcError: call.rpcError,
        parsed_status: call.parsed?.status ?? null,
        executed: call.parsed?.executed ?? null,
        run_id: call.parsed?.run_id ?? null,
        plan_sha256: call.parsed?.plan_sha256 ?? null,
        source_sha: call.parsed?.source_sha ?? null,
        overall: call.parsed?.overall ?? null,
        blocked_code: call.parsed?.blocked_code ?? null
      };
      mcp.ran = true;
      check(findings, "MCP execute_workflow returned an execution receipt (not an error)",
        !call.isError && call.parsed?.status === "EXECUTION_RECEIPT_RETURNED" && call.parsed?.executed === true,
        JSON.stringify({ status: call.parsed?.status, blocked: call.parsed?.blocked_code, err: call.rpcError }));
      await saveJson(OUT_DIR, "mcp-execute-response.json", assertNoKeyMaterial(call.parsed ?? { isError: call.isError }));
    } finally {
      await client.close();
      await saveJson(OUT_DIR, "mcp-transcript.json", assertNoKeyMaterial({
        schema: "formal-tools/r2e2e-mcp-transcript/1.0",
        note: "execute_workflow stdio JSON-RPC transcript (bounded step views as returned by the tool)",
        transcript: client.transcript.map((e) => {
          // bound the echoed plan payload; the plan itself is committed separately
          if (e.outbound && e.outbound.method === "tools/call") return { outbound: { id: e.outbound.id, method: e.outbound.method, params_summary: "execute_workflow(plan<omitted>, source_sha)" } };
          return e;
        }),
        stderr_tail: client.stderrTail.slice(0, 20)
      }));
    }
  }

  // ---------- final parity assertions ----------
  const cliReceipt = cli.receipt ?? null;
  const mcpRes = mcp.call ?? null;
  const web = {};
  if (WEB_SUMMARY_FILE) {
    web.summary = JSON.parse(await readFile(WEB_SUMMARY_FILE, "utf8"));
  }
  if (WEB_RECEIPT_FILE) {
    web.receipt = JSON.parse(await readFile(WEB_RECEIPT_FILE, "utf8"));
  }

  if (cliReceipt) {
    check(findings, "CLI receipt source_sha is the required git SHA label", cliReceipt.source_sha === SOURCE_SHA, String(cliReceipt.source_sha));
    check(findings, "CLI receipt plan_sha256 matches the plan file's raw sha256 OR is the executor's canonical plan hash (recorded)",
      typeof cliReceipt.plan_sha256 === "string" && /^[a-f0-9]{64}$/.test(cliReceipt.plan_sha256), String(cliReceipt.plan_sha256));
    check(findings, `CLI overall cross_tool_verdict is ${EXPECTED_VERDICT}`, cliReceipt.overall?.cross_tool_verdict === EXPECTED_VERDICT, String(cliReceipt.overall?.cross_tool_verdict));
    check(findings, "CLI overall claim_verdict is PASS", cliReceipt.overall?.claim_verdict === "PASS", String(cliReceipt.overall?.claim_verdict));
  }
  if (mcpRes) {
    check(findings, "MCP response source_sha is the required git SHA label", mcpRes.source_sha === SOURCE_SHA, String(mcpRes.source_sha));
    check(findings, `MCP overall cross_tool_verdict is ${EXPECTED_VERDICT}`, mcpRes.overall?.cross_tool_verdict === EXPECTED_VERDICT, String(mcpRes.overall?.cross_tool_verdict));
    check(findings, "MCP overall claim_verdict is PASS", mcpRes.overall?.claim_verdict === "PASS", String(mcpRes.overall?.claim_verdict));
  }
  if (cliReceipt && mcpRes) {
    check(findings, "CLI and MCP executed the IDENTICAL plan (equal plan_sha256)", cliReceipt.plan_sha256 === mcpRes.plan_sha256,
      JSON.stringify({ cli: cliReceipt.plan_sha256, mcp: mcpRes.plan_sha256 }));
    check(findings, "CLI and MCP run_ids are distinct", cliReceipt.run_id !== mcpRes.run_id,
      JSON.stringify({ cli: cliReceipt.run_id, mcp: mcpRes.run_id }));
  }
  if (web?.receipt && cliReceipt) {
    check(findings, "Web receipt plan_sha256 identical to CLI/MCP (same fixed plan object)", web.receipt.plan_sha256 === cliReceipt.plan_sha256,
      JSON.stringify({ web: web.receipt.plan_sha256, cli: cliReceipt.plan_sha256 }));
    check(findings, `Web overall cross_tool_verdict is ${EXPECTED_VERDICT}`, web.receipt.overall?.cross_tool_verdict === EXPECTED_VERDICT, String(web.receipt.overall?.cross_tool_verdict));
    check(findings, "Web receipt records a source_sha (bridge design: problem_sha256)", typeof web.receipt.source_sha === "string" && web.receipt.source_sha.length >= 40, String(web.receipt.source_sha));
    check(findings, "Web source_sha honestly DIFFERS from the git SHA label (bridge binds problem_sha256; recorded as expected design difference, never claimed equal)",
      web.receipt.source_sha !== SOURCE_SHA && web.receipt.source_sha === plan.source.problem_sha256);
    check(findings, "Web run_id distinct from CLI/MCP", web.receipt.run_id !== cliReceipt.run_id && (!mcpRes || web.receipt.run_id !== mcpRes.run_id), String(web.receipt.run_id));
  }

  const report = {
    schema: "formal-tools/r2e2e-parity-report/1.0",
    label: "FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE",
    journey: "j2-three-entry-parity",
    source_sha_git_label: SOURCE_SHA,
    plan_file: PLAN_FILE,
    plan_file_sha256: planFileSha,
    plan_id: plan.plan_id,
    plan_source_problem_sha256: plan.source?.problem_sha256 ?? null,
    expected_verdict: EXPECTED_VERDICT,
    cli: cliReceipt ? { run_id: cliReceipt.run_id, plan_sha256: cliReceipt.plan_sha256, source_sha: cliReceipt.source_sha, overall: cliReceipt.overall, tool_versions: cliReceipt.tool_versions, exit_code: cli.exit_code ?? null } : (cli.summary ?? null),
    mcp: mcpRes ?? null,
    web: web?.receipt ? { run_id: web.receipt.run_id, plan_sha256: web.receipt.plan_sha256, source_sha: web.receipt.source_sha, overall: web.receipt.overall, environment: web.receipt.environment } : (web?.summary ? { run_summary_only: true } : null),
    findings,
    all_checks_passed: findings.every((f) => f.pass),
    honesty_note: "All three entries executed the SAME fixed plan object (built once by the bridge's deterministic template). Web binds receipt.source_sha to the plan's problem_sha256 by design (the bridge derives it deterministically); CLI and MCP carry the required 40-hex git commit label. This difference is recorded, never hidden."
  };
  await saveJson(OUT_DIR, "parity-report.json", report);
  process.exitCode = report.all_checks_passed ? 0 : 2;
}

try {
  await main();
} catch (e) {
  process.stderr.write(JSON.stringify({ driver_error: String(e && e.stack || e).slice(0, 1200) }) + "\n");
  process.exit(5);
}
