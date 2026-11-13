/**
 * Issue #11 / G5: REAL paired A/B run driver over the frozen six-case fixture.
 * LLM_ONLY judges the scenario facts alone; LLM_TOOLS additionally sees the
 * faithful QF_LIA query plus its pinned G3 native SAT/UNSAT receipt. Exactly
 * one DeepSeek call per case per arm (12 total), temperature 0, no retries.
 * The API key comes only from process.env.DEEPSEEK_API_KEY and is never logged
 * or persisted. Produced arms are observations: the frozen scorer keeps them
 * SCORED_UNATTESTED until independent raw-trace review.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { frozenABManifest, scoreFrozenPairedAB } from "./score-ab.mjs";
import { readFrozenAdsCases, generateAdsMatrix } from "../g3/ads-native-matrix.mjs";

export const PROTOCOL_ID="g5-real-paired-deepseek-flash-2026-11-13";
export const MODEL="deepseek-flash";
export const ENDPOINT="https://api.deepseek.com/chat/completions";
export const KEY_ENV="DEEPSEEK_API_KEY";
const RECEIPT=resolve(fileURLToPath(new URL("../../../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url)));
const sha256=x=>createHash("sha256").update(x).digest("hex");
const assert=(check,message)=>{if(!check)throw new TypeError(message);};

/** ONE frozen template for both arms; only the {EVIDENCE} slot differs. */
export const PROMPT_TEMPLATE=`You are judging whether a task-assignment scenario satisfies three frozen scheduling requirements.

Requirements (authoritative; evaluate ALL of them against the scenario facts):
R1: Dependencies form a directed acyclic graph and every predecessor finishes before its successor starts.
R2: Two tasks writing the same resource may not execute at overlapping times; different-resource writers may overlap.
R3: Every task must have a finite start and end time with start strictly less than end.

Scenario facts:
Tasks (start/end are integers; end is exclusive): {TASKS}
Precedence edges (["A","B"] means A must finish before B starts): {EDGES}

{EVIDENCE}

Reason step by step, then end your reply with exactly one final line, no backticks:
VERDICT: PASS
or
VERDICT: FAIL
or
VERDICT: UNKNOWN
PASS = the scenario satisfies ALL of R1, R2, R3. FAIL = at least one requirement is violated. UNKNOWN = you cannot determine.`;

export const LLM_ONLY_EVIDENCE="No tool output is available for this case. Judge from the scenario facts alone.";
export const TOOL_EXPLANATION="An independent SMT solver (Z3 5.4.0, exit code 0) evaluated this faithful QF_LIA encoding of R1-R3 over the fixed scenario facts. SAT means all encoded requirements are consistent with the facts; UNSAT means at least one encoded requirement is violated by the facts. Observed result: {STATUS}.";

// Pricing source: DeepSeek official pricing page
// (api-docs.deepseek.com/quick_start/pricing, read 2026-11-13),
// deepseek-flash peak rates: input cache-miss USD 0.3 / 1M tokens,
// output USD 1.2 / 1M tokens.
const PRICE_INPUT_PER_MILLION=0.3,PRICE_OUTPUT_PER_MILLION=1.2;
export const costUsd=(prompt_tokens,completion_tokens)=>
  Number(((prompt_tokens*PRICE_INPUT_PER_MILLION+completion_tokens*PRICE_OUTPUT_PER_MILLION)/1e6).toFixed(8));

/** Identical declared controls for both arms; seed is declared-only (never sent). */
export const CONFIG=Object.freeze({model_id:MODEL,
  model_version:"deepseek-flash-deepseek-v4.1-flash-1017",
  prompt_template_sha256:sha256(PROMPT_TEMPLATE),seed:0,temperature:0,
  max_output_tokens:1024});

export const renderPrompt=(scenario,evidence)=>
  PROMPT_TEMPLATE.replace("{TASKS}",JSON.stringify(scenario.tasks))
    .replace("{EDGES}",JSON.stringify(scenario.edges))
    .replace("{EVIDENCE}",evidence);

export const toolEvidence=native=>
  "Tool evidence — faithful QF_LIA encoding of the fixed scenario facts (pinned receipt input_sha256 "+native.input_sha256+"):\n"+
  native.smt2+"\n"+TOOL_EXPLANATION.replace("{STATUS}",native.tool_status);

const VERDICT=/^VERDICT: (PASS|FAIL|UNKNOWN)$/;
/** Last exact verdict line wins, case-sensitively; absent/malformed stays UNKNOWN. */
export function parseVerdict(content){
  if(typeof content!=="string"||!content)return {prediction:"UNKNOWN",parse:"no_content"};
  let prediction=null;
  for(const line of content.split("\n")){
    const m=VERDICT.exec(line.replace(/\r$/,""));
    if(m)prediction=m[1];
  }
  return prediction?{prediction,parse:"ok"}:{prediction:"UNKNOWN",parse:"absent"};
}

