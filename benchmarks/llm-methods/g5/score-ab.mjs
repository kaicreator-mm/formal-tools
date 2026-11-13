/**
 * Issue #11 / G5: frozen, paired A/B metric checker.
 * This scores observations, not a test model and not an attested LLM experiment.
 * Without independently retrievable raw traces it always remains UNATTESTED.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SHA=/^[a-f0-9]{64}$/;
const PRED=new Set(["PASS","FAIL","UNKNOWN"]);
const STATUS=new Set(["SAT","UNSAT","UNKNOWN","ERROR","TIMEOUT","NOT_RUN"]);
const isPlain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const hash=x=>createHash("sha256").update(x).digest("hex");
const denied=why=>({status:"BLOCKED",issues:[why],g5_accepted:false});
const frozenPath=new URL("../r0/spec-fidelity-cases.json",import.meta.url);

export function frozenABManifest(){
  const source=readFileSync(frozenPath);
  // Checkout-agnostic frozen-source identity: EOL-only normalization, real content edits still change the hash; no-op on LF checkouts so previously recorded LF-form values (e.g. 46447f8a...) remain valid.
  const gitBytes=Buffer.from(source.toString("utf8").replace(/\r\n/g,"\n"),"utf8");
  const data=JSON.parse(source.toString("utf8"));
  if(data.schema!=="formal-tools/semantic-spec-cases/0.1"||
      !Array.isArray(data.cases)||data.cases.length!==6)throw Error("frozen source changed");
  return {schema:"formal-tools/llm-ab-frozen/0.1",source_sha256:hash(gitBytes),
    cases:data.cases.map(c=>({id:c.id,expected:c.expected,
      case_sha256:hash(JSON.stringify(c))}))};
}

function parse(text){
  if(typeof text!=="string"||Buffer.byteLength(text,"utf8")>262144)
    throw Error("bounded raw observation JSON required");
  const obj=JSON.parse(text);
  if(!isPlain(obj))throw Error("observation must be a JSON object");
  return obj;
}
const MAX_CASE_COST_USD=1_000_000;
const MAX_CASE_LATENCY_MS=3_600_000;
const MAX_CASE_TOKENS=1_000_000_000;
function validNumber(x,max){return typeof x==="number"&&Number.isFinite(x)&&x>=0&&x<=max;}
function goodConfig(c){
  return isPlain(c)&&typeof c.model_id==="string"&&c.model_id.length>0&&c.model_id.length<=100&&
    typeof c.model_version==="string"&&c.model_version.length>0&&c.model_version.length<=100&&
    SHA.test(c.prompt_template_sha256)&&Number.isSafeInteger(c.seed)&&
    validNumber(c.temperature,2)&&
    Number.isSafeInteger(c.max_output_tokens)&&c.max_output_tokens>0&&c.max_output_tokens<=100000;
}
function validArm(arm,which,manifest) {
  if(!isPlain(arm)||arm.schema!=="formal-tools/llm-ab-observations/0.1"||
     arm.arm!==which||arm.source_sha256!==manifest.source_sha256||
     !goodConfig(arm.config)||!Array.isArray(arm.observations)||
     arm.observations.length!==manifest.cases.length)
    throw Error("invalid A/B arm, source or model controls");
  const cases=new Map(manifest.cases.map(c=>[c.id,c]));
  const seen=new Set();
  for(const row of arm.observations){
    if(!isPlain(row)||typeof row.case_id!=="string"||seen.has(row.case_id))
      throw Error("duplicate/malformed case observation");
    seen.add(row.case_id);
    if(!cases.has(row.case_id)||cases.get(row.case_id).case_sha256!==row.case_sha256||
       !PRED.has(row.prediction)||!SHA.test(row.raw_trace_sha256)||
       !validNumber(row.cost_usd,MAX_CASE_COST_USD)||!validNumber(row.latency_ms,MAX_CASE_LATENCY_MS)||
       !Number.isSafeInteger(row.input_tokens)||row.input_tokens<0||row.input_tokens>MAX_CASE_TOKENS||
       !Number.isSafeInteger(row.output_tokens)||row.output_tokens<0||row.output_tokens>MAX_CASE_TOKENS)
      throw Error("missing, unfrozen or unmetered case observation");
    if(which==="LLM_ONLY"){
      if(Object.hasOwn(row,"tool_status")||Object.hasOwn(row,"tool_receipt_sha256"))
        throw Error("LLM-only arm cannot cite tool output");
    }else{
      if(!STATUS.has(row.tool_status)||!SHA.test(row.tool_receipt_sha256))
        throw Error("tool arm requires scoped, source-linked evidence metadata");
      // SAT/UNSAT is only a model-relative solver outcome, never a semantic
      // claim verdict. An LLM may abstain (UNKNOWN) despite a decisive solver
      // response when Source/Model/Oracle fidelity is unqualified. Conversely,
      // an inconclusive/failed tool call cannot support a claimed PASS/FAIL.
      if(!["SAT","UNSAT"].includes(row.tool_status)&&row.prediction!=="UNKNOWN")
        throw Error("inconclusive native tool status must not claim a verdict");
    }
  }
  return arm;
}
function measure(arm,manifest){
  const cases=new Map(manifest.cases.map(c=>[c.id,c]));
  const rows=arm.observations;
  let correct=0,classified=0,false_pass=0,false_reject=0,unknown=0;
  let cost_usd=0,latency_ms=0,input_tokens=0,output_tokens=0;
  for(const row of rows){
    const expected=cases.get(row.case_id).expected;
    if(row.prediction==="UNKNOWN")unknown++;
    else {
      classified++;
      if(row.prediction===expected)correct++;
      if(row.prediction==="PASS"&&expected==="FAIL")false_pass++;
      if(row.prediction==="FAIL"&&expected==="PASS")false_reject++;
    }
    cost_usd+=row.cost_usd; latency_ms+=row.latency_ms;
    input_tokens+=row.input_tokens;output_tokens+=row.output_tokens;
  }
  if(![cost_usd,latency_ms].every(Number.isFinite)||
     ![input_tokens,output_tokens].every(Number.isSafeInteger))
    throw Error("aggregate numeric metric overflow");
  const negative_cases=manifest.cases.filter(x=>x.expected==="FAIL").length;
  return {cases:rows.length,correct,classified,accuracy_all_cases:correct/rows.length,
    accuracy_classified:classified?correct/classified:null,
    false_pass,false_pass_rate_on_negatives:false_pass/negative_cases,
    false_reject,unknown,coverage:classified/rows.length,
    cost_usd,latency_ms,input_tokens,output_tokens};
}

/** Fairness requires identical frozen cases, base model and prompt controls.
 * Declared measurements remain self-reported until independent trace review.
 */
