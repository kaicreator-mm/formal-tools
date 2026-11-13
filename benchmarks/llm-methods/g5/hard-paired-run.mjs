/**
 * Issue #11 / G5 HARD_R1 actual LLM-only vs LLM+Z3 experiment driver.
 * To run, independently produce BOTH pinned real z3/cvc5 hard-r1 receipts
 * (hard-native-run.mjs) and provision DEEPSEEK_API_KEY on the executing Host.
 * No key => zero network requests. No mock solver status accepted as evidence.
 *
 * This code DOES NOT run as part of CI. Tests inject transport fakes and
 * are strictly marked synthetic. Real trial remains NOT_RUN until actual
 * raw traces are collected and independently reviewed by non-Writer.
 */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {hardABManifest,scoreHardPairedAB} from "./score-ab.mjs";
import {readHardCases,buildHardNativeWorklist} from "./hard-oracle.mjs";
import {MODEL,ENDPOINT,KEY_ENV,CONFIG,costUsd,
  renderPrompt,toolEvidence,callModel,parseVerdict}
  from "./real-paired-run.mjs";

const digest=x=>createHash("sha256").update(x).digest("hex");
export const HARD_PROTOCOL_ID="g5-hard-r1-20-cases-deepseek-flash-v1";
const assert=(yes,message)=>{if(!yes)throw Error(message);};

/** Verify both 20-case original-Runner receipts. These are SELF-REPORTED
 * process observations, not professional Oracle credentials.
 * @param {any} z3
 * @param {any} cvc5
 */
export function bindHardNativePair(z3,cvc5){
 const list=buildHardNativeWorklist();
 for(const [toolId,receipt] of [["z3",z3],["cvc5",cvc5]]){
   assert(receipt?.schema==="formal-tools/hard-native-observations/0.1"&&
     receipt.suite==="HARD_R1"&&receipt.tool_id===toolId&&
     receipt.source_sha256===list.source_sha256&&
     receipt.status==="NATIVE_SELF_REPORTED_COMPLETE"&&
     receipt.generated_input_count===20&&receipt.observed_count===20&&
     receipt.original_claim_result==="UNVERIFIED"&&
     receipt.independent_host_attestation===false&&
     receipt.independent_semantic_oracle===false&&
     receipt.g5_accepted===false&&Array.isArray(receipt.observations)&&
     receipt.observations.length===20,"unqualified/incomplete "+toolId+" hard-native receipt");
   const expectedVersion=toolId==="z3"?"5.4.0":"1.4.2";
   const sha=toolId==="z3"
      ?"e9d7e6e6d76c81b5ea3f06d165fc4cfd8afab92b74cdf94417380b5eed10845d"
      :"6aecddf466552b83bb5883756c7955e0c9d5ddcc6d7f45b48c2f6e06a741b102";
   assert(receipt.tool_version===expectedVersion&&receipt.tool_binary_sha256===sha,
     "original G3 solver-version/binary identity changed");
   for(let i=0;i<20;i++){
     const o=receipt.observations[i],e=list.entries[i];
     assert(o.id===e.id&&o.case_id===e.case_id&&o.input_sha256===e.input_sha256&&
       o.case_sha256===e.case_sha256&&o.exit_code===0&&
       ["SAT","UNSAT"].includes(o.status)&&o.timed_out===false&&
       o.output_truncated===false,
       toolId+" incorrect source, native exit or worklist order at "+i);
   }
 }
 for(let i=0;i<20;i++)assert(z3.observations[i].status===cvc5.observations[i].status,
   "Z3/cvc5 disagree on hard-r1 case "+i);
 return list.entries.map((entry,i)=>({
   ...entry,tool_status:z3.observations[i].status,
   tool_receipt_sha256:digest(JSON.stringify({
     z3:z3.observations[i],cvc5:cvc5.observations[i]
   }))
 }));
}
/** Pure offline plan, no HTTP/Host native execution.
 * @param {any} z3
 * @param {any} cvc5
 */
export function prepareHardAB(z3,cvc5){
 const manifest=hardABManifest(),fixtures=readHardCases();
 assert(manifest.source_sha256===fixtures.source_sha256,
   "hard source drift between scorer and benchmark");
 const native=bindHardNativePair(z3,cvc5);
 const cases=manifest.cases.map((c,i)=>{
   const scenario=fixtures.cases[i],v=native[i];
   assert(c.id===scenario.id&&v.case_id===c.id,
     "hard prompt/tool source case identity mismatch");
   return {case_id:c.id,case_sha256:c.case_sha256,scenario,native:v};
 });
 return {source_sha256:manifest.source_sha256,cases};
}

/** 40 actual calls, no retry. Test fetch injection does not imply a real trial.
 * @param {any} plan
 * @param {{outDir?:string,env?:Record<string,string|undefined>,fetchImpl?:any}} [options]
 */
