import test from "node:test";
import assert from "node:assert/strict";
import { sealSolutionCandidate, inspectCandidateReplay } from "../packages/runner/js/solution-candidate.mjs";

function fixture(){
  const problem={
    schema:"formal-tools/problem-spec/0.1",problem_id:"ads.g4.r0",
    source_refs:[{id:"requirements",sha256:"a".repeat(64),classification:"PUBLIC",
      purpose:"synthetic G4 frozen source",consumer:"formal_tools"}],
    requirements:[{id:"r1",source_ref:"requirements",text:"Writers cannot overlap."}],
    claims:[{id:"claim1",text:"Writers cannot overlap.",kind:"bounded_model",
      requirement_ids:["r1"],source_refs:["requirements"],capability_ids:["logic.smt"]}],
    oracles:[{id:"oracle1",source_ref:"requirements",frozen:true,
      positive_case_ids:["positive_case"],negative_case_ids:["negative_case"],
      review_identity:"independent_reviewer"}],
    capability_ids:["logic.smt"],
    budget:{max_steps:3,max_depth:3,max_cost_units:10,max_total_time_ms:10000,max_retries:0},
    policy:{allowed_tools:["z3"],allowed_operations:{z3:["solve"]},
      destination:"LOCAL",max_input_classification:"PUBLIC",allow_network:false}
  };
  const method={schema:"formal-tools/method-proposal/0.1",method_id:"g4_method",
    problem_id:problem.problem_id,goal_claim_ids:["claim1"],oracle_ids:["oracle1"],
    semantic_review:"PENDING",
    steps:[{id:"step01",tool_id:"z3",operation:"solve",claim_ids:["claim1"],
      provides:["logic.smt"],depends_on:[],source_refs:["requirements"],
      estimated_cost_units:2,timeout_ms:300,destination:"LOCAL",output_classification:"PUBLIC"}]};
  const provenance={schema:"formal-tools/solution-provenance/0.2",
    source_id:"requirements",source_sha256:"a".repeat(64),
    oracle_id:"oracle1",oracle_source_id:"requirements",oracle_sha256:"a".repeat(64),
    model_sha256:"b".repeat(64),tool_id:"z3",tool_version:"5.1.0",
    tool_binary_sha256:"c".repeat(64),platform:"debian13-x86_64-glibc2.41",
    evidence_sha256:"d".repeat(64),evidence_gate:"BYTES_BOUND_UNATTESTED"};
  return {problem,method,provenance};
}
const encode=x=>JSON.stringify(x);
const seal=({problem,method,provenance})=>sealSolutionCandidate({
  problem_json:encode(problem),method_json:encode(method),provenance_json:encode(provenance)});

test("G4 candidate seals G2 plan and frozen source without promoting a claim",()=>{
 const f=fixture(),a=seal(f),b=seal(f);
 assert.equal(a.status,"CANDIDATE",JSON.stringify(a.issues));
 assert.equal(a.candidate_sha256,b.candidate_sha256);
 assert.match(a.candidate_sha256,/^[a-f0-9]{64}$/);
 assert.equal(a.qualification,"NOT_ADMITTED");
 assert.equal(a.replay_allowed,false);
 assert.equal(a.solution_promotable,false);
 assert.equal(a.claim_result,"UNVERIFIED");
});
test("G4 exact candidate fingerprint does not authorize semantic replay",()=>{
 const f=fixture(),c=seal(f);
 const r=inspectCandidateReplay(encode(c),encode(f.provenance));
 assert.equal(r.status,"REPLAY_BLOCKED_UNQUALIFIED");
 assert.equal(r.replay_allowed,false);
 assert.equal(r.solution_promotable,false);
});
test("G4 source/model/tool/platform/evidence drift invalidates candidate",()=>{
 const f=fixture(),c=seal(f);
 for(const [key,value] of [["source_sha256","f".repeat(64)],["model_sha256","f".repeat(64)],
   ["tool_binary_sha256","f".repeat(64)],["tool_version","5.2.0"],
   ["platform","different-host"],["evidence_sha256","f".repeat(64)]]){
   const now={...f.provenance,[key]:value};
   const r=inspectCandidateReplay(encode(c),encode(now));
   assert.equal(r.status,"STALE",key);
   assert.ok(r.changed_fields.includes(key));
   assert.equal(r.replay_allowed,false);
 }
});
test("G4 tampered package and forged reusable state are rejected",()=>{
 const f=fixture(),c=seal(f);
 for(const mutated of [{...c,method_id:"forged"}, {...c,status:"REUSABLE"},
   {...c,qualification:"QUALIFIED"}, {...c,solution_promotable:true},
   {...c,claim_result:"SUPPORTED_WITH_SCOPE"}]){
   assert.equal(inspectCandidateReplay(encode(mutated),encode(f.provenance)).status,"BLOCKED");
 }
});
test("G4 source/oracle/tool mismatch, fake PASS and unbounded input fail closed",()=>{
 const f=fixture();
 assert.equal(seal({...f,provenance:{...f.provenance,source_sha256:"f".repeat(64)}}).status,"BLOCKED");
 assert.equal(seal({...f,provenance:{...f.provenance,oracle_sha256:"f".repeat(64)}}).status,"BLOCKED");
 assert.equal(seal({...f,provenance:{...f.provenance,tool_id:"unknown_tool"}}).status,"BLOCKED");
 assert.equal(seal({...f,provenance:{...f.provenance,evidence_gate:"PASS"}}).status,"BLOCKED");
 const huge=sealSolutionCandidate({problem_json:"x".repeat(200000),
   method_json:encode(f.method),provenance_json:encode(f.provenance)});
 assert.equal(huge.status,"BLOCKED");
});

