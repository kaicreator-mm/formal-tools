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
test("Clingo all-model enumeration exit 30 passes only with SATISFIABLE and two models",()=>{
  const sat=(exit)=>[{stdout:"Answer: 1\nchoose(a)\nAnswer: 2\nchoose(b)\nSATISFIABLE\n",stderr:"",exit_code:exit,timed_out:false}];
  // The pinned official 5.8.3 native binary exits 30 when the committed fixture
  // command enumerates all models ("0"); single-model runs and the Python
  // module exit 10. Both accepted only with exactly two enumerated answers.
  assert.equal(interpret("clingo","positive",sat(30)).test_verdict,"PASS");
  assert.equal(interpret("clingo","positive",sat(10)).test_verdict,"PASS");
  const oneModel=[{stdout:"Answer: 1\nchoose(b)\nSATISFIABLE\n",stderr:"",exit_code:30,timed_out:false}];
  assert.equal(interpret("clingo","positive",oneModel).test_verdict,"INCONCLUSIVE");
  const unknownExit=[{stdout:"UNKNOWN\n",stderr:"",exit_code:30,timed_out:false}];
  assert.equal(interpret("clingo","positive",unknownExit).test_verdict,"INCONCLUSIVE");
  const unsat=[{stdout:"UNSATISFIABLE\n",stderr:"",exit_code:20,timed_out:false}];
  assert.equal(interpret("clingo","negative",unsat).test_verdict,"PASS");
  const unsatWrongExit=[{stdout:"UNSATISFIABLE\n",stderr:"",exit_code:30,timed_out:false}];
  assert.equal(interpret("clingo","negative",unsatWrongExit).test_verdict,"INCONCLUSIVE");
});
test("Alloy and ProB are not trusted without real output parser receipts",()=>{
  const steps=[{stdout:"success",stderr:"",exit_code:0,timed_out:false}];
  for(const tool of ["alloy","prob"])assert.equal(interpret(tool,"positive",steps).test_verdict,"INCONCLUSIVE");
});
