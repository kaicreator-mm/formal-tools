import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyAdsNativeObservation, executeAds24 } from "../benchmarks/llm-methods/g3/ads-native-replay.mjs";

const sha=b=>createHash("sha256").update(b).digest("hex");
const observed=(stdout,opts={})=>({run_status:"EXECUTED",process_outcome:"EXIT_ZERO",
  executions:[{stdout,stderr:"",exit_code:0,timed_out:false,output_truncated:false,
    ...opts}]});

test("G3 native status parser refuses extra or conflicting stdout and injected stderr",()=>{
 for(const expected of ["sat\n","unsat\n","unknown\n"])
   assert.equal(classifyAdsNativeObservation(observed(expected)),expected.trim().toUpperCase());
 for(const text of ["", "sat\nunsat\n", "unsat\nsat\n", "sat\n(error bad)", "sat arbitrary",
   "prefix sat", "error: SAT"])
   assert.equal(classifyAdsNativeObservation(observed(text)),"ERROR",text);
 assert.equal(classifyAdsNativeObservation(observed("sat\n",{stderr:"warning"})),"ERROR");
 assert.equal(classifyAdsNativeObservation(observed("sat\n",{exit_code:1})),"ERROR");
 assert.equal(classifyAdsNativeObservation(observed("sat\n",{output_truncated:true})),"ERROR");
 assert.equal(classifyAdsNativeObservation(observed("sat\n",{timed_out:true})),"TIMEOUT");
 assert.equal(classifyAdsNativeObservation({run_status:"NOT_RUN"}),"NOT_RUN");
});
test("G3 native replay requires exact pinned binary identity",async()=>{
 await assert.rejects(()=>executeAds24({tool:"z3",binary_dir:"/",expected_binary_sha256:"wrong",
   output_dir:"/tmp/unused"}),/explicit tool/);
});
test("G3 24 actual subprocess observations are NOT semantic Oracle or supply-chain proof",{
  skip:process.platform!=="linux"
},async()=>{
 const root=mkdtempSync(join(tmpdir(),"ft-ads24-native-test-"));
 try{
   const dir=join(root,"bin"),out=join(root,"out");
   mkdirSync(dir);
   // Deliberately fake tool: exercises actual typed runner process path but can
   // never be cited as a Z3 or cvc5 native solver measurement.
   const exe=join(dir,"z3");
   const fake="#!/bin/sh\nif [ \"$1\" = \"-version\" ]; then echo mock-not-z3; exit 0; fi\necho sat; exit 0\n";
   writeFileSync(exe,fake);chmodSync(exe,0o755);
   await assert.rejects(()=>executeAds24({tool:"z3",binary_dir:dir,
      expected_binary_sha256:"0".repeat(64),output_dir:out}),/SHA mismatch/);
   const result=await executeAds24({tool:"z3",binary_dir:dir,
      expected_binary_sha256:sha(readFileSync(exe)),output_dir:out,timeout_s:5});
   const receipt=JSON.parse(readFileSync(result.file,"utf8"));
   assert.equal(result.observed,24);
   assert.equal(receipt.receipts.length,24);
   assert.equal(receipt.host_process_attested,false);
   assert.equal(receipt.independent_oracle_review,"NOT_RUN");
   assert.equal(receipt.solution_promotable,false);
   assert.equal(receipt.original_claim_verdict,"UNVERIFIED");
   assert.equal(receipt.scored.status,"SCORED_UNATTESTED");
   assert.ok(receipt.scored.summaries.some(s=>s.diagnostic_classification==="REJECT_WEAK"));
 }finally{rmSync(root,{recursive:true,force:true});}
});
