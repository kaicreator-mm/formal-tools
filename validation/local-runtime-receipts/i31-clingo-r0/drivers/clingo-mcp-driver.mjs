#!/usr/bin/env node
/**
 * I31 Clingo-only MCP stdio gate driver (canonical Debian 13 container, PR #76).
 * Real JSON-RPC over stdio against packages/runner/js/mcp.mjs (official SDK v2),
 * at the current exact checkout SHA, with the pinned official native clingo.
 * Proves: handshake (protocol 2025-06-18, server 0.4.0), the current 12-tool
 * fixed registry (9 original + 3 portfolio; no raw argv/shell surface), clingo
 * probe/fixture/plan semantics through MCP, and fail-closed denials.
 * Usage: node clingo-mcp-driver.mjs <out-dir>
 */
import { spawn } from "node:child_process";
import { mkdir, appendFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = resolve(process.argv[2] ?? "validation/local-runtime-receipts/i31-clingo-r0/mcp");
await mkdir(OUT, { recursive: true });
const log = [];
async function record(event) {
  log.push(event);
  await appendFile(join(OUT, "mcp-events.ndjson"), JSON.stringify(event) + "\n");
}
const assert = (cond, message) => { if (!cond) throw new Error(message); };
async function check(name, fn) {
  const started = new Date().toISOString();
  try {
    const detail = await fn();
    await record({ event: "check", name, verdict: "PASS", started, detail: detail ?? null });
    process.stdout.write(JSON.stringify({ name, verdict: "PASS" }) + "\n");
  } catch (e) {
    await record({ event: "check", name, verdict: "FAIL", started, error: String(e && e.message || e) });
    process.stdout.write(JSON.stringify({ name, verdict: "FAIL", error: String(e && e.message || e) }) + "\n");
    process.exitCode = 1;
  }
}

const child = spawn(process.execPath, [join(REPO, "packages", "runner", "js", "mcp.mjs")], {
  cwd: REPO, stdio: ["pipe", "pipe", "pipe"], env: process.env
});
const pending = new Map();
let buffer = "";
let nextId = 1;
child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const idx = buffer.indexOf("\n");
    if (idx < 0) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { record({ event: "unparsable_line", line: line.slice(0, 200) }); continue; }
    if (msg.id && pending.has(msg.id)) { const { resolve: done } = pending.get(msg.id); pending.delete(msg.id); done(msg); }
    else record({ event: "server_notification", notification: msg });
  }
});
const stderrTail = [];
child.stderr.setEncoding("utf8");
child.stderr.on("data", c => { stderrTail.push(c); if (stderrTail.length > 20) stderrTail.shift(); });
const exitInfo = { code: null, signal: null };
child.on("close", (code, signal) => { exitInfo.code = code; exitInfo.signal = signal; });

function request(method, params, timeoutMs = 60000) {
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) pending.delete(id);
      rej(new Error(`timeout waiting for ${method} (exit=${JSON.stringify(exitInfo)}) stderr_tail=${JSON.stringify(stderrTail.join("").slice(-400))}`));
    }, timeoutMs);
    pending.set(id, { resolve: m => { clearTimeout(timer); res(m); } });
    child.stdin.write(payload);
    record({ event: "request", id, method, params });
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  record({ event: "notification", method, params });
}

// -- handshake ----------------------------------------------------------------
let serverInfo = null, protocolVersion = null;
await check("mcp-initialize-handshake", async () => {
  const res = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "i31-clingo-mcp-gate-driver", version: "1.0.0" }
  });
  assert(res.result && res.result.serverInfo, "no serverInfo in initialize result: " + JSON.stringify(res).slice(0, 200));
  serverInfo = res.result.serverInfo;
  protocolVersion = res.result.protocolVersion;
  assert(serverInfo.version === "0.4.0", "unexpected server version: " + serverInfo.version);
  notify("notifications/initialized");
  return { serverInfo, protocolVersion };
});

// -- tool registry: current 12-tool fixed set, no raw shell surface -----------
let toolNames = [];
await check("mcp-tools-list-twelve-registered-no-raw-surface", async () => {
  const res = await request("tools/list", {});
  toolNames = (res.result.tools ?? []).map(t => t.name).sort();
  const expected = ["describe_native_cli", "inspect_formal_tool", "inspect_native_installation",
    "list_formal_tools", "list_portfolio_tools", "inspect_portfolio_tool", "verify_portable_fixture",
    "plan_native_cli", "probe_formal_tool", "run_formal_fixture",
    "validate_formal_source", "verify_formal_model"].sort();
  assert(JSON.stringify(toolNames) === JSON.stringify(expected),
    "tool list mismatch: " + JSON.stringify(toolNames));
  for (const t of res.result.tools) {
    assert(t.inputSchema, "tool without input schema: " + t.name);
    const propNames = Object.keys(t.inputSchema?.properties ?? {});
    assert(!propNames.some(p => /^(argv|command|cmd|shell|args)$/.test(p)),
      "raw passthrough parameter exposed by tool: " + t.name + " prop " + propNames.join(","));
  }
  return { count: toolNames.length, tools: toolNames };
});

await check("mcp-list-formal-tools-catalog", async () => {
  const res = await request("tools/call", { name: "list_formal_tools", arguments: {} });
  assert(res.result && !res.result.isError, "list_formal_tools errored");
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.native.length === 13 && parsed.pure.length === 4, "catalog counts wrong: " + JSON.stringify(parsed));
  return { native: parsed.native.length, pure: parsed.pure.length };
});

