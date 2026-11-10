import test from "node:test";
import assert from "node:assert/strict";
import { normalizeToolResult,failedToolLaunch } from "../packages/runner/js/tool-result.mjs";
import { listTools,toolDetails,planTool,invokeTool } from "../packages/runner/js/sdk.mjs";

const plan={tool:"z3",operation:"solve",entry:"z3",args:["-smt2","sample.smt2"],mode:"typed"};
const run={run_status:"EXECUTED",process_outcome:"EXIT_ZERO",tool_outcome:"UNSAT",executions:[{
  exit_code:0,signal:null,elapsed_ms:12,timed_out:false,output_truncated:false,error:null,
  stdout:"unsat\n",stderr:"",stdout_sha256:"a".repeat(64),stderr_sha256:"b".repeat(64)
}]};
test("tool-native status is separate from consumer business claims",()=>{
  const result=normalizeToolResult(plan,run);
  assert.equal(result.schema,"formal-tools/tool-execution/1");
  assert.equal(result.tool_status,"UNSAT");
  assert.equal(result.process.status,"EXIT_ZERO");
  assert.equal(result.streams.stdout.text,"unsat\n");
  assert.deepEqual(result.artifacts,{status:"NOT_COLLECTED",items:[]});
  assert.ok(!Object.hasOwn(result,"claim_verdict"));
  assert.ok(!Object.hasOwn(result,"test_verdict"));
});
test("timeout, no execution and output-limit cannot claim normal tool status",()=>{
  for(const status of ["NOT_STARTED","TIMEOUT","OUTPUT_LIMIT"])
    assert.equal(normalizeToolResult(plan,{...run,process_outcome:status}).tool_status,"INCONCLUSIVE");
});
test("failed native launch is a technical NOT_STARTED receipt",()=>{
  const result=failedToolLaunch(plan,new Error("missing exe"));
  assert.equal(result.process.status,"NOT_STARTED");
  assert.equal(result.process.run_status,"NOT_RUN");
  assert.equal(result.process.error,"missing exe");
});
test("SDK retains all 13 registered tool IDs and typed plan",()=>{
  assert.equal(listTools().length,13);
  assert.equal(toolDetails("z3").id,"z3");
  assert.deepEqual(planTool("z3","solve",{input:"p.smt2"}).args,["-smt2","p.smt2"]);
});
test("SDK rejects raw entry and invalid arguments before tool execution",async()=>{
  await assert.rejects(invokeTool({tool:"bash",operation:"raw",settings:{input:"x"}}));
  await assert.rejects(invokeTool({tool:"z3",operation:"raw",settings:{input:"x"}}));
  await assert.rejects(invokeTool({tool:"z3",operation:"solve",settings:{input:"a.smt2"},timeoutS:0}));
});
