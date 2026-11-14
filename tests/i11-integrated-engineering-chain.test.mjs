import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runIntegratedEngineeringChain}
 from "../benchmarks/llm-methods/g6/integrated-engineering-chain.mjs";

const HEAD="9edcb4c2698ef9733215a8281962268152a7eab9";
test("Issue #11 real cross-gate chain binds Capability→Method→48 historical real solver results→distinct semantics→Solution store→Replay→Tally",{
 skip:process.platform!=="linux"?"POSIX owner-local directory required":false},async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-i11-integrated-"));
 try{
   const result=await runIntegratedEngineeringChain({store_dir:dir,formal_head:HEAD});
   assert.equal(result.status,"PASSED_ENGINEERING_ONLY");
   assert.match(result.technical_execution.driver_git_blob,/^[a-f0-9]{40}$/);
   assert.match(result.technical_execution.finite_verifier_git_blob,/^[a-f0-9]{40}$/);
   assert.equal(result.technical_execution.host_independently_attested,false);
   assert.equal(result.stages.method,"STRUCTURALLY_VALID");
   assert.equal(result.stages.solve,"HISTORICAL_REAL_Z3_CVC5_24_EACH_REUSED");
   assert.equal(result.stages.independent_verify,"DISTINCT_FINITE_ALGORITHM_UNATTESTED");
   assert.equal(result.stages.replay,"DENIED_STALE_AND_REVOKED");
   assert.equal(result.stages.domain_business_function,"REAL_TALLY_4_DENYING_CALLS");
   assert.equal(result.stages.dis_sdk_kdp_host,"NOT_EXECUTED");
   assert.equal(result.solver_observations_historically_executed,48);
   assert.equal(result.solver_observations_newly_executed,0);
   assert.equal(result.technical_verification.technical_source_check,true);
   assert.equal(result.consumer.function_calls,4);
   assert.equal(result.consumer.phases[1].store_status,"STALE");
   assert.equal(result.consumer.phases[3].store_status,"INVALIDATED");
   assert.equal(result.consumer.phases[2].tally_result.state,"OBSERVED_INPUT_ONLY");
   assert.equal(result.consumer.host_invocations,0);
   assert.equal(result.consumer.effect_dispatched,false);
   assert.equal(result.original_claim,"UNVERIFIED");
   assert.equal(result.independent_professional_oracle,false);
   assert.equal(result.qualified_solution,false);
   assert.equal(result.qualified_replay,false);
   assert.equal(result.dis_host_invocations,0);
   assert.equal(result.g6_full_qualified,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("Issue #11 integrated chain fails closed on missing or forged Source HEAD",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ft-i11-negative-"));
 try{
   await assert.rejects(()=>runIntegratedEngineeringChain({store_dir:dir,formal_head:"none"}),/exact Git HEAD/);
   await assert.rejects(()=>runIntegratedEngineeringChain({store_dir:dir,formal_head:HEAD.toUpperCase()}),/exact Git HEAD/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
