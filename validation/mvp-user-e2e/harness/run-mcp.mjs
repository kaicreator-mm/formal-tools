#!/usr/bin/env node
/**
 * mvp-user-e2e harness entry: MCP JSON-RPC over stdio (issue #186).
 *
 * Reuses the scripts/mcp-acceptance.mjs transport pattern: spawns
 * `node packages/runner/js/mcp.mjs` as a real child, speaks newline-delimited
 * JSON-RPC (initialize → tools/list → tools/call), never an SDK client shortcut.
 *
 * Workflow tool names are a config table (best guess until V4-b ships). When the
 * registered tool list does not contain them the report says NOT_REGISTERED_YET —
 * honest progress, not a failure. Existing registered tools are called as a real
 * sanity signal that the MCP surface itself works today.
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

/** Config table: intended workflow tools (V4-b). Update names here when V4-b lands. */
export const WORKFLOW_MCP_TOOLS = {
  plan: ["plan_workflow", "workflow_plan", "plan_method_dag"],
  execute: ["execute_workflow", "workflow_execute", "run_workflow"],
  status: ["workflow_status", "get_workflow_status"],
  results: ["workflow_results", "get_workflow_results"]
};

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
      outcome: names.length >= 13 ? "OK" : "OBSERVED",
      detail: `${names.length} tools registered`
    });

    // Real sanity on a tool registered TODAY (read-only, no binaries required).
    const sanity = await client.call("list_formal_tools", {});
    const listed = firstText(sanity.resp.result);
    report.checks.push({
      name: "list_formal_tools-sanity",
      outcome: !sanity.isError && Array.isArray(listed?.portfolio) && listed.portfolio.length === 36 ? "OK" : "MISMATCH",
      detail: `native=${Array.isArray(listed?.native) ? listed.native.length : "n/a"} portfolio=${Array.isArray(listed?.portfolio) ? listed.portfolio.length : "n/a"}`
    });

    // Workflow tools: detect by name from the config table.
    const workflow = {};
    for (const [role, candidates] of Object.entries(WORKFLOW_MCP_TOOLS)) {
      const found = candidates.find((n) => names.includes(n));
      workflow[role] = found ? { status: "REGISTERED", tool: found } : { status: "NOT_REGISTERED_YET", candidates };
    }
    report.workflow_tools = workflow;
    report.entry_outcome_class = Object.values(workflow).some((w) => w.status === "REGISTERED")
      ? "WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_TOOLS"
      : "NOT_REGISTERED_YET";

    if (report.entry_outcome_class !== "NOT_REGISTERED_YET") {
      for (const w of Object.values(report.workflow_tools)) {
        if (w.status !== "REGISTERED") continue;
        const callResp = await client.call(w.tool, {});
        if (callResp.parsed?.schema === EXECUTION_RECEIPT_SCHEMA) {
          const conf = validateExecutionReceiptShape(callResp.parsed);
          report.receipt_conformance = { tool: w.tool, ok: conf.ok, errors: conf.errors };
        }
      }
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
