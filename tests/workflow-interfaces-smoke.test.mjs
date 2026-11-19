import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

/**
 * Offline static parity guard for the MCP workflow interface (i180/V4a +
 * i180/V4b + i180/R2-B). Parses source — spawns no server — and asserts three
 * sources of truth name exactly the same 16 tools:
 *   1. packages/runner/js/mcp.mjs registerTool("name") calls (the real server),
 *   2. scripts/mcp-acceptance.mjs EXPECTED_TOOLS (the live stdio smoke),
 *   3. registry/INTERFACES.json mcp_tools (the interface registry).
 * This complements (never replaces) the real stdio acceptance, which exercises
 * a spawned server process over JSON-RPC in scripts/mcp-acceptance.mjs and CI.
 * V4b added exactly one planning-only tool: plan_workflow. R2-B adds exactly
 * one bounded typed execution tool: execute_workflow (real V3 executor).
 */
const read=text=>readFile(new URL(text,import.meta.url),"utf8");
const registeredTools=async()=>{
  const source=await read("../packages/runner/js/mcp.mjs");
  const names=[...source.matchAll(/registerTool\("([a-z_]+)"/g)].map(m=>m[1]);
  assert.ok(names.length,"mcp.mjs must contain registerTool declarations");
  return names;
};
const expectedTools=async()=>{
  const source=await read("../scripts/mcp-acceptance.mjs");
  const block=source.match(/const EXPECTED_TOOLS=\[([^\]]*)\]/s);
  assert.ok(block,"mcp-acceptance.mjs must declare an EXPECTED_TOOLS array");
  const names=[...block[1].matchAll(/"([a-z_]+)"/g)].map(m=>m[1]);
  assert.ok(names.length,"EXPECTED_TOOLS must be non-empty");
  return names;
};

test("i180/R2-B: mcp.mjs registers exactly 16 unique tools",async()=>{
  const names=await registeredTools();
  assert.equal(names.length,16);
  assert.equal(new Set(names).size,names.length,"registerTool names must be unique");
  assert.ok(names.includes("plan_workflow"),"V4b planning tool: plan_workflow");
  assert.ok(names.includes("execute_workflow"),"R2-B adds exactly one execution tool: execute_workflow");
});

test("i180/R2-B: acceptance EXPECTED_TOOLS equals the registered server tool set (16)",async()=>{
  const [registered,expected]=await Promise.all([registeredTools(),expectedTools()]);
  assert.equal(expected.length,16,"the live smoke must cover all 16 tools");
  assert.deepEqual([...expected].sort(),[...registered].sort());
});

test("i180/R2-B: registry/INTERFACES.json mcp_tools equals the registered server tool set",async()=>{
  const [registered,interfaces]=await Promise.all([
    registeredTools(),
    JSON.parse(await read("../registry/INTERFACES.json"))
  ]);
  assert.deepEqual([...(interfaces.mcp_tools??[])].sort(),[...registered].sort());
  assert.equal(interfaces.workflow?.mcp_tool,"plan_workflow");
  assert.equal(interfaces.workflow?.mcp_execution_tool,"execute_workflow");
  assert.match(String(interfaces.workflow?.mcp_execution??""),/EXECUTES_ON_TRUSTED_HOST/);
});
