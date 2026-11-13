/**
 * Independent post-run recomputation for the G5 hard-r1 real 40-call paired
 * experiment. Reads ONLY the 40 raw per-call trace files and the frozen case
 * source; never trusts arms.json aggregates or the frozen scorer for its own
 * numbers. Cross-checks against both and records any mismatch as a finding.
 *
 * Usage: node recompute-analysis.mjs <evidence-dir>
 */
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join,resolve,basename,dirname} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {fileURLToPath} from "node:url";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const dir=resolve(process.argv[2]??join(ROOT,"validation/g5-hard-r1-llm-real-2026-11-14"));
const sha=x=>createHash("sha256").update(x).digest("hex");
const PRICE_IN=0.3,PRICE_OUT=1.2;
const cost=t=>Number(((t.usage.prompt_tokens*PRICE_IN+t.usage.completion_tokens*PRICE_OUT)/1e6).toFixed(8));
// Independent verdict rule (documented): last exact "VERDICT: X" line wins.
function verdictOf(content){
  if(typeof content!=="string"||!content)return {prediction:"UNKNOWN",parse:"no_content"};
  let p=null;
  for(const line of content.split("\n")){
    const m=/^VERDICT: (PASS|FAIL|UNKNOWN)$/.exec(line.replace(/\r$/,""));
    if(m)p=m[1];
  }
  return p?{prediction:p,parse:"ok"}:{prediction:"UNKNOWN",parse:"absent"};
}
// Frozen labels straight from the committed case source (no manifest code).
const casesDoc=JSON.parse(readFileSync(join(ROOT,"benchmarks/llm-methods/g5/hard-cases-r1.json"),"utf8"));
const expected=new Map(casesDoc.cases.map(c=>[c.id,c.expected]));
const findings=[];
const add=f=>findings.push(f);

const traceDir=join(dir,"traces");
const files=readdirSync(traceDir).filter(f=>f.endsWith(".json")).sort();
if(files.length!==40)add("FATAL: expected 40 trace files, found "+files.length);

const arms={LLM_ONLY:[],LLM_TOOLS:[]};
for(const f of files){
  const m=/^(LLM_ONLY|LLM_TOOLS)__(.+)\.json$/.exec(f);
  if(!m){add("unparseable trace filename "+f);continue;}
  const [,arm,caseId]=m;
  const bytes=readFileSync(join(traceDir,f));
  const t=JSON.parse(bytes.toString("utf8"));
  const body=JSON.parse(t.response_body??"{");
  const choice=body?.choices?.[0];
  const v=verdictOf(choice?.message?.content);
  const row={arm,case_id:caseId,file:f,
    trace_sha256:sha(bytes),served_model:t.served_model,
    finish_reason:t.finish_reason,parse:v.parse,prediction:v.prediction,
    http_status:t.http_status,expected:expected.get(caseId)??null,
    prompt_tokens:t.usage?.prompt_tokens??null,
    completion_tokens:t.usage?.completion_tokens??null,
    cost_usd:cost(t),latency_ms:t.latency_ms,
    request_model:t.request?.model,request_temperature:t.request?.temperature,
    request_max_tokens:t.request?.max_tokens};
  if(row.expected===null)add("trace case id not in frozen source: "+caseId);
  if(t.requested_model!=="deepseek-flash")add(f+": requested model != deepseek-flash");
  if(row.request_model!=="deepseek-flash")add(f+": request.model != deepseek-flash");
  if(row.request_temperature!==0)add(f+": temperature != 0");
  if(row.request_max_tokens!==4096)add(f+": max_tokens != 4096");
  if(!(t.http_status>=200&&t.http_status<300))add(f+": non-2xx http "+t.http_status);
  if(t.error)add(f+": transport error "+t.error);
  if(row.served_model!=="deepseek-flash")add(f+": served model "+row.served_model);
  if(row.finish_reason!=="stop")add(f+": finish_reason "+row.finish_reason);
  if(!Number.isSafeInteger(row.prompt_tokens)||row.prompt_tokens<0)add(f+": bad prompt_tokens");
  if(!Number.isSafeInteger(row.completion_tokens)||row.completion_tokens<0)add(f+": bad completion_tokens");
  if(row.parse!=="ok")add(f+": verdict parse not ok ("+row.parse+")");
  arms[arm].push(row);
}

function summarize(rows){
  let correct=0,classified=0,false_pass=0,false_reject=0,unknown=0;
  let cost_usd=0,latency_ms=0,inTok=0,outTok=0;
  for(const r of rows){
    if(r.prediction==="UNKNOWN")unknown++;
    else{classified++;
      if(r.prediction===r.expected)correct++;
      if(r.prediction==="PASS"&&r.expected==="FAIL")false_pass++;
      if(r.prediction==="FAIL"&&r.expected==="PASS")false_reject++;}
    cost_usd+=r.cost_usd;latency_ms+=r.latency_ms;
    inTok+=r.prompt_tokens;outTok+=r.completion_tokens;
  }
  const negatives=[...expected.values()].filter(x=>x==="FAIL").length;
  return {cases:rows.length,correct,classified,accuracy_all_cases:correct/rows.length,
    accuracy_classified:classified?correct/classified:null,
    false_pass,false_pass_rate_on_negatives:false_pass/negatives,
    false_reject,unknown,coverage:classified/rows.length,
    cost_usd,latency_ms,input_tokens:inTok,output_tokens:outTok,
    per_case:rows.map(r=>({case_id:r.case_id,expected:r.expected,prediction:r.prediction,
      match:r.prediction===r.expected,trace_sha256:r.trace_sha256}))};
}
const summary={baseline:summarize(arms.LLM_ONLY),augmented:summarize(arms.LLM_TOOLS)};
summary.deltas={accuracy_all_cases:summary.augmented.accuracy_all_cases-summary.baseline.accuracy_all_cases,
  false_pass:summary.augmented.false_pass-summary.baseline.false_pass,
  unknown:summary.augmented.unknown-summary.baseline.unknown,
  coverage:summary.augmented.coverage-summary.baseline.coverage,
  cost_usd:summary.augmented.cost_usd-summary.baseline.cost_usd,
  latency_ms:summary.augmented.latency_ms-summary.baseline.latency_ms};