// -- clingo through MCP: pinned binary probe ----------------------------------
await check("mcp-probe-installed-clingo-pinned", async () => {
  const res = await request("tools/call", { name: "probe_formal_tool", arguments: { tool: "clingo", timeout_s: 20 } });
  assert(res.result && !res.result.isError, "probe_formal_tool errored: " + JSON.stringify(res.result).slice(0, 200));
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.run_status === "EXECUTED", "clingo probe not EXECUTED: " + JSON.stringify(parsed).slice(0, 300));
  assert(/clingo version 5\.8\.3/.test(parsed.stdout), "unexpected clingo probe output: " + parsed.stdout.slice(0, 120));
  return { exit_code: parsed.exit_code, stdout_head: parsed.stdout.slice(0, 60) };
});

// -- clingo committed fixtures through MCP ------------------------------------
await check("mcp-run-clingo-positive-satisfiable", async () => {
  const res = await request("tools/call", { name: "run_formal_fixture", arguments: { tool: "clingo", case: "positive", timeout_s: 45 } });
  assert(res.result && !res.result.isError, "run_formal_fixture errored");
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.test_verdict === "PASS", "clingo positive fixture not PASS: " + JSON.stringify(parsed).slice(0, 300));
  assert(parsed.tool_outcome === "SATISFIABLE", "expected SATISFIABLE, got " + parsed.tool_outcome);
  assert(parsed.input_sha256 && Object.keys(parsed.input_sha256).length >= 1, "fixture input hashes missing");
  return { tool_outcome: parsed.tool_outcome, test_verdict: parsed.test_verdict, inputs: Object.keys(parsed.input_sha256) };
});
await check("mcp-run-clingo-negative-unsat", async () => {
  const res = await request("tools/call", { name: "run_formal_fixture", arguments: { tool: "clingo", case: "negative", timeout_s: 45 } });
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.test_verdict === "PASS", "clingo negative fixture not PASS: " + JSON.stringify(parsed).slice(0, 300));
  assert(parsed.tool_outcome === "UNSATISFIABLE", "expected UNSATISFIABLE, got " + parsed.tool_outcome);
  return { tool_outcome: parsed.tool_outcome, test_verdict: parsed.test_verdict };
});

// -- plan semantics: valid clingo plan + typed denials ------------------------
await check("mcp-plan-native-cli-clingo-valid-and-invalid", async () => {
  const good = await request("tools/call", { name: "plan_native_cli", arguments: { tool: "clingo", operation: "solve", settings: { input: "x.lp", models: 0 } } });
  assert(good.result && !good.result.isError, "valid clingo plan rejected: " + JSON.stringify(good.result).slice(0, 200));
  const plan = JSON.parse(good.result.content[0].text);
  assert(plan.mode === "typed" && plan.entry === "clingo", "plan shape wrong: " + JSON.stringify(plan));
  assert.deepEqual(plan.args, ["--models=0", "x.lp"], "clingo solve argv wrong: " + JSON.stringify(plan.args));
  const badOp = await request("tools/call", { name: "plan_native_cli", arguments: { tool: "clingo", operation: "no_such_operation", settings: {} } });
  assert(badOp.result?.isError === true, "unknown operation must be an MCP error result");
  const badEnum = await request("tools/call", { name: "plan_native_cli", arguments: { tool: "clingo", operation: "solve", settings: { input: "x.lp", opt: "shell" } } });
  assert(badEnum.result?.isError === true, "invalid enum value must be an MCP error result");
  return { valid_plan_args: plan.args, op_denied: true, enum_denied: true };
});

// -- read-only installation inspection: pinned launcher visible, no execution --
await check("mcp-inspect-native-installation-clingo-pinned", async () => {
  const res = await request("tools/call", { name: "inspect_native_installation", arguments: { tool: "clingo" } });
  assert(res.result && !res.result.isError, "inspect_native_installation errored");
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.launcher === "clingo-bin", "expected clingo-bin launcher: " + JSON.stringify(parsed).slice(0, 200));
  assert(parsed.status === "FOUND_NOT_PROBED", "static inspection must not claim probe: " + parsed.status);
  assert(parsed.probe_status === "NOT_RUN", "probe_status must be NOT_RUN");
  return { launcher: parsed.launcher, status: parsed.status };
});

// -- fail-closed: unknown tool id denied --------------------------------------
await check("mcp-unknown-tool-id-denied", async () => {
  const res = await request("tools/call", { name: "probe_formal_tool", arguments: { tool: "no_such_engine", timeout_s: 5 } });
  assert(res.result?.isError === true, "unknown tool id must fail closed");
  return { denied: true };
});

// Graceful shutdown.
child.stdin.end();
const exited = await new Promise(res => {
  const timer = setTimeout(() => res(false), 10000);
  child.on("close", () => { clearTimeout(timer); res(true); });
});
await record({ event: "server_shutdown", exit: exitInfo, graceful: exited });
assert(exited, "mcp server did not exit after stdio close");
assert(exitInfo.code === 0, "mcp server exited nonzero: " + JSON.stringify(exitInfo));
await record({ event: "driver_done", out: OUT, serverInfo, protocolVersion });
process.stdout.write(JSON.stringify({ driver: "mcp", serverInfo, protocolVersion, exit: exitInfo }) + "\n");
