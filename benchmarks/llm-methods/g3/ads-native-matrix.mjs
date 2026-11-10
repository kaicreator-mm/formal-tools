/**
 * Issue #11 / G3 D-ADS: deterministic source-first SMT-LIB query generator.
 *
 * This file NEVER executes a proof engine and NEVER certifies business claims.
 * It makes 24 candidate-vs-frozen-case queries reproducible for the existing
 * native z3 typed operation. Only real host receipts can record SAT/UNSAT.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT=resolve(fileURLToPath(new URL("../r0/spec-fidelity-cases.json",import.meta.url)));
const CONSTRAINTS=new Set(["valid_windows","acyclic","precedence","writer_exclusive","all_nonoverlap","always_reject"]);
const ID=/^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const allowedStatuses=new Set(["SAT","UNSAT","UNKNOWN","ERROR","TIMEOUT","NOT_RUN"]);
const digest=s=>createHash("sha256").update(s).digest("hex");
const integer=n=>n<0?"(- "+Math.abs(n)+")":String(n);
const validTime=n=>Number.isSafeInteger(n)&&Math.abs(n)<=1000000;
const assert=(check,message)=>{if(!check)throw new TypeError(message);};

export function readFrozenAdsCases(){
 const json=JSON.parse(readFileSync(ROOT,"utf8"));
 assert(json.schema==="formal-tools/semantic-spec-cases/0.1","unexpected frozen case schema");
 assert(Array.isArray(json.cases)&&json.cases.length===6,"expected frozen six cases");
 assert(Array.isArray(json.models)&&json.models.length===4,"expected four candidate models");
 return json;
}

/**
 * Compile independent fixed case facts and a candidate model's logic into
 * QF_LIA. Model constraints, not oracle expected labels, determine clauses.
 * @param {any} scenario
 * @param {any} candidate
 */
export function renderAdsQuery(scenario,candidate){
 assert(scenario&&typeof scenario==="object"&&!Array.isArray(scenario),"case required");
 assert(candidate&&typeof candidate==="object","candidate required");
 assert(ID.test(scenario.id?.replaceAll("-","_")??""),"case ID invalid");
 assert(ID.test(candidate.id?.replaceAll("-","_")??""),"candidate ID invalid");
 const terms=candidate.constraints;
 assert(Array.isArray(terms)&&terms.length>0&&terms.length<=CONSTRAINTS.size&&
   new Set(terms).size===terms.length&&terms.every(x=>CONSTRAINTS.has(x)),
   "unknown/duplicate candidate constraints");
 const facts=scenario.tasks;
 assert(facts&&typeof facts==="object"&&!Array.isArray(facts),"task map required");
 const entries=Object.entries(facts);
 assert(entries.length>0&&entries.length<=8&&entries.every(([name,t])=>
   ID.test(name)&&t&&validTime(t.start)&&validTime(t.end)&&
   typeof t.resource==="string"&&t.resource.length<=64),"invalid task/time/resource");
 const names=new Set(entries.map(([name])=>name));
 const edges=scenario.edges;
 assert(Array.isArray(edges)&&edges.length<=32&&edges.every(e=>Array.isArray(e)&&
   e.length===2&&names.has(e[0])&&names.has(e[1])),"unknown or excess edges");

 const lines=["(set-logic QF_LIA)"];
 for(const [name,t] of entries){
   lines.push("(declare-const start_"+name+" Int)","(declare-const end_"+name+" Int)",
     "(assert (= start_"+name+" "+integer(t.start)+"))",
     "(assert (= end_"+name+" "+integer(t.end)+"))");
 }
 if(terms.includes("valid_windows"))
   for(const [name] of entries)lines.push("(assert (< start_"+name+" end_"+name+"))");
 if(terms.includes("acyclic")){
   for(const [name] of entries)lines.push("(declare-const rank_"+name+" Int)");
   for(const [a,b] of edges)lines.push("(assert (< rank_"+a+" rank_"+b+"))");
 }
 if(terms.includes("precedence"))
   for(const [a,b] of edges)lines.push("(assert (<= end_"+a+" start_"+b+"))");
 for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
   const [a,at]=entries[i],[b,bt]=entries[j];
   const both=terms.includes("all_nonoverlap");
   const same=terms.includes("writer_exclusive")&&at.resource===bt.resource;
   if(both||same)lines.push("(assert (or (<= end_"+a+" start_"+b+
     ") (<= end_"+b+" start_"+a+")))");
 }
 if(terms.includes("always_reject"))lines.push("(assert false)");
 lines.push("(check-sat)");
 return lines.join("\n")+"\n";
}

/**
 * Deterministic worklist. All 24 queries are GENERATED, never run here.
 * The original frozen verdict is retained as an oracle reference only.
 */
export function generateAdsMatrix(){
 const fixtures=readFrozenAdsCases();
 assert(Array.isArray(fixtures.models)&&fixtures.models.length<=16&&
        Array.isArray(fixtures.cases)&&fixtures.cases.length<=32,
        "unbounded ADS matrix");
 const entries=[];
 for(const model of fixtures.models)for(const scenario of fixtures.cases){
   const smt2=renderAdsQuery(scenario,model);
   entries.push({
     id:model.id+"__"+scenario.id,
     case_id:scenario.id,model_id:model.id,
     oracle_case_verdict:scenario.expected,
     input_sha256:digest(smt2),
     native_tool:"z3",native_operation:"solve",
     engine_result:"NOT_RUN",
     smt2
   });
 }
 return {schema:"formal-tools/ads-native-matrix/0.1",source_case_sha256:digest(readFileSync(ROOT)),
   entries,run_status:"NOT_RUN",semantic_review:"NOT_RUN",solution_promotable:false};
}

