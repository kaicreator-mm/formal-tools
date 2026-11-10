import test from "node:test";
import assert from "node:assert/strict";
import {
  validateProblemSpec, assessMethod, proposeMethod
} from "../packages/runner/js/method-planner.mjs";

function fixture() {
  const problem={
    schema:"formal-tools/problem-spec/0.1",
    problem_id:"ads.graph.r0",
    source_refs:[{id:"requirements",sha256:"a".repeat(64),classification:"PUBLIC",
      purpose:"frozen synthetic requirements",consumer:"formal_tools"}],
    requirements:[{id:"r1",source_ref:"requirements",
      text:"A valid graph must not contain resource writer overlaps."}],
    claims:[{id:"claim1",text:"Same-resource writers never overlap.",kind:"bounded_model",
      requirement_ids:["r1"],source_refs:["requirements"],capability_ids:["logic.smt"]}],
    oracles:[{id:"heldout",source_ref:"requirements",frozen:true,
      positive_case_ids:["positive_case"],negative_case_ids:["negative_case"],review_identity:"independent_reviewer"}],
    capability_ids:["logic.smt"],
    budget:{max_steps:3,max_depth:3,max_cost_units:10,max_total_time_ms:10000,max_retries:0},
    policy:{allowed_tools:["z3"],allowed_operations:{z3:["solve"]},
      destination:"LOCAL",max_input_classification:"PUBLIC",allow_network:false}
  };
  const method={
    schema:"formal-tools/method-proposal/0.1",method_id:"method01",problem_id:"ads.graph.r0",
    goal_claim_ids:["claim1"],oracle_ids:["heldout"],semantic_review:"PENDING",
    steps:[{id:"step01",tool_id:"z3",operation:"solve",provides:["logic.smt"],
      depends_on:[],source_refs:["requirements"],
      estimated_cost_units:2,timeout_ms:300,destination:"LOCAL",output_classification:"PUBLIC"}]
  };
  return {problem,method};
}
const copy=structuredClone;