/** Faithful G3 queries bound to their pinned native receipts; abort on mismatch. */
export function bindFaithfulObservations(matrix,receipt){
  assert(receipt&&receipt.schema==="formal-tools/ads24-native-pair/0.1"&&
    Array.isArray(receipt.observations),"pinned native receipt unreadable");
  const byId=new Map(receipt.observations.map(o=>[o&&o.id,o]));
  return matrix.entries.filter(e=>e.model_id==="faithful").map(e=>{
    const obs=byId.get(e.id);
    assert(obs&&obs.input_sha256===e.input_sha256,
      "native receipt does not match frozen faithful query: "+e.id);
    assert(obs.exit_code===0&&(obs.status==="SAT"||obs.status==="UNSAT"),
      "native receipt status inconclusive for "+e.id);
    return {id:e.id,case_id:e.case_id,smt2:e.smt2,input_sha256:e.input_sha256,
      tool_status:obs.status,tool_receipt_sha256:sha256(JSON.stringify(obs))};
  });
}

/** Pure pre-run plan: frozen manifest, scenario facts and bound receipts. No network. */
export function prepareRun(){
  const manifest=frozenABManifest();
  const fixtures=readFrozenAdsCases();
  const bound=bindFaithfulObservations(generateAdsMatrix(),
    JSON.parse(readFileSync(RECEIPT,"utf8")));
  const byCase=new Map(bound.map(b=>[b.case_id,b]));
  const cases=manifest.cases.map(c=>{
    const scenario=fixtures.cases.find(s=>s.id===c.id);
    const native=byCase.get(c.id);
    assert(scenario&&native,"frozen case missing scenario or native receipt: "+c.id);
    return {case_id:c.id,case_sha256:c.case_sha256,expected:c.expected,scenario,native};
  });
  return {source_sha256:manifest.source_sha256,cases};
}

/** The only network path. One attempt, no retry; caller decides abort.
 * @param {any} body
 * @param {Record<string,string|undefined>} env
 * @param {any} [fetchImpl]
 */
export async function callModel(body,env,fetchImpl=globalThis.fetch){
  const key=env&&env[KEY_ENV];
  assert(typeof key==="string"&&key.length>0,KEY_ENV+" is not set");
  assert(typeof fetchImpl==="function","fetch implementation unavailable");
  const started=new Date(),t0=Date.now();
  let http_status=0,response_body="",error=null;
  try{
    const res=await fetchImpl(ENDPOINT,{method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+key},
      body:JSON.stringify(body)});
    http_status=res.status;
    response_body=await res.text();
  }catch(e){error=String(e&&e.message||e);}
  return {http_status,response_body,error,latency_ms:Math.max(1,Date.now()-t0),
    started_at:started.toISOString(),finished_at:new Date().toISOString()};
}

/** 12 real calls, one trace file each, then arms that must pass the frozen scorer.
 * @param {any} plan
 * @param {{outDir?:string,env?:Record<string,string|undefined>,fetchImpl?:any}} [options]
 */
