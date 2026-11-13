import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {toolIds,describeNativeTool,planNative} from "../packages/runner/js/native-catalog.mjs";
import {listTools,toolDetails,planTool,invokeTool,invokeStagedTool} from "../packages/runner/js/sdk.mjs";
import {normalizeToolResult} from "../packages/runner/js/tool-result.mjs";

test("D08: SDK and CLI catalog share exactly 13 tools and 53 typed operations",()=>{
  assert.deepEqual(listTools(),[...toolIds]);
  let count=0;
  for(const tool of toolIds){
    const source=describeNativeTool(tool),publicInfo=toolDetails(tool);
    const ops=Object.entries(source.operations);
    assert.equal(publicInfo.id,tool);
    assert.equal(publicInfo.operationCount,ops.length);
    assert.deepEqual(publicInfo.entries,source.entries);
    for(const [operation,definition] of ops){
      const settings=Object.fromEntries(definition.required.map(name=>[name,"input.dat"]));
      assert.deepEqual(planTool(tool,operation,settings),planNative(tool,operation,settings));
      count++;
    }
  }
  assert.equal(count,53);
});
test("D08: no native shell entry can masquerade as a registered SDK tool",async()=>{
  assert.throws(()=>planTool("bash","raw",{input:"x"}),/unknown tool/);
  assert.throws(()=>planTool("z3","raw",{input:"x"}),/unknown operation/);
  await assert.rejects(invokeTool({tool:"bash",operation:"solve",settings:{input:"x"}}),/unknown tool/);
  await assert.rejects(invokeTool({tool:"z3",operation:"raw",settings:{input:"x"}}),/unknown operation/);
  await assert.rejects(invokeStagedTool({
    tool:"bash",operation:"solve",sourceRoot:".",inputs:["x"],settings:{input:"x"}
  }),/unknown tool/);
  await assert.rejects(invokeStagedTool({
    tool:"z3",operation:"solve",sourceRoot:".",inputs:["../other"],settings:{input:"../other"}
  }),/invalid source-relative/);
});
test("D08: MCP exposes 12 allowlisted tools but never unrestricted native shell",async()=>{
  const source=await readFile(new URL("../packages/runner/js/mcp.mjs",import.meta.url),"utf8");
  const names=[...source.matchAll(/registerTool\("([a-z_]+)"/g)].map(match=>match[1]);
  assert.equal(names.length,12);
  assert.equal(new Set(names).size,names.length);
  assert.deepEqual(names.sort(),[
    "list_formal_tools","validate_formal_source","inspect_formal_tool",
    "probe_formal_tool","run_formal_fixture","describe_native_cli",
    "inspect_native_installation","plan_native_cli","verify_formal_model",
    "list_portfolio_tools","inspect_portfolio_tool","verify_portable_fixture"
  ].sort());
  assert.doesNotMatch(source,/planRawNative|executeNativePlan|invokeStagedTool|child_process/);
  assert.match(source,/toolIds\.includes\(value\)/);
});
test("D08: process success is distinct from proof or consumer claim acceptance",()=>{
  const plan=planNative("z3","solve",{input:"input.smt2"});
  const receipt=normalizeToolResult(plan,{
    run_status:"EXECUTED",process_outcome:"EXIT_ZERO",tool_outcome:"UNKNOWN",
    executions:[{exit_code:0,elapsed_ms:2,stdout:"unknown\n",stderr:""}]
  });
  assert.equal(receipt.process.status,"EXIT_ZERO");
  assert.equal(receipt.tool_status,"UNKNOWN");
  assert.equal(receipt.artifacts.status,"NOT_COLLECTED");
  assert.ok(!Object.hasOwn(receipt,"claim_verdict"));
  assert.ok(!Object.hasOwn(receipt,"simulation_outcome"));
});