export async function runHardArms(plan,{outDir,env,fetchImpl=globalThis.fetch}={}){
 assert(plan?.cases?.length===20&&typeof outDir==="string"&&outDir,
   "exact hard-r1 plan/output dir required");
 assert(typeof env?.[KEY_ENV]==="string"&&env[KEY_ENV],
   KEY_ENV+" missing, zero network calls");
 const traces=join(outDir,"traces");
 mkdirSync(traces,{recursive:true});
 const arms={},callsExpected=40;
 let calls=0;
 for(const arm of ["LLM_ONLY","LLM_TOOLS"]){
   const observations=[];
   for(const c of plan.cases){
     const evidence=arm==="LLM_ONLY"
       ?"No tool output is available. Judge original R1/R2/R3 from task facts alone."
       :toolEvidence(c.native);
     const request={model:MODEL,temperature:CONFIG.temperature,
       max_tokens:CONFIG.max_output_tokens,
       messages:[{role:"user",content:renderPrompt(c.scenario,evidence)}]};
     const run=await callModel(request,env,fetchImpl);
     calls++;
     let response;try{response=JSON.parse(run.response_body);}catch{response=null;}
     const choice=response?.choices?.[0];
     const parse=parseVerdict(choice?.message?.content);
     const trace={requested_model:MODEL,endpoint:ENDPOINT,request,
       http_status:run.http_status,started_at:run.started_at,
       finished_at:run.finished_at,latency_ms:run.latency_ms,
       served_model:response?.model??null,finish_reason:choice?.finish_reason??null,
       usage:response?.usage??null,verdict_parse:parse,
       response_body:run.response_body,error:run.error};
     const bytes=JSON.stringify(trace,null,2)+"\n";
     writeFileSync(join(traces,arm+"__"+c.case_id+".json"),bytes,{flag:"wx",mode:0o600});
     assert(!run.error&&run.http_status>=200&&run.http_status<300,
       "real LLM HTTP/transport failure for "+arm+"__"+c.case_id);
     // Unlike the archived v1 experiment, truncation cannot be silently
     // counted as an LLM-only inability. Abort BOTH-arm comparability.
     assert(choice?.finish_reason==="stop"&&parse.parse==="ok",
       "incomplete/ambiguous LLM response; do not score this partial run");
     const usage=response?.usage;
     assert(Number.isSafeInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0&&
       Number.isSafeInteger(usage?.completion_tokens)&&usage.completion_tokens>=0,
       "real model response has missing/invalid usage");
     const row={case_id:c.case_id,case_sha256:c.case_sha256,
       prediction:parse.prediction,raw_trace_sha256:digest(bytes),
       cost_usd:costUsd(usage.prompt_tokens,usage.completion_tokens),
       latency_ms:run.latency_ms,input_tokens:usage.prompt_tokens,
       output_tokens:usage.completion_tokens};
     if(arm==="LLM_TOOLS"){
       row.tool_status=c.native.tool_status;
       row.tool_receipt_sha256=c.native.tool_receipt_sha256;
     }
     observations.push(row);
   }
   arms[arm]={schema:"formal-tools/llm-ab-observations/0.1",
     arm,source_sha256:plan.source_sha256,
     protocol_id:HARD_PROTOCOL_ID,config:{...CONFIG},observations};
 }
 assert(calls===callsExpected,"paired call count mismatch");
 const score=scoreHardPairedAB(JSON.stringify(arms.LLM_ONLY),
   JSON.stringify(arms.LLM_TOOLS));
 assert(score.status==="SCORED_UNATTESTED",
   "real hard-r1 paired experiment failed frozen scorer");
 return {baseline:arms.LLM_ONLY,augmented:arms.LLM_TOOLS,calls};
}
async function main(argv,env){
 if(!env?.[KEY_ENV])throw Error(KEY_ENV+" is required; no LLM calls started");
 if(argv.length!==5)throw Error(
  "Usage: node hard-paired-run.mjs Z3_HARD_JSON CVC5_HARD_JSON OUTPUT_DIR");
 const [,,z3File,cvc5File,outDir]=argv;
 const z3=JSON.parse(readFileSync(resolve(z3File),"utf8"));
 const cvc5=JSON.parse(readFileSync(resolve(cvc5File),"utf8"));
 const plan=prepareHardAB(z3,cvc5),out=resolve(outDir);
 mkdirSync(out,{recursive:true});
 const protocol={schema:"formal-tools/g5-hard-real-protocol/0.1",
   protocol_id:HARD_PROTOCOL_ID,
   frozen_before_model_calls:new Date().toISOString(),
   suite:"HARD_R1",source_sha256:plan.source_sha256,
   requested_model:MODEL,endpoint:ENDPOINT,config:CONFIG,
   prompt_template_reference:"real-paired-run.mjs/PROMPT_TEMPLATE",
   tool_native_pair:"20 real z3 + 20 real cvc5 pinned prior receipts",
   calls:{count:40,retries:0,per_arm:20},
   pricing_source:"real-paired-run.mjs pinned DeepSeek peak prices, estimate only",
   key:{env:KEY_ENV,logged:false},
   independent_semantic_oracle:false,
   actual_qualification:"NOT_RUN"};
 writeFileSync(join(out,"protocol.json"),JSON.stringify(protocol,null,2)+"\n",
   {flag:"wx",mode:0o600});
 const observations=await runHardArms(plan,{outDir:out,env});
 const arms={schema:"formal-tools/g5-hard-real-arms/0.1",
   protocol_id:HARD_PROTOCOL_ID,generated_at:new Date().toISOString(),
   ...observations,g5_accepted:false};
 writeFileSync(join(out,"arms.json"),JSON.stringify(arms,null,2)+"\n",
   {flag:"wx",mode:0o600});
 process.stdout.write(JSON.stringify({calls:observations.calls,
   status:"REAL_LLM_OBSERVATIONS_UNATTESTED",g5_accepted:false})+"\n");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main(process.argv,process.env).catch(e=>{
   console.error("G5 hard-r1 paired execution BLOCKED: "+String(e?.message??e));
   process.exitCode=1;
 });
}
