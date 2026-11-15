import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const fixture = await readFile(new URL("../portable/verification/cases/storm/expect.sh", import.meta.url), "utf8");
const model = await readFile(new URL("../portable/verification/cases/storm/pos.pm", import.meta.url), "utf8");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function uniqueNumericExitAssignments(source) {
  const values = {};
  for (const phase of ["POS", "NEG", "ERR"]) {
    const matches = [...source.matchAll(new RegExp("^EXPECT_" + phase + "_EXIT=([0-9]+)[ \t]*$", "gm"))];
    assert.equal(matches.length, 1, phase + " must have exactly one numeric exit assignment");
    values[phase] = Number(matches[0][1]);
  }
  return values;
}

test("Storm current-main fixture pins exactly one numeric POS/NEG/ERR exit assignment", () => {
  assert.deepEqual(uniqueNumericExitAssignments(fixture), { POS: 0, NEG: 0, ERR: 1 });
  assert.match(fixture, /EXPECT_POS_ARGS=.*P>=0\.1/);
  assert.match(fixture, /EXPECT_NEG_ARGS=.*P<=0\.5/);
  assert.match(fixture, /EXPECT_POS_LABEL=PROPERTY_HOLDS/);
  assert.match(fixture, /EXPECT_NEG_LABEL=PROPERTY_FAILS/);
});

test("Storm exit contract rejects duplicate, wildcard, missing, and quoted assignments", () => {
  const negativeControls = [
    { label: "duplicate", source: fixture + "\nEXPECT_POS_EXIT=77\n" },
    { label: "wildcard", source: fixture.replace(/^EXPECT_NEG_EXIT=0$/m, "EXPECT_NEG_EXIT=*\n") },
    { label: "missing", source: fixture.replace(/^EXPECT_ERR_EXIT=1$/m, "") },
    { label: "quoted", source: fixture.replace(/^EXPECT_POS_EXIT=0$/m, "EXPECT_POS_EXIT='0'") }
  ];
  for (const control of negativeControls) {
    assert.throws(() => uniqueNumericExitAssignments(control.source), control.label);
  }
});

test("Storm ERR is a real deterministic missing-model-file rejection", async t => {
  assert.match(fixture, /EXPECT_ERR_VIA=run/);
  assert.match(fixture, /EXPECT_ERR_ARGS=.*missing\.pm/);
  assert.match(fixture, /EXPECT_ERR_REGEX='Unable to read from \(non-existing \)\?file'/);
  assert.match(fixture, /EXPECT_ERR_LABEL=MISSING_PRISM_FILE_REJECTED/);
  const missing = new URL("../portable/verification/cases/storm/missing.pm", import.meta.url);
  await assert.rejects(readFile(missing), { code: "ENOENT" });
});

test("Storm fixture's positive and negative claims use the same committed DTMC model", () => {
  assert.match(model, /^dtmc/m);
  assert.match(model, /label "done" = s=7;/);
  assert.match(model, /\[\] s=0 -> 0\.5 : \(s'=1\) \+ 0\.5 : \(s'=2\);/);
});

test("the actual MCP stdio server initializes, exposes Storm, and fails closed without a pinned bundle", async t => {
  const env = { ...process.env };
  delete env.FORMAL_PORTABLE_ROOT;
  delete env.FORMAL_PORTABLE_RUNNER_SHA256;
  delete env.FORMAL_PORTABLE_META_SHA256;
  delete env.FORMAL_PORTABLE_FIXTURE_SHA256;

  const child = spawn(process.execPath, ["packages/runner/js/mcp.mjs"], {
    cwd: repoRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let buffer = "";
  let stderr = "";
  const pending = new Map();
  const failPending = error => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      pending.delete(id);
    }
  };
  child.stdout.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { failPending(new Error("MCP_STDOUT_NOT_JSON_LINE: " + line)); continue; }
      const waiter = pending.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  child.once("error", error => failPending(error));
  child.once("exit", (code, signal) => {
    failPending(new Error("MCP_SERVER_EXIT:" + code + ":" + signal + ":" + stderr));
  });
  t.after(() => { if (!child.killed) child.kill("SIGTERM"); });

  const request = (id, method, params = {}) => new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("MCP_RESPONSE_TIMEOUT:" + method + ":" + stderr));
    }, 8000);
    pending.set(id, { resolve: resolveResponse, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const notify = (method, params = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  };

  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "formal-tools-storm-ci", version: "0.1.0" }
  });
  assert.equal(initialized.jsonrpc, "2.0");
  assert.equal(initialized.result?.serverInfo?.name, "formal-tools-skill");
  notify("notifications/initialized");

  const listing = await request(2, "tools/list");
  const names = new Set((listing.result?.tools ?? []).map(tool => tool.name));
  assert.ok(names.has("list_portfolio_tools"));
  assert.ok(names.has("inspect_portfolio_tool"));
  assert.ok(names.has("verify_portable_fixture"));

  const inspected = await request(3, "tools/call", {
    name: "inspect_portfolio_tool",
    arguments: { tool: "storm" }
  });
  const inspection = JSON.parse(inspected.result?.content?.[0]?.text ?? "{}");
  assert.equal(inspection.id, "storm");
  assert.equal(inspection.status, "NOT_AVAILABLE_FAIL_CLOSED");
  assert.match(inspection.reason, /PORTABLE_ROOT_NOT_CONFIGURED/);

  const attempted = await request(4, "tools/call", {
    name: "verify_portable_fixture",
    arguments: { tool: "storm", timeout_s: 10 }
  });
  assert.equal(attempted.result?.isError, true);
  const failure = JSON.parse(attempted.result?.content?.[0]?.text ?? "{}");
  assert.equal(failure.status, "NOT_RUN_FAIL_CLOSED");
  assert.match(failure.reason, /PORTABLE_ROOT_NOT_CONFIGURED/);
});
