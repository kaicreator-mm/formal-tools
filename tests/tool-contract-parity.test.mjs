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
test("D08: MCP exposes 16 allowlisted tools but never unrestricted native shell",async()=>{
  const source=await readFile(new URL("../packages/runner/js/mcp.mjs",import.meta.url),"utf8");
  const names=[...source.matchAll(/registerTool\("([a-z_]+)"/g)].map(match=>match[1]);
  assert.equal(names.length,16);
  assert.equal(new Set(names).size,names.length);
  assert.deepEqual(names.sort(),[
    "list_formal_tools","validate_formal_source","inspect_formal_tool",
    "probe_formal_tool","run_formal_fixture","describe_native_cli",
    "inspect_native_installation","plan_native_cli","verify_formal_model",
    "list_portfolio_tools","match_formal_capabilities","inspect_portfolio_tool","verify_portable_fixture","run_portfolio_operation",
    "plan_workflow","execute_workflow"
  ].sort());
  assert.doesNotMatch(source,/planRawNative|executeNativePlan|invokeStagedTool|child_process/);
  assert.match(source,/receipt\.status!==\"FIXTURE_TECHNICAL_PASS_UNREVIEWED\"/);
  assert.match(source,/toolIds\.includes\(value\)/);
  assert.match(source,/tool:z\.literal\("highs"\)/);
  assert.match(source,/operation:z\.literal\("solve-lp"\)/);
  assert.match(source,/inputSchema:z\.object\([\s\S]*?\)\.strict\(\)/);
  // i180/V4b: plan_workflow is bounded, planning-only, and never executes.
  assert.match(source,/registerTool\("plan_workflow"/);
  assert.match(source,/problem_text:z\.string\(\)\.min\(1\)\.max\(65536\)/);
  assert.match(source,/provider:z\.enum\(\["deepseek"\]\)\.optional\(\)/);
  assert.match(source,/tool_execution:"NOT_RUN"/);
  assert.match(source,/PLANNING ONLY/);
  // i180/R2-B: execute_workflow is the ONE bounded typed execution lane: it
  // delegates to the real V3 executor, requires a labeled source_sha, bounds
  // the plan transport, and never takes argv/shell/file-path inputs.
  assert.match(source,/registerTool\("execute_workflow"/);
  assert.match(source,/executeWorkflowPlan\(plan,\{sourceSha:source_sha,env:process\.env\}\)/);
  assert.match(source,/source_sha:z\.string\(\)\.regex\(\/\^\[a-f0-9\]\{40\}\$\/,"must be a 40-hex git commit SHA"\)/);
  assert.match(source,/plan:executePlanSchema/);
  assert.match(source,/EXECUTE_MAX_PLAN_BYTES = 65536/);
  assert.match(source,/validateExecutionPlan\(plan\)/);
  assert.match(source,/budget_caps may only tighten, never extend/);
  assert.match(source,/FAIL_CLOSED_RECEIPT_RETURNED/);
  assert.match(source,/BLOCKED_TOOL_MISSING/);
  assert.match(source,/claim_verdict BLOCKED, fail_closed_reason BLOCKED_TOOL_MISSING/);
});
test("D08: sdk.d.mts type declarations cover every sdk.mjs named export",async()=>{
  const src=await readFile(new URL("../packages/runner/js/sdk.mjs",import.meta.url),"utf8");
  const dts=await readFile(new URL("../packages/runner/js/sdk.d.mts",import.meta.url),"utf8");
  const names=new Set();
  for(const m of src.matchAll(/export(?:\s+async)?\s+function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for(const m of src.matchAll(/export\s*\{([^}]*)\}/g))
    for(const part of m[1].split(",").map(s=>s.trim()).filter(Boolean))
      names.add(part.includes(" as ")?part.split(/\s+as\s+/).pop():part);
  // 7 tool-management + 7 portfolio T4 + 3 capability-validation + 3 workflow
  // functions (planWorkflow / compileWorkflowPlan / executeWorkflowPlan)
  // + 3 workflow error classes (WorkflowError / WorkflowPlanError / WorkflowBlockedError).
  assert.equal(names.size,23,"sdk.mjs export face changed; update sdk.d.mts and this pin");
  for(const name of names)
    assert.match(dts,new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function|class)\\s+${name}\\b`),
      "sdk.d.mts must declare "+name);
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
