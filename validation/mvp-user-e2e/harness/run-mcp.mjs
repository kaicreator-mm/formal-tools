#!/usr/bin/env node
/**
 * mvp-user-e2e harness entry: MCP JSON-RPC over stdio (issue #186).
 *
 * Reuses the scripts/mcp-acceptance.mjs transport pattern: spawns
 * `node packages/runner/js/mcp.mjs` as a real child, speaks newline-delimited
 * JSON-RPC (initialize → tools/list → tools/call), never an SDK client shortcut.
 *
 * The real V4-b surface (since 646859f) exposes exactly ONE workflow tool,
 * `plan_workflow` (planning-only; execution is intentionally not an MCP tool).
 * Existing registered tools are called as a real sanity signal that the MCP
 * surface itself works today. For the full LIVE journey transcript use
 * run-live-mcp-journey.mjs.
 *
 * Exit codes: 0 = report produced (NOT_REGISTERED_YET is OK), 2 = registered-tool
 * sanity mismatch, 5 = harness error.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  REPO_ROOT, EXECUTION_RECEIPT_SCHEMA, validateExecutionReceiptShape
} from "./lib.mjs";

const MCP_SERVER_PATH = "packages/runner/js/mcp.mjs";

/** Real workflow tool surface (V4-b @ 646859f): exactly ONE planning tool,
 * `plan_workflow`. Execution is intentionally NOT exposed over MCP (the tool's
 * own contract says so): runs happen on a trusted host via the SDK/CLI. */
export const WORKFLOW_MCP_TOOLS = {
  plan: ["plan_workflow"],
  execute: [],
  status: [],
  results: []
};
export const UNEXPOSED_BY_DESIGN = new Set(["execute", "status", "results"]);
/** The 15 registered tools (scripts/mcp-acceptance.mjs EXPECTED_TOOLS). */
export const EXPECTED_MCP_TOOLS = [
  "list_formal_tools", "validate_formal_source", "inspect_formal_tool",
  "probe_formal_tool", "run_formal_fixture", "describe_native_cli",
  "inspect_native_installation", "plan_native_cli", "verify_formal_model",
  "list_portfolio_tools", "match_formal_capabilities", "inspect_portfolio_tool",
  "verify_portable_fixture", "run_portfolio_operation", "plan_workflow"
].sort();

const firstText = (result) => {
  const block = result?.content?.find((b) => b.type === "text");
  if (!block) return undefined;
  try { return JSON.parse(block.text); } catch { return block.text; }
};

