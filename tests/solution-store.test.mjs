import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistSolutionCandidate, inspectStoredReplay, revokeStoredCandidate } from "../packages/runner/js/solution-store.mjs";
import { sealSolutionCandidate } from "../packages/runner/js/solution-candidate.mjs";

// Detect directory-fsync support by attempting the same probe the store performs
// (open the directory read-only + one fsync); never branch on process.platform.
const DIR_FSYNC_UNSUPPORTED=new Set(["EPERM","EINVAL","EOPNOTSUPP","ENOSYS","ENOTTY"]);
async function directoryFsyncSupported(dir){
  let handle;
  try{
    handle=await open(dir,"r");
    await handle.sync();
    return true;
  }catch(err){
    if(DIR_FSYNC_UNSUPPORTED.has(err?.code))return false;
    throw err;
  }finally{await handle?.close();}
}
const probeDir=mkdtempSync(join(tmpdir(),"ft-g4-probe-"));
const dirFsyncOk=await directoryFsyncSupported(probeDir);
rmSync(probeDir,{recursive:true,force:true});
const onSupported=dirFsyncOk?test:test.skip;
const onUnsupported=dirFsyncOk?test.skip:test;

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
onSupported("G4 content-addressed candidate persists, reopens and refuses all semantic promotion",async()=>{
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
   const resurrect=await persistSolutionCandidate({store_dir:dir,...f});
   assert.equal(resurrect.status,"INVALIDATED","tombstone dominates idempotent persist");
   const different=await revokeStoredCandidate({store_dir:dir,
     candidate_sha256:first.candidate_sha256,reason:"SOURCE_REVOKED"});
   assert.equal(different.status,"BLOCKED","revocation may not be overwritten");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
onSupported("G4 stored candidate rejects modified evidence, forged gate and path traversal",async()=>{
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


onSupported("G4 atomic hard-link publication: parallel writers and readers never see partial JSON",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-g4-atomic-"));
 try{
   const f=fixture();
   const stores=await Promise.all(Array.from({length:12},()=>persistSolutionCandidate({store_dir:dir,...f})));
   assert.ok(stores.every(x=>x.status==="CANDIDATE_PERSISTED"));
   assert.equal(stores.filter(x=>x.record_write==="NEW").length,1);
   assert.equal(stores.filter(x=>x.record_write==="EXISTING").length,11);
   const id=stores[0].candidate_sha256;
   const views=await Promise.all(Array.from({length:10},()=>inspectStoredReplay({
     store_dir:dir,candidate_sha256:id,current_provenance_json:f.provenance_json
   })));
   assert.ok(views.every(x=>x.status==="REPLAY_BLOCKED_UNQUALIFIED"));
   assert.ok(readdirSync(dir).every(x=>!x.startsWith(".pending-")),"no temp artifacts after successful writers");
   const tomb=await Promise.all(Array.from({length:8},()=>revokeStoredCandidate({
     store_dir:dir,candidate_sha256:id,reason:"EVIDENCE_REVOKED"
   })));
   assert.ok(tomb.every(x=>x.status==="INVALIDATED"));
   assert.equal(tomb.filter(x=>x.record_write==="NEW").length,1);
   assert.equal(tomb.filter(x=>x.record_write==="EXISTING").length,7);
   assert.equal((await persistSolutionCandidate({store_dir:dir,...f})).status,"INVALIDATED");
   assert.equal((await inspectStoredReplay({store_dir:dir,candidate_sha256:id,
     current_provenance_json:f.provenance_json})).status,"INVALIDATED");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
onSupported("G4 orphan partial temporary record cannot be published or mistaken for committed candidate",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-g4-interrupt-"));
 try {
   const f=fixture();
   writeFileSync(join(dir,".pending-crashed-writer"),"{broken");
   const stored=await persistSolutionCandidate({store_dir:dir,...f});
   assert.equal(stored.status,"CANDIDATE_PERSISTED");
   const view=await inspectStoredReplay({store_dir:dir,candidate_sha256:stored.candidate_sha256,
     current_provenance_json:f.provenance_json});
   assert.equal(view.status,"REPLAY_BLOCKED_UNQUALIFIED");
   assert.equal(view.solution_promotable,false);
   // Existing corrupt final path must *not* be silently overwritten or repaired.
   writeFileSync(join(dir,"candidate-"+stored.candidate_sha256+".json"),"{incomplete");
   assert.equal((await persistSolutionCandidate({store_dir:dir,...f})).status,"BLOCKED");
   assert.equal((await inspectStoredReplay({store_dir:dir,candidate_sha256:stored.candidate_sha256,
     current_provenance_json:f.provenance_json})).status,"BLOCKED");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
onUnsupported("G4 unsupported directory fsync: persist/revoke fail closed before any write",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-g4-unsupported-"));
 try{
   const f=fixture();
   const sealed=sealSolutionCandidate({problem_json:f.problem_json,method_json:f.method_json,
     provenance_json:f.provenance_json});
   assert.equal(sealed.status,"CANDIDATE");
   const id=sealed.candidate_sha256;
   assert.match(id,/^[a-f0-9]{64}$/);
   const stored=await persistSolutionCandidate({store_dir:dir,...f});
   assert.equal(stored.status,"BLOCKED",JSON.stringify(stored));
   assert.equal(stored.record_write,undefined);
   assert.equal(stored.claim_result,"UNVERIFIED");
   assert.equal(stored.replay_allowed,false);
   assert.equal(stored.solution_promotable,false);
   assert.match(stored.issues[0],/does not support directory fsync/,
     "names the directory-fsync unavailability");
   assert.match(stored.issues[0],/POSIX-style store directory/,
     "names the owner provisioning requirement");
   assert.match(stored.issues[0],/nothing was written/,
     "names the recovery guidance");
   assert.doesNotMatch(stored.issues[0],/write or validation failed/,
     "never the generic catch-all message");
   assert.ok(!readdirSync(dir).some(x=>x.startsWith("candidate-")),
     "no candidate-<sha>.json may exist after the unsupported BLOCKED");
   assert.ok(readdirSync(dir).every(x=>!x.startsWith(".pending-")),"no temp residue");
   const view=await inspectStoredReplay({store_dir:dir,candidate_sha256:id,
     current_provenance_json:f.provenance_json});
   assert.equal(view.status,"BLOCKED","record absent: replay inspect sees nothing");
   const again=await persistSolutionCandidate({store_dir:dir,...f});
   assert.equal(again.status,"BLOCKED","an unsupported retry may never claim EXISTING");
   assert.equal(again.record_write,undefined);
   assert.match(again.issues[0],/does not support directory fsync/);
   const revoked=await revokeStoredCandidate({store_dir:dir,candidate_sha256:id,
     reason:"ORACLE_REVOKED"});
   assert.equal(revoked.status,"BLOCKED");
   assert.ok(!readdirSync(dir).some(x=>x.endsWith(".revoked.json")),
     "no tombstone may exist after the unsupported BLOCKED");
   assert.ok(readdirSync(dir).every(x=>!x.startsWith(".pending-")),"no temp residue");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