export function scoreFrozenPairedAB(baseline_json,augmented_json){
  try{
    const manifest=frozenABManifest();
    const baseline=validArm(parse(baseline_json),"LLM_ONLY",manifest);
    const augmented=validArm(parse(augmented_json),"LLM_TOOLS",manifest);
    if(JSON.stringify(baseline.config)!==JSON.stringify(augmented.config)||
       typeof baseline.protocol_id!=="string"||!baseline.protocol_id||
       baseline.protocol_id!==augmented.protocol_id)
      return denied("different LLM model/prompt/sampling/protocol controls");
    const b=measure(baseline,manifest),a=measure(augmented,manifest);
    const deltas={accuracy_all_cases:a.accuracy_all_cases-b.accuracy_all_cases,
      false_pass:a.false_pass-b.false_pass,unknown:a.unknown-b.unknown,
      coverage:a.coverage-b.coverage,cost_usd:a.cost_usd-b.cost_usd,
      latency_ms:a.latency_ms-b.latency_ms};
    if(!Object.values(deltas).every(Number.isFinite))
      return denied("non-finite paired metric delta");
    return {schema:"formal-tools/llm-ab-metrics/0.1",
      status:"SCORED_UNATTESTED",source_sha256:manifest.source_sha256,
      protocol_id:baseline.protocol_id,baseline:b,augmented:a,
      deltas,
      independent_raw_trace_review:"NOT_RUN",business_oracle:"SOURCE_AUTHORED_SYNTHETIC",
      g5_accepted:false};
  }catch {return denied("invalid, unfair, incomplete or unbounded A/B observations");}
}
