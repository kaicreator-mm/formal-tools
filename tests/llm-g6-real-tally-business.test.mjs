import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {G6_TALLY_SOURCE,loadPinnedTallyBusiness,runRealTallyBusinessConsumption}
  from "../benchmarks/llm-methods/g6/real-tally-business-consumer.mjs";

const HEAD="ed6d0fbb6815b6d9445a5deacf8dab56de003c84";

test("G6 imports the REAL original Git-blob-pinned Tally Business Function",async()=>{
 assert.equal(G6_TALLY_SOURCE.repository,"kaicreator-mm/tally");
 assert.equal(G6_TALLY_SOURCE.commit,"e988321439f65b55936a691c02250b6d62a29409");
 assert.equal(G6_TALLY_SOURCE.git_blob,"54015fb63ffb13b4f4e562f660d2172098b5f7f4");
 assert.equal(G6_TALLY_SOURCE.original_dis_consumer_manifest_blob,
   "39e14468723c4211d1e55d6a7c3aa1a16204c5a8");
 const actual=await loadPinnedTallyBusiness();
 assert.match(actual.source_sha256,/^[a-f0-9]{64}$/);
 assert.equal(actual.blob,G6_TALLY_SOURCE.git_blob);
 const missing=actual.invoke({});
 assert.deepEqual({state:missing.state,admitted:missing.admitted,taskPass:missing.taskPass},
   {state:"UNQUALIFIED_INPUT",admitted:false,taskPass:false});
});
test("G6 Tally Business invocation cannot promote a fabricated claim or dependency",async()=>{
 const real=await loadPinnedTallyBusiness();
 const forged=real.invoke({
   issueRef:"https://github.com/kaicreator-mm/formal-tools/issues/11",
   issueNumber:11,sourceSha:HEAD,claimRef:"fake-fully-qualified-claim",
   dependenciesComplete:true});
 assert.equal(forged.state,"OBSERVED_INPUT_ONLY");
 assert.equal(forged.reason,"REQUIRES_NATIVE_CLAIM_AND_KERNEL_ADMISSION");
 assert.equal(forged.admitted,false);
 assert.equal(forged.taskPass,false);
 const wrongHead=real.invoke({
   issueRef:"https://github.com/kaicreator-mm/formal-tools/issues/11",
   issueNumber:11,sourceSha:"invalid",claimRef:"fake",
   dependenciesComplete:true});
 assert.equal(wrongHead.state,"UNQUALIFIED_INPUT");
 assert.equal(wrongHead.admitted,false);
});
test("G6 real persisted G4 candidate -> Tally Function over 4 adverse states",
  {skip:process.platform!=="linux"?"POSIX durable directory required":false},
  async()=>{
   const dir=mkdtempSync(join(tmpdir(),"ft-g6-tally-"));
   try{
     const result=await runRealTallyBusinessConsumption({store_dir:dir,formal_head:HEAD});
     assert.equal(result.status,"PASSED_ENGINEERING_ONLY");
     assert.equal(result.did_invoke_actual_domain_business_function,true);
     assert.equal(result.did_invoke_dis_aot_sdk_host,false);
     assert.equal(result.function_calls,4);
     assert.equal(result.native_original_faithful_cases,6);
     assert.equal(result.host_invocations,0);
     assert.equal(result.effect_dispatched,false);
     assert.equal(result.g6_accepted,false);
     assert.equal(result.original_claim,"UNVERIFIED");
     assert.equal(result.replay_allowed,false);
     assert.equal(result.solution_promotable,false);
     assert.equal(result.phases[0].store_status,"REPLAY_BLOCKED_UNQUALIFIED");
     assert.equal(result.phases[1].store_status,"STALE");
     assert.equal(result.phases[2].tally_result.state,"OBSERVED_INPUT_ONLY");
     assert.equal(result.phases[3].store_status,"INVALIDATED");
     for(const phase of result.phases){
       assert.equal(phase.actual_business_function_called,true);
       assert.equal(phase.tally_result.admitted,false);
       assert.equal(phase.tally_result.taskPass,false);
     }
   }finally{rmSync(dir,{recursive:true,force:true});}
});
test("G6 fail-closed real call refuses missing or malformed source head",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-g6-head-"));
 try{
   await assert.rejects(()=>runRealTallyBusinessConsumption({store_dir:dir,
     formal_head:"not-a-sha"}),/exact formal-tools source HEAD/);
   await assert.rejects(()=>runRealTallyBusinessConsumption({store_dir:dir,
     formal_head:"ABCDEF123456789012345678901234567890ABCD"}),/exact formal-tools source HEAD/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