export async function runArms(plan,{outDir,env,fetchImpl=globalThis.fetch}={}){
  assert(plan&&Array.isArray(plan.cases)&&plan.cases.length===6,"prepared plan required");
  const traces=join(outDir,"traces");
  mkdirSync(traces,{recursive:true});
  const arms={};
  let calls=0;
  for(const which of ["LLM_ONLY","LLM_TOOLS"]){
    const observations=[];
    for(const c of plan.cases){
      const evidence=which==="LLM_ONLY"?LLM_ONLY_EVIDENCE:toolEvidence(c.native);
      const body={model:MODEL,temperature:CONFIG.temperature,
        max_tokens:CONFIG.max_output_tokens,
        messages:[{role:"user",content:renderPrompt(c.scenario,evidence)}]};
      const r=await callModel(body,env,fetchImpl);
      calls++;
      let parsed=null;
      try{parsed=JSON.parse(r.response_body);}catch{}
      const content=parsed&&parsed.choices&&parsed.choices[0]&&parsed.choices[0].message?
        parsed.choices[0].message.content:null;
      const verdict=parseVerdict(content);
      const trace={requested_model:MODEL,endpoint:ENDPOINT,request:body,
        http_status:r.http_status,started_at:r.started_at,finished_at:r.finished_at,
        latency_ms:r.latency_ms,
        served_model:parsed&&parsed.model?parsed.model:null,
        usage:parsed&&parsed.usage?parsed.usage:null,verdict_parse:verdict,
        response_body:r.response_body,error:r.error};
      const bytes=JSON.stringify(trace,null,2)+"\n";
      writeFileSync(join(traces,which+"__"+c.case_id+".json"),bytes);
      assert(!r.error&&r.http_status>=200&&r.http_status<300,
        "API call failed for "+which+"__"+c.case_id+" (http "+r.http_status+"): "+
        (r.error||r.response_body.slice(0,300)));
      const usage=parsed&&parsed.usage;
      assert(usage&&Number.isSafeInteger(usage.prompt_tokens)&&usage.prompt_tokens>=0&&
        Number.isSafeInteger(usage.completion_tokens)&&usage.completion_tokens>=0,
        "API response missing usage counters for "+which+"__"+c.case_id);
      const row={case_id:c.case_id,case_sha256:c.case_sha256,
        prediction:verdict.prediction,raw_trace_sha256:sha256(bytes),
        cost_usd:costUsd(usage.prompt_tokens,usage.completion_tokens),
        latency_ms:r.latency_ms,input_tokens:usage.prompt_tokens,
        output_tokens:usage.completion_tokens};
      if(which==="LLM_TOOLS"){row.tool_status=c.native.tool_status;
        row.tool_receipt_sha256=c.native.tool_receipt_sha256;}
      observations.push(row);
    }
    arms[which]={schema:"formal-tools/llm-ab-observations/0.1",arm:which,
      source_sha256:plan.source_sha256,protocol_id:PROTOCOL_ID,
      config:JSON.parse(JSON.stringify(CONFIG)),observations};
  }
  assert(JSON.stringify(arms.LLM_ONLY.config)===JSON.stringify(arms.LLM_TOOLS.config),
    "arm model/prompt/sampling controls diverged after JSON round-trip");
  const scored=scoreFrozenPairedAB(JSON.stringify(arms.LLM_ONLY),JSON.stringify(arms.LLM_TOOLS));
  assert(scored.status==="SCORED_UNATTESTED",
    "frozen scorer rejected produced arms: "+JSON.stringify(scored.issues||scored));
  return {baseline:arms.LLM_ONLY,augmented:arms.LLM_TOOLS,calls};
}

/** Frozen constants captured provably before the first API call. */
function protocolDocument(plan){
  return {schema:"formal-tools/llm-ab-real-protocol/0.1",protocol_id:PROTOCOL_ID,
    frozen_at:new Date().toISOString(),requested_model:MODEL,endpoint:ENDPOINT,
    prompt_template:PROMPT_TEMPLATE,config:CONFIG,
    pricing:{source:"DeepSeek official pricing page (api-docs.deepseek.com/quick_start/pricing, read 2026-11-13)",
      tier:"peak",input_cache_miss_usd_per_million_tokens:PRICE_INPUT_PER_MILLION,
      output_usd_per_million_tokens:PRICE_OUTPUT_PER_MILLION,
      formula:"cost_usd = (prompt_tokens*0.3 + completion_tokens*1.2)/1e6 rounded to 8 decimals"},
    sampling:{temperature:0,max_tokens:1024,seed_sent:false,
      seed_note:"seed 0 is a declared scorer control only; the endpoint does not honor it"},
    calls:{retries:0,per_case_per_arm:1,total:12,
      abort_on:"non-2xx HTTP status, transport error or missing usage counters"},
    key:{env:KEY_ENV,
      handling:"read from process.env only; never logged or written; sent only as the Authorization header"},
    native_receipt:{path:"validation/ads24-native-2026-11-13/NATIVE_PAIR.json",
      source_sha256:plan.source_sha256,
      bindings:plan.cases.map(c=>({case_id:c.case_id,input_sha256:c.native.input_sha256,
        tool_status:c.native.tool_status,tool_receipt_sha256:c.native.tool_receipt_sha256}))}};
}

async function main(argv,env){
  const key=env&&env[KEY_ENV];
  if(typeof key!=="string"||!key)
    throw new TypeError(KEY_ENV+" is not set; refusing to run without the real DeepSeek API key (no network call made)");
  if(argv.length!==3)
    throw new TypeError("Usage: node benchmarks/llm-methods/g5/real-paired-run.mjs <output-dir>");
  const outDir=resolve(argv[2]);
  const plan=prepareRun();
  mkdirSync(outDir,{recursive:true});
  writeFileSync(join(outDir,"protocol.json"),JSON.stringify(protocolDocument(plan),null,2)+"\n");
  const {baseline,augmented,calls}=await runArms(plan,{outDir,env});
  const arms={schema:"formal-tools/llm-ab-real-run/0.1",protocol_id:PROTOCOL_ID,
    requested_model:MODEL,generated_at:new Date().toISOString(),baseline,augmented};
  writeFileSync(join(outDir,"arms.json"),JSON.stringify(arms,null,2)+"\n");
  process.stdout.write("G5 real paired run complete: "+calls+"/12 calls OK; arms: "+join(outDir,"arms.json")+"\n");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv,process.env).catch(e=>{
    console.error("G5 real run aborted: "+(e&&e.message||e));
    process.exitCode=1;
  });
}
