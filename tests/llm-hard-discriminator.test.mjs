import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readHardCases,inspectSchedulingSemantics,buildHardNativeWorklist}
  from "../benchmarks/llm-methods/g5/hard-oracle.mjs";
import {hardABManifest,scoreHardPairedAB,frozenABManifest}
  from "../benchmarks/llm-methods/g5/score-ab.mjs";

const hash=s=>createHash("sha256").update(s).digest("hex");
const encode=JSON.stringify;
const SHA="e".repeat(64);
function syntheticPaired(){
 const manifest=hardABManifest();
 const config={model_id:"test-only",model_version:"0",
   prompt_template_sha256:"a".repeat(64),seed:0,temperature:0,max_output_tokens:4096};
 const make=arm=>({
   schema:"formal-tools/llm-ab-observations/0.1",arm,
   source_sha256:manifest.source_sha256,
   protocol_id:"hard-r1-synthetic-test-not-real-model-or-native",
   config:{...config},
   observations:manifest.cases.map(c=>({
     case_id:c.id,case_sha256:c.case_sha256,
     prediction:arm==="LLM_ONLY"?"UNKNOWN":c.expected,
     raw_trace_sha256:SHA,cost_usd:0.0002,latency_ms:110,
     input_tokens:10,output_tokens:5,
     ...(arm==="LLM_TOOLS"?{tool_status:c.expected==="PASS"?"SAT":"UNSAT",
       tool_receipt_sha256:SHA}:{})
   }))
 });
 return {baseline:make("LLM_ONLY"),augmented:make("LLM_TOOLS")};
}
const score=x=>scoreHardPairedAB(encode(x.baseline),encode(x.augmented));

test("G5 hard-r1 is a separate source-frozen 10/10, 20-case, bounded adversarial fixture",()=>{
 const f=readHardCases();
 assert.equal(f.cases.length,20);
 assert.equal(f.cases.filter(x=>x.expected==="PASS").length,10);
 assert.equal(f.cases.filter(x=>x.expected==="FAIL").length,10);
 assert.equal(new Set(f.cases.map(x=>x.id)).size,20);
 assert.equal(f.authority.native_execution,"NOT_RUN");
 assert.equal(f.authority.llm_ab_execution,"NOT_RUN");
 assert.equal(f.authority.independent_semantic_qualification,"NOT_RUN");
 assert.match(f.source_sha256,/^[0-9a-f]{64}$/);
 assert.equal(frozenABManifest().cases.length,6,"original source/score contract unchanged");
 assert.equal(hardABManifest().cases.length,20);
});
test("G5 finite oracle independently recomputes every pre-frozen label",()=>{
 const f=readHardCases();
 const errors=f.cases.filter(c=>inspectSchedulingSemantics(c)!==c.expected);
 assert.deepEqual(errors,[],"authored labels must survive independent deterministic interpreter");
});
test("G5 native tool worklist is hash-stable source-derived and explicitly NOT_RUN",()=>{
 const f=readHardCases(),w=buildHardNativeWorklist();
 assert.equal(w.entries.length,20);
 assert.equal(w.source_sha256,f.source_sha256);
 assert.equal(w.real_native_executed,false);
 assert.equal(w.original_claim,"UNVERIFIED");
 assert.equal(w.g5_accepted,false);
 assert.equal(new Set(w.entries.map(e=>e.id)).size,20);
 for(const e of w.entries){
   assert.equal(e.tool_status,"NOT_RUN");
   assert.equal(e.input_sha256,hash(e.smt2));
   assert.ok(e.smt2.includes("(set-logic QF_LIA)"));
   assert.ok(e.smt2.endsWith("(check-sat)\n"));
 }
});
test("G5 metamorphic R1/R2/R3 one-field boundary and identity changes",()=>{
 const base=readHardCases().cases;
 const get=id=>structuredClone(base.find(x=>x.id===id));
 let c=get("p-adjacent-multiwriter");
 assert.equal(inspectSchedulingSemantics(c),"PASS");
 c.tasks.B.start=1; // Adjacent -> one-unit overlap; A->B also violated
 assert.equal(inspectSchedulingSemantics(c),"FAIL");
 c=get("p-parallel-three-distinct");
 assert.equal(inspectSchedulingSemantics(c),"PASS");
 c.tasks.C.resource=c.tasks.A.resource;
 assert.equal(inspectSchedulingSemantics(c),"FAIL");
 c=get("p-case-sensitive-resource");
 assert.equal(inspectSchedulingSemantics(c),"PASS");
 c.tasks.B.resource="Queue";
 assert.equal(inspectSchedulingSemantics(c),"FAIL");
 c=get("p-fork-join-boundary");
 assert.equal(inspectSchedulingSemantics(c),"PASS");
 c.tasks.C.start=1;
 assert.equal(inspectSchedulingSemantics(c),"FAIL");
 c=get("n-hidden-zero-length");
 assert.equal(inspectSchedulingSemantics(c),"FAIL");
 c.tasks.B.end=3;
 assert.equal(inspectSchedulingSemantics(c),"PASS");
});
test("G5 20-case scorer reports source-authored synthetic metrics, never G5 qualification",()=>{
 const input=syntheticPaired(),result=score(input);
 assert.equal(result.status,"SCORED_UNATTESTED");
 assert.equal(result.source_suite,"HARD_R1");
 assert.equal(result.baseline.unknown,20);
 assert.equal(result.baseline.coverage,0);
 assert.equal(result.augmented.correct,20);
 assert.equal(result.augmented.false_pass,0);
 assert.equal(result.augmented.coverage,1);
 assert.equal(result.augmented.cost_usd,0.004000000000000001);
 assert.equal(result.g5_accepted,false);
 assert.equal(result.independent_raw_trace_review,"NOT_RUN");
 assert.match(result.business_oracle,/NOT_INDEPENDENTLY_QUALIFIED/);
});
test("G5 hard-r1 source drift/false model controls/unknown tool/precision fail closed",()=>{
 const x=syntheticPaired();
 x.augmented.observations[0].tool_status="TIMEOUT";
 assert.equal(score(x).status,"BLOCKED");
 x.augmented.observations[0].prediction="UNKNOWN";
 assert.equal(score(x).status,"SCORED_UNATTESTED");
 x.augmented.source_sha256="f".repeat(64);
 assert.equal(score(x).status,"BLOCKED");
 const y=syntheticPaired();
 y.augmented.observations.pop();
 assert.equal(score(y).status,"BLOCKED");
 const z=syntheticPaired();
 z.augmented.config.max_output_tokens=1024;
 assert.equal(score(z).status,"BLOCKED");
});
test("G5 sampling control comparison is canonical across JSON object key ordering",()=>{
 const x=syntheticPaired();
 const c=x.augmented.config;
 x.augmented.config={max_output_tokens:c.max_output_tokens,
   temperature:c.temperature,seed:c.seed,
   prompt_template_sha256:c.prompt_template_sha256,
   model_version:c.model_version,model_id:c.model_id};
 assert.equal(score(x).status,"SCORED_UNATTESTED");
});
