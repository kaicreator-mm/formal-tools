#!/usr/bin/env node
/**
 * I4 R0 MCP stdio gate driver (engine-provisioned Linux host).
 * Real JSON-RPC over stdio against packages/runner/js/mcp.mjs (official SDK v2).
 * Proves: handshake, tools/list, installed-engine probe, installed fixture run,
 * pure-JS engine call, and fail-closed denial semantics (no raw shell tool,
 * unknown operation rejected, raw argv never reachable from MCP).
 * Usage: node mcp-driver.mjs <out-dir>
 */
import { spawn } from "node:child_process";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = resolve(process.argv[2] ?? "validation/local-runtime-receipts/i4-r0/mcp-receipts");
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
    clientInfo: { name: "i4-r0-mcp-gate-driver", version: "1.0.0" }
  });
  assert(res.result && res.result.serverInfo, "no serverInfo in initialize result: " + JSON.stringify(res).slice(0, 200));
  serverInfo = res.result.serverInfo;
  protocolVersion = res.result.protocolVersion;
  notify("notifications/initialized");
  return { serverInfo, protocolVersion };
});

let toolNames = [];
await check("mcp-tools-list-nine-registered", async () => {
  const res = await request("tools/list", {});
  toolNames = (res.result.tools ?? []).map(t => t.name).sort();
  const expected = ["describe_native_cli", "inspect_formal_tool", "inspect_native_installation",
    "list_formal_tools", "plan_native_cli", "probe_formal_tool", "run_formal_fixture",
    "validate_formal_source", "verify_formal_model"].sort();
  assert(JSON.stringify(toolNames) === JSON.stringify(expected),
    "tool list mismatch: " + JSON.stringify(toolNames));
  for (const t of res.result.tools) {
    // No raw command-runner surface: the tool set is the fixed registered list
    // (asserted above) and no tool schema exposes raw argv/shell parameters.
    assert(t.inputSchema, "tool without input schema: " + t.name);
    const propNames = Object.keys(t.inputSchema?.properties ?? {});
    assert(!propNames.some(p => /^(argv|command|cmd|shell|args)$/.test(p)),
      "raw passthrough parameter exposed by tool: " + t.name + " prop " + propNames.join(","));
  }
  return { count: toolNames.length, tools: toolNames };
});

await check("mcp-list-formal-tools", async () => {
  const res = await request("tools/call", { name: "list_formal_tools", arguments: {} });
  assert(res.result && !res.result.isError, "list_formal_tools errored");
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.native.length === 13 && parsed.pure.length === 4, "catalog counts wrong: " + JSON.stringify(parsed));
  return { native: parsed.native.length, pure: parsed.pure.length };
});

await check("mcp-probe-installed-z3", async () => {
  const res = await request("tools/call", { name: "probe_formal_tool", arguments: { tool: "z3", timeout_s: 20 } });
  assert(res.result && !res.result.isError, "probe_formal_tool errored: " + JSON.stringify(res.result).slice(0, 200));
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.run_status === "EXECUTED", "z3 probe not EXECUTED: " + JSON.stringify(parsed).slice(0, 300));
  assert(/Z3 version|5\./.test(parsed.stdout), "unexpected z3 probe output: " + parsed.stdout.slice(0, 120));
  return { exit_code: parsed.exit_code, stdout_head: parsed.stdout.slice(0, 80) };
});

await check("mcp-run-installed-fixture-z3-positive", async () => {
  const res = await request("tools/call", { name: "run_formal_fixture", arguments: { tool: "z3", case: "positive", timeout_s: 45 } });
  assert(res.result && !res.result.isError, "run_formal_fixture errored");
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.test_verdict === "PASS", "z3 positive fixture not PASS: " + JSON.stringify(parsed).slice(0, 300));
  assert(parsed.tool_outcome === "UNSAT", "expected UNSAT: " + parsed.tool_outcome);
  assert(parsed.input_sha256 && Object.keys(parsed.input_sha256).length >= 1, "fixture input hashes missing");
  return { tool_outcome: parsed.tool_outcome, test_verdict: parsed.test_verdict, inputs: Object.keys(parsed.input_sha256) };
});

await check("mcp-plan-native-cli-valid-and-invalid", async () => {
  const good = await request("tools/call", { name: "plan_native_cli", arguments: { tool: "z3", operation: "solve", settings: { input: "x.smt2", timeout: 5 } } });
  assert(good.result && !good.result.isError, "valid plan rejected");
  const plan = JSON.parse(good.result.content[0].text);
  assert(plan.mode === "typed" && plan.entry === "z3", "plan shape wrong: " + JSON.stringify(plan));
  const bad = await request("tools/call", { name: "plan_native_cli", arguments: { tool: "z3", operation: "no_such_operation", settings: {} } });
  assert(bad.result?.isError === true, "unknown operation must be an MCP error result");
  const badEnum = await request("tools/call", { name: "plan_native_cli", arguments: { tool: "vampire", operation: "prove", settings: { mode: "shell" } } });
  assert(badEnum.result?.isError === true, "invalid enum value must be an MCP error result");
  return { valid_plan_argv_head: plan.args[0], invalid_denied: true, enum_denied: true };
});

await check("mcp-verify-pure-engine", async () => {
  const model = JSON.parse(await readFile(join(REPO, "validation", "js", "dag-positive.json"), "utf8"));
  const res = await request("tools/call", { name: "verify_formal_model", arguments: { engine: "dag", model } });
  assert(res.result && !res.result.isError, "verify_formal_model errored: " + JSON.stringify(res.result).slice(0, 200));
  const parsed = JSON.parse(res.result.content[0].text);
  assert(parsed.test_verdict === "PASS", "pure dag not PASS: " + JSON.stringify(parsed).slice(0, 200));
  return { tool_outcome: parsed.tool_outcome, test_verdict: parsed.test_verdict };
});

await check("mcp-unknown-tool-id-denied", async () => {
  const res = await request("tools/call", { name: "probe_formal_tool", arguments: { tool: "nuxmv", timeout_s: 5 } });
  assert(res.result?.isError === true, "unknown tool id must fail closed");
  return { denied: true };
});

// Graceful shutdown: close stdio, wait for the server to exit.
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