test("G4 Candidate binds an independently sourced frozen Oracle separately from Claim source",()=>{
 const f=fixture();
 f.problem.source_refs.push({id:"independent_oracle",sha256:"e".repeat(64),
  classification:"PUBLIC",purpose:"independent frozen Oracle cases",consumer:"formal_tools"});
 f.problem.oracles[0].source_ref="independent_oracle";
 f.provenance.oracle_source_id="independent_oracle";
 f.provenance.oracle_sha256="e".repeat(64);
 const candidate=seal(f);
 assert.equal(candidate.status,"CANDIDATE",JSON.stringify(candidate.issues));
 assert.equal(candidate.provenance.source_sha256,"a".repeat(64));
 assert.equal(candidate.provenance.oracle_sha256,"e".repeat(64));
 assert.notEqual(candidate.provenance.source_sha256,candidate.provenance.oracle_sha256);
 const replay=inspectCandidateReplay(encode(candidate),encode(f.provenance));
 assert.equal(replay.status,"REPLAY_BLOCKED_UNQUALIFIED");
 assert.equal(replay.replay_allowed,false);
 assert.equal(replay.solution_promotable,false);
});

test("G4 rejects unknown Oracle source refs and mismatched Oracle source hashes",()=>{
 const f=fixture();
 f.problem.source_refs.push({id:"independent_oracle",sha256:"e".repeat(64),
  classification:"PUBLIC",purpose:"independent frozen Oracle cases",consumer:"formal_tools"});
 f.problem.oracles[0].source_ref="independent_oracle";
 f.provenance.oracle_source_id="independent_oracle";
 f.provenance.oracle_sha256="e".repeat(64);
 assert.equal(seal({...f,problem:{...f.problem,oracles:[{...f.problem.oracles[0],source_ref:"missing_oracle"}]}}).status,"BLOCKED");
 assert.equal(seal({...f,provenance:{...f.provenance,oracle_source_id:"missing_oracle"}}).status,"BLOCKED");
 assert.equal(seal({...f,provenance:{...f.provenance,oracle_sha256:"f".repeat(64)}}).status,"BLOCKED");
 const candidate=seal(f);
 const drift=inspectCandidateReplay(encode(candidate),encode({...f.provenance,oracle_sha256:"f".repeat(64)}));
 assert.equal(drift.status,"STALE");
 assert.deepEqual(drift.changed_fields,["oracle_sha256"]);
 const sourceDrift=inspectCandidateReplay(encode(candidate),encode({...f.provenance,oracle_source_id:"another_oracle"}));
 assert.equal(sourceDrift.status,"STALE");
 assert.deepEqual(sourceDrift.changed_fields,["oracle_source_id"]);
});