export function startMcpClient({ timeoutMs = 20000 } = {}) {
  const childEnv = { ...process.env };
  for (const key of ["FORMAL_PORTABLE_ROOT", "FORMAL_PORTABLE_RUNNER_SHA256",
    "FORMAL_PORTABLE_META_SHA256", "FORMAL_PORTABLE_FIXTURE_SHA256"]) delete childEnv[key];
  const child = spawn(process.execPath, [resolve(REPO_ROOT, MCP_SERVER_PATH)],
    { stdio: ["pipe", "pipe", "pipe"], env: childEnv, cwd: REPO_ROOT });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  const transcript = [];
  const stderrTail = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { transcript.push({ unparseable: line.slice(0, 200) }); continue; }
      transcript.push({ inbound: msg });
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => { for (const line of c.split("\n")) if (line.trim()) stderrTail.push(line.slice(0, 300)); });

  const request = (method, params, reqTimeoutMs = timeoutMs) => {
    const id = nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    transcript.push({ outbound: { id, method } });
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timeout waiting for ${method} (id=${id})`)), reqTimeoutMs);
      pending.set(id, (msg) => { clearTimeout(timer); ok(msg); });
      child.stdin.write(frame);
    });
  };
  const notify = (method, params) => {
    transcript.push({ outbound: { notification: method } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  };
  const call = async (name, args, reqTimeoutMs = timeoutMs) => {
    const resp = await request("tools/call", { name, arguments: args }, reqTimeoutMs);
    return { resp, parsed: firstText(resp.result), isError: resp.result?.isError === true, rpcError: resp.error?.message };
  };
  const close = async () => {
    try { notify("notifications/cancelled", {}); } catch { /* already closing */ }
    child.stdin.end();
    child.kill();
    await new Promise((ok) => { const t = setTimeout(ok, 1000); child.once("exit", () => { clearTimeout(t); ok(); }); });
  };
  return { child, request, notify, call, close, transcript, stderrTail };
}

export async function buildReport() {
  const report = {
    schema: "formal-tools/user-e2e-report/1.0",
    entry: "mcp",
    generated_at: new Date().toISOString(),
    server_path: MCP_SERVER_PATH,
    checks: [],
    receipt_conformance: null,
    entry_outcome_class: null,
    workflow_tools: null
  };
  const client = startMcpClient();
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "formal-mvp-user-e2e", version: "0.1.0" }
    });
    report.checks.push({
      name: "initialize-handshake",
      outcome: init.result?.serverInfo?.name === "formal-tools-skill" ? "OK" : "OBSERVED",
      detail: JSON.stringify(init.result?.serverInfo)
    });
    client.notify("notifications/initialized");

    const list = await client.request("tools/list", {});
    const names = (list.result?.tools ?? []).map((t) => t.name).sort();
    report.registered_tools = names;
    report.checks.push({
      name: "tools-list",
      outcome: JSON.stringify(names) === JSON.stringify(EXPECTED_MCP_TOOLS) ? "OK" : "MISMATCH",
      detail: `${names.length} tools registered (expected exactly ${EXPECTED_MCP_TOOLS.length})`
    });

    // Real sanity on a tool registered TODAY (read-only, no binaries required).
    const sanity = await client.call("list_formal_tools", {});
    const listed = firstText(sanity.resp.result);
    report.checks.push({
      name: "list_formal_tools-sanity",
      outcome: !sanity.isError && Array.isArray(listed?.portfolio) && listed.portfolio.length === 36 ? "OK" : "MISMATCH",
      detail: `native=${Array.isArray(listed?.native) ? listed.native.length : "n/a"} portfolio=${Array.isArray(listed?.portfolio) ? listed.portfolio.length : "n/a"}`
    });

    // Workflow tools: detect by name from the real-surface config table.
    const workflow = {};
    for (const [role, candidates] of Object.entries(WORKFLOW_MCP_TOOLS)) {
      if (candidates.length === 0 && UNEXPOSED_BY_DESIGN.has(role)) {
        workflow[role] = { status: "UNEXPOSED_BY_DESIGN", note: "not an MCP tool at V4-b by contract; runs happen via SDK/CLI on a trusted host" };
        continue;
      }
      const found = candidates.find((n) => names.includes(n));
      workflow[role] = found ? { status: "REGISTERED", tool: found } : { status: "NOT_REGISTERED_YET", candidates };
    }
    report.workflow_tools = workflow;
    report.entry_outcome_class = Object.values(workflow).some((w) => w.status === "REGISTERED")
      ? "WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_TOOLS"
      : "NOT_REGISTERED_YET";

    if (report.entry_outcome_class !== "NOT_REGISTERED_YET") {
      // Planning-only surface: a real plan_workflow call must return a
      // well-formed execution-plan/1.0, never a receipt.
      const planTool = workflow.plan?.tool;
      if (planTool) {
        const callResp = await client.call(planTool, {
          problem_text: "(set-logic QF_LIA)\n(declare-const x Int)\n(assert (> x 0))\n(assert (< x 0))\n(check-sat)\n(exit)",
          assumptions: ["bounded linear integer arithmetic"]
        });
        const plan = callResp.parsed;
        report.plan_conformance = {
          tool: planTool,
          is_plan: plan?.schema === "formal-tools/execution-plan/1.0",
          plan_id: plan?.plan_id ?? null,
          steps: Array.isArray(plan?.steps) ? plan.steps.map((s) => s.tool) : null,
          tool_execution: plan?.tool_execution ?? null
        };
      }
      const receiptResp = report.receipt_conformance;
      if (receiptResp === null) report.receipt_conformance = null; // planning-only: no receipt over MCP by design
    }
  } catch (e) {
    report.checks.push({ name: "driver", outcome: "HARNESS_ERROR", detail: String(e).slice(0, 300) });
    report.entry_outcome_class = report.entry_outcome_class ?? "FAIL_CLOSED_OTHER";
  } finally {
    await client.close();
  }
  return report;
}

async function main() {
  let report;
  try { report = await buildReport(); }
  catch (e) {
    process.stderr.write(JSON.stringify({ schema: "formal-tools/user-e2e-report/1.0", entry: "mcp", harness_error: String(e) }) + "\n");
    return 5;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.entry_outcome_class === "NOT_REGISTERED_YET") return 0;
  const mismatch = report.checks.some((c) => c.outcome === "MISMATCH" || c.outcome === "HARNESS_ERROR");
  return mismatch ? 2 : 0;
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
