import test from "node:test";
import assert from "node:assert/strict";
import { knownTools, validateSource, inspectTool, interpret } from "../packages/runner/js/native.mjs";

test("13 allowlisted engines",()=>assert.equal(knownTools().length,13));
test("registry and all versioned fixtures present",async()=>{
  const result=await validateSource();
  assert.equal(result.status,"STATIC_PASS",JSON.stringify(result));
  assert.equal(result.native_runtime,"NOT_RUN");
});
test("unknown native tool rejected",async()=>await assert.rejects(inspectTool("../etc/passwd")));
test("Z3 returns only scoped fixture verdicts",()=>{
  const steps=[{stdout:"unsat\n",stderr:"",exit_code:0,timed_out:false}];
  assert.deepEqual(interpret("z3","positive",steps),{tool_outcome:"UNSAT",test_verdict:"PASS"});
  const bad=[{...steps[0],stdout:"sat\n"}];
  assert.equal(interpret("z3","positive",bad).test_verdict,"INCONCLUSIVE");
});
test("Clingo unexpected exit fails closed",()=>{
  const step=[{stdout:"SATISFIABLE\nAnswer: 1\n",stderr:"",exit_code:1,timed_out:false}];
  assert.equal(interpret("clingo","positive",step).test_verdict,"INCONCLUSIVE");
});

test("Clingo exhaustive two-model SAT exit 30 is an expected technical fixture result",()=>{
  const sat=[{stdout:"Answer: 1\nchoose(a)\nAnswer: 2\nchoose(b)\nSATISFIABLE\n",stderr:"",exit_code:30,timed_out:false}];
  assert.deepEqual(interpret("clingo","positive",sat),{tool_outcome:"SATISFIABLE",test_verdict:"PASS"});
  assert.equal(interpret("clingo","positive",[{...sat[0],exit_code:65}]).test_verdict,"INCONCLUSIVE");
  assert.equal(interpret("clingo","positive",[{...sat[0],stdout:"Answer: 1\nchoose(a)\nSATISFIABLE\n"}]).test_verdict,"INCONCLUSIVE");
  assert.deepEqual(interpret("clingo","negative",[{stdout:"UNSATISFIABLE\n",stderr:"",exit_code:20}]),
    {tool_outcome:"UNSATISFIABLE",test_verdict:"PASS"});
});

test("Alloy and ProB are not trusted without real output parser receipts",()=>{
  const steps=[{stdout:"success",stderr:"",exit_code:0,timed_out:false}];
  for(const tool of ["alloy","prob"])assert.equal(interpret(tool,"positive",steps).test_verdict,"INCONCLUSIVE");
});
