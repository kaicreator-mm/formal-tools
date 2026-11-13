import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildHardNativeWorklist,readHardCases,inspectSchedulingSemantics}
 from "../benchmarks/llm-methods/g5/hard-oracle.mjs";
import {bindHardNativePair,prepareHardAB,runHardArms}
 from "../benchmarks/llm-methods/g5/hard-paired-run.mjs";
import {scoreHardPairedAB} from "../benchmarks/llm-methods/g5/score-ab.mjs";

/** IMPORTANT: fabricated native receipts here are *only* transport-contract
 * negative/positive TEST FIXTURES. They are never evidence of tool execution.
 */
function mockNative(tool){
 const source=readHardCases(),list=buildHardNativeWorklist();
 const sol=tool==="z3"?{version:"5.4.0",
   sha:"e9d7e6e6d76c81b5ea3f06d165fc4cfd8afab92b74cdf94417380b5eed10845d"}
   :{version:"1.4.2",
   sha:"6aecddf466552b83bb5883756c7955e0c9d5ddcc6d7f45b48c2f6e06a741b102"};
 return {schema:"formal-tools/hard-native-observations/0.1",
   suite:"HARD_R1",source_sha256:list.source_sha256,
   status:"NATIVE_SELF_REPORTED_COMPLETE",tool_id:tool,
   tool_version:sol.version,tool_binary_sha256:sol.sha,
   generated_input_count:20,observed_count:20,
   original_claim_result:"UNVERIFIED",independent_host_attestation:false,
   independent_semantic_oracle:false,g5_accepted:false,
   observations:list.entries.map((e,i)=>({
     id:e.id,case_id:e.case_id,case_sha256:e.case_sha256,
     input_sha256:e.input_sha256,
     status:inspectSchedulingSemantics(source.cases[i])==="PASS"?"SAT":"UNSAT",
     exit_code:0,timed_out:false,output_truncated:false
   }))};
}
test("G5 hard-r1 native pair binding needs the EXACT frozen 20-case identity",()=>{
 const z3=mockNative("z3"),cvc5=mockNative("cvc5");
 const bound=bindHardNativePair(z3,cvc5);
 assert.equal(bound.length,20);
 assert.ok(bound.every(x=>x.tool_status==="SAT"||x.tool_status==="UNSAT"));
 assert.ok(bound.every(x=>/^[a-f0-9]{64}$/.test(x.tool_receipt_sha256)));
 assert.equal(prepareHardAB(z3,cvc5).cases.length,20);
 cvc5.observations[2].status=z3.observations[2].status==="SAT"?"UNSAT":"SAT";
 assert.throws(()=>bindHardNativePair(z3,cvc5),/disagree/);
});
test("G5 hard-r1 refuses forged native version/source and missing cases",()=>{
 const a=mockNative("z3"),b=mockNative("cvc5");
 a.tool_binary_sha256="a".repeat(64);
 assert.throws(()=>prepareHardAB(a,b),/solver-version\/binary/);
 a.tool_binary_sha256=mockNative("z3").tool_binary_sha256;
 b.observations[3].input_sha256="f".repeat(64);
 assert.throws(()=>prepareHardAB(a,b),/incorrect source/);
});
test("G5 hard-r1 absent model credential makes zero calls and no fake PASS",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"g5-hard-missing-key-"));
 try{
   let called=0;
   await assert.rejects(()=>runHardArms(prepareHardAB(mockNative("z3"),
     mockNative("cvc5")),{outDir:dir,env:{},
       fetchImpl:()=>{called++;throw Error("should never call");}}),/missing/);
   assert.equal(called,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("G5 hard-r1 40 injected fake model calls only exercise scorer plumbing",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"g5-hard-mock-calls-"));
 try{
   let called=0;
   const fetchImpl=async()=>{
     called++;
     return {status:200,text:async()=>JSON.stringify({
       model:"deepseek-flash",
       choices:[{finish_reason:"stop",message:{content:"VERDICT: UNKNOWN"}}],
       usage:{prompt_tokens:50,completion_tokens:10}
     })};
   };
   const planned=prepareHardAB(mockNative("z3"),mockNative("cvc5"));
   const run=await runHardArms(planned,{outDir:dir,
     env:{DEEPSEEK_API_KEY:"test-placeholder-never-network"},fetchImpl});
   assert.equal(called,40);
   assert.equal(run.calls,40);
   assert.equal(run.baseline.observations.length,20);
   assert.equal(run.augmented.observations.length,20);
   const m=scoreHardPairedAB(JSON.stringify(run.baseline),JSON.stringify(run.augmented));
   assert.equal(m.status,"SCORED_UNATTESTED");
   assert.equal(m.baseline.unknown,20);
   assert.equal(m.augmented.unknown,20);
   assert.equal(m.g5_accepted,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("G5 hard-r1 aborts if server serves the wrong model despite requested model match",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"g5-hard-served-model-"));
 try{
   let called=0;
   const forged=async()=>{
     called++;
     return {status:200,text:async()=>JSON.stringify({
       model:"unexpected-routed-model",
       choices:[{finish_reason:"stop",message:{content:"VERDICT: PASS"}}],
       usage:{prompt_tokens:30,completion_tokens:8}
     })};
   };
   await assert.rejects(()=>runHardArms(prepareHardAB(mockNative("z3"),
     mockNative("cvc5")),{outDir:dir,
       env:{DEEPSEEK_API_KEY:"test-only-not-a-secret"},fetchImpl:forged}),/served model/);
   assert.equal(called,1,"model-routed mismatch must abort first result");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