test("G2: checkable ProblemSpec is accepted; Method is only a static plan",()=>{
 const {problem,method}=fixture();
 assert.equal(validateProblemSpec(problem).ok,true);
 const result=assessMethod(problem,method);
 assert.equal(result.status,"STRUCTURALLY_VALID",JSON.stringify(result.issues));
 assert.equal(result.tool_execution,"NOT_RUN");
 assert.equal(result.executable,false);
 assert.equal(result.semantic_fidelity,"NOT_EVALUATED");
 assert.equal(result.independent_oracle_review,"NOT_RUN");
 assert.equal(result.solution_promotable,false);
 assert.match(result.method_sha256,/^[a-f0-9]{64}$/);
});
test("G2: deterministic hash across object property ordering",()=>{
 const {problem,method}=fixture();
 const same=copy(method);
 same.steps[0]={output_classification:"PUBLIC",timeout_ms:300,source_refs:["requirements"],provides:["logic.smt"],
  estimated_cost_units:2,id:"step01",depends_on:[],operation:"solve",tool_id:"z3",destination:"LOCAL"};
 assert.equal(assessMethod(problem,method).method_sha256,assessMethod(problem,same).method_sha256);
});
test("G2: only existing native typed operation may appear in a plan",()=>{
 const {problem,method}=fixture();
 const invalid=copy(method);
 invalid.steps[0].operation="raw";
 assert.match(assessMethod(problem,invalid).issues.join(" "),/unsupported native typed/);
 const forged=copy(method);
 forged.steps[0].tool_id="arbitrary-shell";
 assert.match(assessMethod(problem,forged).issues.join(" "),/unregistered tool/);
 const notAllowed=copy(method);
 notAllowed.steps[0].operation="dimacs";
 assert.match(assessMethod(problem,notAllowed).issues.join(" "),/typed operation not permitted/);
});
test("G2: candidate tool is discoverable but cannot claim executable adapter",()=>{
 const {problem,method}=fixture();
 problem.capability_ids=["graph.algorithms"];
 problem.claims[0].capability_ids=["graph.algorithms"];
 problem.policy.allowed_tools=["networkx"];
 problem.policy.allowed_operations={};
 method.steps[0].provides=["graph.algorithms"];
 method.steps[0].tool_id="networkx";
 method.steps[0].operation="UNRESOLVED";
 const result=assessMethod(problem,method);
 assert.equal(result.status,"STRUCTURALLY_VALID",JSON.stringify(result.issues));
 assert.equal(result.candidate_tools_present,true);
 assert.equal(result.executable,false);
 method.steps[0].operation="run";
 assert.match(assessMethod(problem,method).issues.join(" "),/candidate tool may not claim/);
});
test("G2: forged goal capability and missing claim coverage cannot be certified",()=>{
 const {problem,method}=fixture();
 method.steps[0].provides=["math.symbolic"];
 assert.match(assessMethod(problem,method).issues.join(" "),/tool does not provide/);
 const bare=fixture();
 bare.method.goal_claim_ids=[];
 assert.match(assessMethod(bare.problem,bare.method).issues.join(" "),/goal claim/);
});
test("G2: budgets, cycles and unknown dependencies fail closed",()=>{
 const {problem,method}=fixture();
 const bad=copy(method);
 bad.steps.push({...copy(bad.steps[0]),id:"step02",depends_on:["step01"]});
 bad.steps[0].depends_on=["step02"];
 assert.equal(assessMethod(problem,bad).status,"REJECTED");
 assert.match(assessMethod(problem,bad).issues.join(" "),/cycle|depth/);
 const another=copy(method);
 another.steps[0].depends_on=["ghost"];
 assert.match(assessMethod(problem,another).issues.join(" "),/unknown dependency/);
 const budget=copy(method);
 budget.steps[0].timeout_ms=30000;
 assert.match(assessMethod(problem,budget).issues.join(" "),/total method budget/);
});
test("G2: no missing source lineage or silent declassification",()=>{
 const {problem,method}=fixture();
 method.steps[0].source_refs=[];
 assert.match(assessMethod(problem,method).issues.join(" "),/no source or dependency lineage/);
 const privateModel=fixture();
 privateModel.problem.source_refs[0].classification="USER_PRIVATE";
 privateModel.problem.policy.max_input_classification="USER_PRIVATE";
 privateModel.method.steps[0].output_classification="PUBLIC";
 assert.match(assessMethod(privateModel.problem,privateModel.method).issues.join(" "),/illegally declassified/);
});
test("G2: prompt containing private inputs cannot cross unknown LLM provider boundary",async()=>{
 const {problem}=fixture();
 problem.source_refs[0].classification="USER_PRIVATE";
 problem.policy.max_input_classification="USER_PRIVATE";
 let called=false;
 const outcome=await proposeMethod(problem,async()=>{called=true;throw Error("should not leak");});
 assert.equal(called,false);
 assert.equal(outcome.status,"BLOCKED_BY_POLICY");
});
test("G2: public LLM proposal callback is isolated and executed once",async()=>{
 const {problem,method}=fixture();
 let calls=0;
 const result=await proposeMethod(problem,async prompt=>{
   calls++;
   assert.equal(prompt.mode,"UNTRUSTED_PROPOSAL_ONLY");
   assert.ok(prompt.candidates.some(x=>x.id==="z3"));
   assert.ok(prompt.candidates.every(x=>x.operation_policy.includes("allowlist")));
   return JSON.stringify(method);
 });
 assert.equal(calls,1);
 assert.equal(result.status,"STRUCTURALLY_VALID",JSON.stringify(result.issues));
 assert.equal(result.executable,false);
});
test("G2: non-JSON, giant responses and provider failures are rejected",async()=>{
 const {problem}=fixture();
 for(const value of ["{", "x".repeat(70000)]){
   const result=await proposeMethod(problem,async()=>value);
   assert.equal(result.status,"REJECTED");
   assert.equal(result.tool_execution,"NOT_RUN");
 }
 const error=await proposeMethod(problem,async()=>{throw Error("provider unavailable");});
 assert.equal(error.status,"REJECTED");
});
test("G2: external fact without source never becomes a symbolic proof",async()=>{
 const {problem,method}=fixture();
 problem.claims[0].kind="external_fact";
 problem.claims[0].source_refs=[];
 problem.claims[0].capability_ids=[];
 let called=false;
 const answer=await proposeMethod(problem,async()=>{called=true;return method;});
 assert.equal(answer.status,"NEEDS_SOURCE");
 assert.equal(called,false);
 assert.equal(answer.solution_promotable,false);
});
test("G2: forged semantic review, output claims and raw argv are rejected",()=>{
 const {problem,method}=fixture();
 method.semantic_review="PASSED";
 assert.match(assessMethod(problem,method).issues.join(" "),/cannot claim semantic review/);
 const injected=fixture();
 injected.method.steps[0].argv=["curl","https://outside.example"];
 assert.match(assessMethod(injected.problem,injected.method).issues.join(" "),/unexpected fields|invalid step fields/);
});
test("G2: invalid ProblemSpec is rejected before plan selection, not crashed",()=>{
 const {problem,method}=fixture();
 problem.source_refs[0].sha256="bad-hash";
 assert.equal(validateProblemSpec(problem).ok,false);
 assert.equal(assessMethod(problem,method).status,"REJECTED");
});
test("G2: restrictive inputs cannot be exported by a downstream derived artifact",()=>{
 const {problem,method}=fixture();
 problem.source_refs[0].classification="RESTRICTED";
 problem.policy.max_input_classification="RESTRICTED";
 method.steps[0].output_classification="RESTRICTED";
 method.steps.push({
   id:"step02",tool_id:"z3",operation:"solve",provides:["logic.smt"],
   depends_on:["step01"],source_refs:[],estimated_cost_units:1,timeout_ms:100,
   destination:"LOCAL",output_classification:"PUBLIC"
 });
 const result=assessMethod(problem,method);
 assert.match(result.issues.join(" "),/illegally declassified/);
 assert.equal(result.status,"REJECTED");
});