/**
 * Score recorded native statuses strictly against pre-frozen case verdicts.
 * Unknown/timeout/error stays inconclusive. No process/byte attestations here.
 * @param {any} matrix
 * @param {any} outcomes - exact entry ID to SAT|UNSAT|UNKNOWN|ERROR|TIMEOUT|NOT_RUN
 */
export function scoreAdsMatrix(matrix,outcomes){
 const frozen=generateAdsMatrix();
 assert(matrix&&matrix.schema===frozen.schema&&
   matrix.source_case_sha256===frozen.source_case_sha256&&
   Array.isArray(matrix.entries)&&matrix.entries.length===frozen.entries.length&&
   matrix.entries.every((e,i)=>e&&Object.entries(frozen.entries[i]).every(
     ([key,value])=>e[key]===value)),
   "matrix differs from source-frozen exact query/worklist");
 assert(outcomes&&typeof outcomes==="object"&&!Array.isArray(outcomes)&&
   (Object.getPrototypeOf(outcomes)===null||Object.getPrototypeOf(outcomes)===Object.prototype),
   "native outcomes must be a plain map");
 const allowedIds=new Set(frozen.entries.map(e=>e.id));
 assert(Reflect.ownKeys(outcomes).every(k=>typeof k==="string"&&allowedIds.has(k)&&
   Object.hasOwn(Object.getOwnPropertyDescriptor(outcomes,k),"value")),
   "unexpected/native-result accessor key");
 const records=[];
 for(const e of frozen.entries){
   assert(typeof e.id==="string"&&typeof e.model_id==="string"&&
     ["PASS","FAIL"].includes(e.oracle_case_verdict),"invalid matrix entry");
   const raw=Object.hasOwn(outcomes,e.id)?outcomes[e.id]:"NOT_RUN";
   assert(allowedStatuses.has(raw),"unrecognized native solver outcome: "+e.id);
   const predicted=raw==="SAT"?"PASS":raw==="UNSAT"?"FAIL":null;
   const falsePass=predicted==="PASS"&&e.oracle_case_verdict==="FAIL";
   const falseReject=predicted==="FAIL"&&e.oracle_case_verdict==="PASS";
   records.push({id:e.id,model_id:e.model_id,native_status:raw,
     reference:e.oracle_case_verdict,prediction:predicted,
     false_pass:falsePass,false_reject:falseReject});
 }
 const summaries=[];
 for(const modelId of [...new Set(records.map(r=>r.model_id))]){
   const group=records.filter(r=>r.model_id===modelId);
   const classified=group.filter(r=>r.prediction!==null);
   const badPass=group.filter(r=>r.false_pass).map(r=>r.id);
   const badReject=group.filter(r=>r.false_reject).map(r=>r.id);
   const vacuous=classified.length===group.length&&group.every(r=>r.prediction==="FAIL");
   // A confirmed false-PASS is decisive even when another case is missing.
   // Incomplete results must never conceal a known dangerous classification.
   const kind=badPass.length?"REJECT_WEAK":
     vacuous?"REJECT_VACUOUS":
     badReject.length?"REJECT_OVERSTRONG":
     classified.length<group.length?"INCONCLUSIVE":"MATCHES_FROZEN_SAMPLES_UNATTESTED";
   summaries.push({model_id:modelId,diagnostic_classification:kind,
     observed:classified.length,total:group.length,false_pass_ids:badPass,
     false_reject_ids:badReject});
 }
 return {status:"SCORED_UNATTESTED",summaries,
   raw_native_execution:"NOT_ATTESTED_BY_THIS_FUNCTION",
   original_claim_verdict:"UNVERIFIED",independent_oracle_review:"NOT_RUN",
   solution_promotable:false};
}

export function emitAdsMatrix(directory){
 assert(typeof directory==="string"&&directory.length>0,"output directory required");
 const output=resolve(directory);
 const matrix=generateAdsMatrix();
 mkdirSync(output,{recursive:true});
 const files=[];
 for(const entry of matrix.entries){
   const path=join(output,entry.id+".smt2");
   writeFileSync(path,entry.smt2,{encoding:"utf8",flag:"w"});
   files.push({id:entry.id,file:entry.id+".smt2",input_sha256:entry.input_sha256,
     oracle_case_verdict:entry.oracle_case_verdict,native_tool:entry.native_tool,
     native_operation:entry.native_operation});
 }
 const index={schema:matrix.schema,source_case_sha256:matrix.source_case_sha256,
   files,run_status:"NOT_RUN",original_claim_verdict:"UNVERIFIED",
   solution_promotable:false};
 writeFileSync(join(output,"manifest.json"),JSON.stringify(index,null,2)+"\n");
 return index;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw new TypeError("Usage: node ads-native-matrix.mjs OUTPUT_DIRECTORY");
 const result=emitAdsMatrix(process.argv[2]);
 process.stdout.write("Emitted "+result.files.length+
   " source-anchored Z3 candidate queries; NATIVE_EXECUTION=NOT_RUN\n");
}
