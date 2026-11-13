import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {G6_TALLY_SOURCE,loadPinnedTallyBusiness,loadPinnedTallyBusinessFromBytes,runRealTallyBusinessConsumption}
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
test("G6 P1: byte-backed pinned loader defeats poisoned file-URL module cache and pathname replacement",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-g6-verified-bytes-"));
 try{
   const modulePath=join(dir,"original-tally.mjs");
   const hostile='export function assessTaskEvidence(){return {state:"UNPINNED_CACHED_MODULE",admitted:true,taskPass:true}};\n';
   const pinned=readFileSync(new URL(
     "../benchmarks/llm-methods/g6/snapshots/tally-business.mjs",import.meta.url));
   const identity=pathToFileURL(modulePath).href;
   writeFileSync(modulePath,hostile);
   const preloaded=await import(identity);
   assert.equal(preloaded.assessTaskEvidence({}).admitted,true);
   // The on-disk path now passes the same byte check as the production pin.
   // The old read/check/import(path URL) primitive would still use hostile
   // cached code, proving the reviewer's exact P1 counterexample.
   writeFileSync(modulePath,pinned);
   const knownBytes=readFileSync(modulePath);
   const stale=await import(identity);
   assert.strictEqual(stale,preloaded);
   assert.equal(stale.assessTaskEvidence({}).state,"UNPINNED_CACHED_MODULE");
   const safe=await loadPinnedTallyBusinessFromBytes(knownBytes);
   assert.equal(safe.blob,G6_TALLY_SOURCE.git_blob);
   assert.equal(safe.invoke({}).state,"UNQUALIFIED_INPUT");
   assert.equal(safe.invoke({}).admitted,false);
   // A later pathname swap cannot alter the previously validated bytes.
   writeFileSync(modulePath,hostile);
   const afterSwap=await loadPinnedTallyBusinessFromBytes(knownBytes);
   assert.equal(afterSwap.invoke({}).admitted,false);
   assert.equal(afterSwap.invoke({}).taskPass,false);
   await assert.rejects(()=>loadPinnedTallyBusinessFromBytes(
     Buffer.from(hostile)),/TALLY_BUSINESS_SOURCE_DRIFT/);
 }finally{rmSync(dir,{recursive:true,force:true});}
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
     assert.equal(result.consumer_execution.source_commit,null);
     assert.match(result.consumer_execution.driver_git_blob,/^[a-f0-9]{40}$/);
     assert.match(result.consumer_execution.test_git_blob,/^[a-f0-9]{40}$/);
     assert.equal(result.consumer_execution.source_bytes_executed_pinned,true);
     assert.equal(result.consumer_execution.source_commit_independently_attested,false);
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
   await assert.rejects(()=>runRealTallyBusinessConsumption({store_dir:dir,
     formal_head:HEAD,consumer_execution_head:"forged"}),/consumer_execution_head/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("G6 real two-argument CLI executes the exact pinned Tally Function and refuses malformed invocation",
  {skip:process.platform!=="linux"?"POSIX durable directory required":false},
  ()=>{
    const dir=mkdtempSync(join(tmpdir(),"ft-g6-tally-cli-"));
    const script=fileURLToPath(new URL(
      "../benchmarks/llm-methods/g6/real-tally-business-consumer.mjs",import.meta.url));
    try{
      const good=spawnSync(process.execPath,[script,dir,HEAD,HEAD],
        {encoding:"utf8",timeout:10000,maxBuffer:131072});
      assert.equal(good.status,0,good.stderr);
      const result=JSON.parse(good.stdout);
      assert.equal(result.status,"PASSED_ENGINEERING_ONLY");
      assert.equal(result.function_calls,4);
      assert.equal(result.g6_accepted,false);
      assert.equal(result.consumer_execution.source_commit,HEAD);
      assert.equal(result.consumer_execution.source_commit_independently_attested,false);
      const bad=spawnSync(process.execPath,[script,dir],
        {encoding:"utf8",timeout:3000,maxBuffer:8192});
      assert.equal(bad.status,1);
      assert.match(bad.stderr,/usage:/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