// Cross-check 1: arms.json rows must match recomputed traces byte-for-byte.
// Compare keyed by case_id (filename sort order differs from source order).
const armsJson=JSON.parse(readFileSync(join(dir,"arms.json"),"utf8"));
for(const [arm,key] of [["LLM_ONLY","baseline"],["LLM_TOOLS","augmented"]]){
  const obs=armsJson[key].observations;
  if(obs.length!==arms[arm].length)add("arms.json "+arm+" count mismatch");
  const byId=new Map(arms[arm].map(r=>[r.case_id,r]));
  const seen=new Set();
  for(const o of obs){
    const mine=byId.get(o.case_id);
    if(!mine){add("arms.json "+arm+" has case absent from traces: "+o.case_id);continue;}
    seen.add(o.case_id);
    if(o.raw_trace_sha256!==mine.trace_sha256)add("arms.json "+arm+" "+o.case_id+" trace SHA mismatch");
    if(o.prediction!==mine.prediction)add("arms.json "+arm+" "+o.case_id+" prediction mismatch");
    if(Math.abs(o.cost_usd-mine.cost_usd)>1e-9)add("arms.json "+arm+" "+o.case_id+" cost mismatch");
    if(o.input_tokens!==mine.prompt_tokens)add("arms.json "+arm+" "+o.case_id+" input tokens mismatch");
    if(o.output_tokens!==mine.completion_tokens)add("arms.json "+arm+" "+o.case_id+" output tokens mismatch");
    if(o.case_sha256!==sha(JSON.stringify(casesDoc.cases.find(c=>c.id===o.case_id))))
      add("arms.json "+arm+" "+o.case_id+" case_sha256 drift vs frozen source");
  }
  for(const r of arms[arm])if(!seen.has(r.case_id))add("trace "+r.case_id+" missing from arms.json "+arm);
}
// Cross-check 2: frozen scorer on arms.json must agree with my aggregates.
const {scoreHardPairedAB}=await import(pathToFileURL(join(ROOT,"benchmarks/llm-methods/g5/score-ab.mjs")).href);
const scored=scoreHardPairedAB(JSON.stringify(armsJson.baseline),JSON.stringify(armsJson.augmented));
if(scored.status!=="SCORED_UNATTESTED")add("frozen scorer status "+scored.status+": "+(scored.issues||[]).join(";"));
for(const key of ["baseline","augmented"]){
  const s=scored[key],m=summary[key];
  for(const k of ["correct","false_pass","false_reject","unknown","cases","input_tokens","output_tokens"])
    if(s[k]!==m[k])add("scorer disagreement "+key+"."+k+": scorer="+s[k]+" mine="+m[k]);
  if(Math.abs(s.cost_usd-m.cost_usd)>1e-9)add("scorer disagreement "+key+".cost_usd");
}

// Cross-check 3: protocol.json frozen before calls, config = frozen CONFIG.
const protocol=JSON.parse(readFileSync(join(dir,"protocol.json"),"utf8"));
if(protocol.protocol_id!=="g5-hard-r1-20-cases-deepseek-flash-v1")add("protocol_id drift");
if(protocol.calls?.count!==40||protocol.calls?.retries!==0)add("protocol call policy drift");
if(protocol.config?.temperature!==0||protocol.config?.max_output_tokens!==4096)add("protocol config drift");
if(protocol.independent_semantic_oracle!==false||protocol.actual_qualification!=="NOT_RUN")add("protocol qualification drift");

const report={schema:"formal-tools/g5-hard-r1-llm-independent-recompute/0.1",
  generated_at:new Date().toISOString(),
  evidence_dir:basename(dir),traces_reviewed:files.length,
  findings:findings.length?findings:["none"],
  independent_verdict:"RECOMPUTED_FROM_RAW_TRACES",
  summary,status_check:{scorer_status:scored.status,
    scorer_g5_accepted:scored.g5_accepted??null,
    cost_cap_usd:0.5,
    total_cost_usd:summary.baseline.cost_usd+summary.augmented.cost_usd,
    cap_headroom_usd:0.5-(summary.baseline.cost_usd+summary.augmented.cost_usd)}};
writeFileSync(join(dir,"ANALYSIS.json"),JSON.stringify(report,null,2)+"\n");
console.log("traces="+files.length+" findings="+findings.length);
console.log("LLM_ONLY : correct="+summary.baseline.correct+"/20 false_pass="+summary.baseline.false_pass+
  " false_reject="+summary.baseline.false_reject+" unknown="+summary.baseline.unknown+
  " cost=$"+summary.baseline.cost_usd.toFixed(6));
console.log("LLM_TOOLS: correct="+summary.augmented.correct+"/20 false_pass="+summary.augmented.false_pass+
  " false_reject="+summary.augmented.false_reject+" unknown="+summary.augmented.unknown+
  " cost=$"+summary.augmented.cost_usd.toFixed(6));
console.log("scorer_status="+scored.status);
