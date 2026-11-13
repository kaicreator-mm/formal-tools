import test from "node:test";
import assert from "node:assert/strict";
import {sealSolutionCandidate} from "../packages/runner/js/solution-candidate.mjs";
import {inspectDisV020Consumption,DIS_V020_REFERENCE}
  from "../packages/runner/js/dis-v020-consumer-preflight.mjs";
const sha=x=>x.repeat(64),encode=JSON.stringify;

function frozenMethod(){
  const problem={
    schema:"formal-tools/problem-spec/0.1",problem_id:"ads.g6.dis.consumer",
    source_refs:[{id:"requirements",sha256:sha("a"),classification:"PUBLIC",
      purpose:"source-authored synthetic requirement",consumer:"formal_tools"}],
    requirements:[{id:"r1",source_ref:"requirements",text:"Overlapping writers must be rejected."}],
    claims:[{id:"claim1",text:"Overlapping writers must be rejected.",kind:"bounded_model",
      requirement_ids:["r1"],source_refs:["requirements"],capability_ids:["logic.smt"]}],
    oracles:[{id:"oracle1",source_ref:"requirements",frozen:true,
      positive_case_ids:["positive_case"],negative_case_ids:["negative_case"],
      review_identity:"independent_reviewer"}],
    capability_ids:["logic.smt"],
    budget:{max_steps:3,max_depth:3,max_cost_units:10,max_total_time_ms:10000,max_retries:0},
    policy:{allowed_tools:["z3"],allowed_operations:{z3:["solve"]},
      destination:"LOCAL",max_input_classification:"PUBLIC",allow_network:false}
  };
  const method={schema:"formal-tools/method-proposal/0.1",method_id:"g6_dis_preflight",
    problem_id:problem.problem_id,goal_claim_ids:["claim1"],oracle_ids:["oracle1"],
    semantic_review:"PENDING",
    steps:[{id:"step01",tool_id:"z3",operation:"solve",claim_ids:["claim1"],
      provides:["logic.smt"],depends_on:[],source_refs:["requirements"],
      estimated_cost_units:2,timeout_ms:300,destination:"LOCAL",
      output_classification:"PUBLIC"}]};
  const provenance={schema:"formal-tools/solution-provenance/0.1",
    source_id:"requirements",source_sha256:sha("a"),
    oracle_id:"oracle1",oracle_sha256:sha("a"),
    model_sha256:sha("b"),tool_id:"z3",tool_version:"5.4.0",
    tool_binary_sha256:sha("c"),platform:"debian13-x86_64",
    evidence_sha256:sha("d"),evidence_gate:"BYTES_BOUND_UNATTESTED"};
  const candidate=sealSolutionCandidate({problem_json:encode(problem),
    method_json:encode(method),provenance_json:encode(provenance)});
  assert.equal(candidate.status,"CANDIDATE");
  return {candidate_json:encode(candidate),current_provenance_json:encode(provenance),
    target_head:DIS_V020_REFERENCE.source_head};
}

test("G6 real DIS example is source-pinned, unqualified candidate maps to no-authority UNKNOWN",()=>{
 const x=frozenMethod(),v=inspectDisV020Consumption(x);
 assert.equal(DIS_V020_REFERENCE.repository,"kaicreator-mm/domain-harness");
 assert.equal(DIS_V020_REFERENCE.pr,1497);
 assert.equal(v.status,"REPLAY_BLOCKED_UNQUALIFIED");
 assert.equal(v.kind,"UNKNOWN");
 assert.equal(v.authority,"NONE");
 assert.equal(v.claim_result,"UNVERIFIED");
 assert.equal(v.effect_dispatched,false);
 assert.equal(v.host_invocations,0);
 assert.equal(v.replay_allowed,false);
 assert.equal(v.solution_promotable,false);
 assert.equal(v.g6_accepted,false);
 assert.equal(v.evidence.attested,false);
 assert.equal(v.evidence.dis_host_executed,false);
 assert.match(v.candidate_sha256,/^[a-f0-9]{64}$/);
});
test("G6 changed Source/Oracle/Model/Tool/Evidence and DIS target become STALE",()=>{
 const x=frozenMethod();
 for(const field of ["source_sha256","oracle_sha256","model_sha256",
   "tool_binary_sha256","evidence_sha256","tool_version","platform"]){
   const p=JSON.parse(x.current_provenance_json);
   p[field]=field==="tool_version"?"6.0":field==="platform"?"different-host":sha("e");
   const v=inspectDisV020Consumption({...x,current_provenance_json:encode(p)});
   assert.equal(v.status,"STALE",field);
   assert.equal(v.kind,"UNKNOWN");
   assert.equal(v.authority,"NONE");
   assert.equal(v.host_invocations,0);
 }
 const v=inspectDisV020Consumption({...x,target_head:"f".repeat(40)});
 assert.equal(v.status,"STALE");
 assert.equal(v.reason,"DIS_TARGET_VERSION_DRIFT");
});
test("G6 rejects forgery, invalid candidate and hostile input without dispatching effects",()=>{
 const x=frozenMethod();
 for(const mutation of [
  {status:"REUSABLE",qualification:"QUALIFIED",replay_allowed:true},
  {claim_result:"SUPPORTED_WITH_SCOPE",solution_promotable:true},
  {candidate_sha256:"f".repeat(64)}
 ]){
   const candidate={...JSON.parse(x.candidate_json),...mutation};
   const v=inspectDisV020Consumption({...x,candidate_json:encode(candidate)});
   assert.equal(v.status,"BLOCKED");
   assert.equal(v.kind,"UNKNOWN");
   assert.equal(v.authority,"NONE");
   assert.equal(v.effect_dispatched,false);
   assert.equal(v.host_invocations,0);
 }
 assert.equal(inspectDisV020Consumption({...x,target_head:"bad"}).status,"STALE");
 assert.equal(inspectDisV020Consumption({...x,candidate_json:"{bad"}).status,"BLOCKED");
 assert.equal(inspectDisV020Consumption({...x,candidate_json:"x".repeat(131073)}).status,"BLOCKED");
});
