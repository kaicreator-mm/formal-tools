import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistSolutionCandidate, inspectStoredReplay, revokeStoredCandidate } from "../packages/runner/js/solution-store.mjs";

const encode=JSON.stringify;
const sha=(letter)=>letter.repeat(64);
function fixture(){
  const problem={
    schema:"formal-tools/problem-spec/0.1",problem_id:"ads.g4.store",
    source_refs:[{id:"requirements",sha256:sha("a"),classification:"PUBLIC",
      purpose:"frozen synthetic case",consumer:"formal_tools"}],
    requirements:[{id:"r1",source_ref:"requirements",text:"No simultaneous writer conflict."}],
    claims:[{id:"claim1",text:"No simultaneous writer conflict.",kind:"bounded_model",
      requirement_ids:["r1"],source_refs:["requirements"],capability_ids:["logic.smt"]}],
    oracles:[{id:"oracle1",source_ref:"requirements",frozen:true,
      positive_case_ids:["positive_case"],negative_case_ids:["negative_case"],
      review_identity:"independent_reviewer"}],
    capability_ids:["logic.smt"],
    budget:{max_steps:3,max_depth:3,max_cost_units:10,max_total_time_ms:10000,max_retries:0},
    policy:{allowed_tools:["z3"],allowed_operations:{z3:["solve"]},
      destination:"LOCAL",max_input_classification:"PUBLIC",allow_network:false}
  };
  const method={schema:"formal-tools/method-proposal/0.1",method_id:"g4_store_method",
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
  return {problem_json:encode(problem),method_json:encode(method),
    provenance_json:encode(provenance),provenance};
}
test("G4 content-addressed candidate persists, reopens and refuses all semantic promotion",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-g4-store-"));
 try{
   const f=fixture(), first=await persistSolutionCandidate({store_dir:dir,...f});
   assert.equal(first.status,"CANDIDATE_PERSISTED",JSON.stringify(first.issues));
   assert.equal(first.record_write,"NEW");
   assert.match(first.candidate_sha256,/^[a-f0-9]{64}$/);
   const again=await persistSolutionCandidate({store_dir:dir,...f});
   assert.equal(again.status,"CANDIDATE_PERSISTED");
   assert.equal(again.record_write,"EXISTING");
   const request={store_dir:dir,candidate_sha256:first.candidate_sha256,
     current_provenance_json:f.provenance_json};
   const same=await inspectStoredReplay(request);
   assert.equal(same.status,"REPLAY_BLOCKED_UNQUALIFIED");
   assert.equal(same.replay_allowed,false);
   assert.equal(same.solution_promotable,false);
   const drift=await inspectStoredReplay({...request,current_provenance_json:
     encode({...f.provenance,tool_version:"other-ABI"})});
   assert.equal(drift.status,"STALE");
   assert.ok(drift.changed_fields.includes("tool_version"));
   assert.equal(drift.replay_allowed,false);
   const revoked=await revokeStoredCandidate({store_dir:dir,
     candidate_sha256:first.candidate_sha256,reason:"ORACLE_REVOKED"});
   assert.equal(revoked.status,"INVALIDATED");
   const after=await inspectStoredReplay(request);
   assert.equal(after.status,"INVALIDATED");
   assert.equal(after.replay_allowed,false);
   const different=await revokeStoredCandidate({store_dir:dir,
     candidate_sha256:first.candidate_sha256,reason:"SOURCE_REVOKED"});
   assert.equal(different.status,"BLOCKED","revocation may not be overwritten");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("G4 stored candidate rejects modified evidence, forged gate and path traversal",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-g4-tamper-"));
 try{
   const f=fixture(),value=await persistSolutionCandidate({store_dir:dir,...f});
   assert.equal(value.status,"CANDIDATE_PERSISTED");
   assert.equal((await inspectStoredReplay({store_dir:dir,
     candidate_sha256:"../etc/passwd",current_provenance_json:f.provenance_json})).status,"BLOCKED");
   assert.equal((await persistSolutionCandidate({store_dir:dir,
     ...f,provenance_json:encode({...f.provenance,evidence_gate:"PASS"})})).status,"BLOCKED");
   writeFileSync(join(dir,"candidate-"+value.candidate_sha256+".json"),
     encode({candidate_sha256:value.candidate_sha256,status:"REUSABLE"}));
   assert.equal((await inspectStoredReplay({store_dir:dir,
     candidate_sha256:value.candidate_sha256,
     current_provenance_json:f.provenance_json})).status,"BLOCKED");
   assert.equal((await persistSolutionCandidate({store_dir:dir,...f})).status,"BLOCKED",
     "an existing forged record may not be clobbered");
   assert.equal((await revokeStoredCandidate({store_dir:dir,
     candidate_sha256:value.candidate_sha256,reason:"OPERATOR_REVOKED"})).status,"BLOCKED");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
