/**
 * Issue #11 / G3→G6 independent-algorithm finite semantics verifier.
 *
 * The frozen source's R1/R2/R3 meaning is interpreted directly as a graph,
 * intervals and resource identities; this module DOES NOT parse or execute
 * any SMT-LIB expression and does not use frozen expected labels as its oracle.
 * It crosschecks the PREVIOUSLY EXECUTED 24×2 native receipt and current JS
 * source generator bytes; it does not claim a new solver invocation, external
 * Product Owner, independent professional Oracle or attested Host.
 */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {generateAdsMatrix} from "./ads-native-matrix.mjs";

const SHA=/^[a-f0-9]{64}$/;
const FROZEN=new URL("../r0/spec-fidelity-cases.json",import.meta.url);
const GENERATOR=new URL("./ads-native-matrix.mjs",import.meta.url);
const PAIR=new URL("../../../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url);
// This is the previously accepted original immutable G3 receipt, not a
// freshly collected Host signature. The Git identity is verified separately
// from all caller-copyable metadata inside that JSON.
export const HISTORICAL_NATIVE_PAIR_GIT_BLOB="cee8f188cce20b042df505f824cccae64d2c9b1c";
const MODEL_TERMS=new Set(["valid_windows","acyclic","precedence","writer_exclusive","all_nonoverlap","always_reject"]);
const PINNED_EXECUTABLES=Object.freeze({
 z3:{version:"5.4.0",sha256:"e9d7e6e6d76c81b5ea3f06d165fc4cfd8afab92b74cdf94417380b5eed10845d"},
 cvc5:{version:"1.4.2",sha256:"6aecddf466552b83bb5883756c7955e0c9d5ddcc6d7f45b48c2f6e06a741b102"}
});
const sha256=x=>createHash("sha256").update(x).digest("hex");
const gitBytes=x=>Buffer.from(x.toString("utf8").replace(/\r\n/g,"\n"),"utf8");
const gitBlob=x=>createHash("sha1").update(Buffer.concat([Buffer.from("blob "+x.length+"\0"),x])).digest("hex");
const plain=x=>x!==null&&typeof x==="object"&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const demand=(yes,message)=>{if(!yes)throw Error(message);};
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;

/**
 * Reference interpretation of a bounded case, independent of SMT generator.
 * It evaluates the model constraints themselves, never the authored label.
 * @param {any} scenario
 * @param {any} constraints
 */
export function finiteAdsSemantics(scenario,constraints){
 demand(plain(scenario)&&plain(scenario.tasks)&&Array.isArray(scenario.edges),"INVALID_CASE");
 demand(Array.isArray(constraints)&&constraints.length>0&&constraints.length<=MODEL_TERMS.size&&
   new Set(constraints).size===constraints.length&&constraints.every(x=>MODEL_TERMS.has(x)),
   "INVALID_MODEL");
 const entries=Object.entries(scenario.tasks);
 demand(entries.length>0&&entries.length<=8,"INVALID_TASK_COUNT");
 const names=new Set(entries.map(([name])=>name));
 for(const [name,t] of entries)demand(/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)&&
   plain(t)&&Number.isSafeInteger(t.start)&&Number.isSafeInteger(t.end)&&
   Math.abs(t.start)<=1000000&&Math.abs(t.end)<=1000000&&
   typeof t.resource==="string"&&t.resource.length<=64,"INVALID_TASK");
 demand(scenario.edges.length<=32,"INVALID_EDGES");
 for(const edge of scenario.edges)demand(Array.isArray(edge)&&edge.length===2&&
   names.has(edge[0])&&names.has(edge[1]),"INVALID_EDGE");
 const active=new Set(constraints);
 if(active.has("always_reject"))return false;
 if(active.has("valid_windows")&&entries.some(([,t])=>t.start>=t.end))return false;
 if(active.has("acyclic")){
   const adjacent=new Map(entries.map(([name])=>[name,[]]));
   for(const [a,b] of scenario.edges)adjacent.get(a).push(b);
   const visited=new Set(),visiting=new Set();
   function dfs(name){
     if(visiting.has(name))return false;
     if(visited.has(name))return true;
     visiting.add(name);
     for(const next of adjacent.get(name))if(!dfs(next))return false;
     visiting.delete(name);visited.add(name);return true;
   }
   for(const name of names)if(!dfs(name))return false;
 }
 if(active.has("precedence")&&scenario.edges.some(([a,b])=>
   scenario.tasks[a].end>scenario.tasks[b].start))return false;
 for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
   const a=entries[i][1],b=entries[j][1];
   if(overlap(a,b)&&(active.has("all_nonoverlap")||
       (active.has("writer_exclusive")&&a.resource===b.resource)))return false;
 }
 return true;
}
const blocked=reason=>Object.freeze({status:"BLOCKED",reason,
  technical_source_check:false,real_native_execution_this_run:false,
  independently_attested_host:false,independent_professional_oracle:false,
  g3_full_qualified:false,qualified_solution:false});
/**
 * Pure adversarial binder for original frozen inputs and recorded native
 * outcomes. All arguments may be hostile test mutations: no caller-supplied
 * expected oracle verdict can be treated as authority.
 * @param {{fixture:any,matrix:any,receipt:any,fixture_bytes:Buffer,generator_bytes:Buffer}} args
 * @returns {any}
 */
export function compareFrozenFiniteNative({fixture,matrix,receipt,fixture_bytes,generator_bytes}){
 try{
   demand(plain(fixture)&&Array.isArray(fixture.cases)&&fixture.cases.length===6&&
     Array.isArray(fixture.models)&&fixture.models.length===4,"FROZEN_CASE_MODEL_COUNT");
   demand(Buffer.isBuffer(fixture_bytes)&&Buffer.isBuffer(generator_bytes)&&plain(receipt),"INVALID_SOURCE");
   demand(gitBlob(gitBytes(fixture_bytes))===receipt.source_fixture_git_blob&&
     gitBlob(gitBytes(generator_bytes))===receipt.source_generator_git_blob,
     "SOURCE_GIT_BLOB_MISMATCH");
   demand(JSON.stringify(JSON.parse(fixture_bytes.toString("utf8")))===JSON.stringify(fixture),
     "FROZEN_FIXTURE_ARGUMENT_DRIFT");
   demand(matrix?.schema==="formal-tools/ads-native-matrix/0.1"&&
     Array.isArray(matrix.entries)&&matrix.entries.length===24,
     "MATRIX_MISSING");
   demand(receipt.schema==="formal-tools/ads24-native-pair/0.1"&&
     Array.isArray(receipt.observations)&&receipt.observations.length===24,
     "NATIVE_RECEIPT_MISSING");
   demand(Array.isArray(receipt.solvers)&&receipt.solvers.length===2&&
     Object.keys(PINNED_EXECUTABLES).every(id=>{
       const matches=receipt.solvers.filter(s=>s.id===id);
       return matches.length===1&&matches[0].version===PINNED_EXECUTABLES[id].version&&
         matches[0].executable_sha256===PINNED_EXECUTABLES[id].sha256&&
         matches[0].all_24_exit_zero===true&&matches[0].all_24_stderr_empty===true;
     }),"NATIVE_TOOL_PROVENANCE_DRIFT");
   const statuses=new Map([["SAT","sat\n"],["UNSAT","unsat\n"]]);
   for(const [status,text] of statuses)demand(receipt.stdout_sha256?.[status]===sha256(text),
     "NATIVE_STDOUT_PIN_MISMATCH");
   const index=new Map();
   for(const m of fixture.models)for(const c of fixture.cases){
     demand(typeof m.id==="string"&&typeof c.id==="string","MISSING_CASE_ID");
     demand(!index.has(m.id+"__"+c.id),"DUPLICATE_SOURCE_CASE");
     index.set(m.id+"__"+c.id,{scenario:c,constraints:m.constraints,model:m.id});
   }
   demand(index.size===24,"FROZEN_MODEL_CROSS_PRODUCT");
   const faithful=fixture.models.find(m=>m.id==="faithful");
   demand(faithful,"NO_FAITHFUL_MODEL");
   const reference=[];
   for(const c of fixture.cases){
     const recomputed=finiteAdsSemantics(c,faithful.constraints)?"PASS":"FAIL";
     demand(c.expected===recomputed,"ORIGINAL_CASE_LABEL_MISMATCH:"+c.id);
     reference.push({case_id:c.id,recomputed});
   }
   let sat=0,unsat=0;
   const perModel=Object.create(null),seen=new Set();
   for(let i=0;i<matrix.entries.length;i++){
     const e=matrix.entries[i],r=receipt.observations[i];
     demand(e&&r&&typeof e.id==="string"&&e.id===r.id&&
       e.id===e.model_id+"__"+e.case_id,"NATIVE_PAIR_ORDER_ID_MISMATCH");
     demand(!seen.has(e.id)&&index.has(e.id),"NATIVE_PAIR_DUPLICATE_OR_UNKNOWN_CASE");
     seen.add(e.id);
     const spec=index.get(e.id);
     demand(spec.model===e.model_id&&spec.scenario.id===e.case_id,
       "CASE_MODEL_BIND_MISMATCH");
     demand(typeof e.smt2==="string"&&SHA.test(e.input_sha256)&&
       e.input_sha256===sha256(e.smt2)&&r.input_sha256===e.input_sha256,
       "NATIVE_INPUT_BYTES_MISMATCH:"+e.id);
     const expected=finiteAdsSemantics(spec.scenario,spec.constraints)?"SAT":"UNSAT";
     demand(r.status===expected&&r.z3_status===expected&&r.cvc5_status===expected&&
       r.exit_code===0,"SOURCE_VS_NATIVE_DISAGREEMENT:"+e.id);
     if(expected==="SAT")sat++;else unsat++;
     const group=perModel[spec.model]??={sat:0,unsat:0};
     group[expected.toLowerCase()]++;
   }
   demand(seen.size===24&&sat===6&&unsat===18,"NATIVE_COVERAGE_OR_COUNTS");
   return Object.freeze({
     schema:"formal-tools/ads24-independent-finite-verification/0.1",
     status:"SCORED_INDEPENDENT_ALGORITHM_UNATTESTED",
     frozen_source_git_blob:receipt.source_fixture_git_blob,
     generator_source_git_blob:receipt.source_generator_git_blob,
     native_pair_git_blob:HISTORICAL_NATIVE_PAIR_GIT_BLOB,
     cases_checked:6,model_queries_checked:24,
     historically_executed_native_observations:48,
     native_tool_versions:PINNED_EXECUTABLES,
     recomputed_reference:reference,
     per_model:perModel,
     technical_source_check:true,
     real_native_execution_this_run:false,
     independently_attested_host:false,
     independent_professional_oracle:false,
     claim_result:"UNVERIFIED",g3_full_qualified:false,
     qualified_solution:false,replay_allowed:false,g6_accepted:false
   });
 }catch(err){return blocked(String(err?.message??err));}
}
/** Read only committed frozen source + existing G3 native pair; NO solver rerun.
 * @returns {any}
 */
export function verifyHistoricalAds24(){
 const fixture_bytes=readFileSync(FROZEN),generator_bytes=readFileSync(GENERATOR);
 const receipt_bytes=readFileSync(PAIR);
 if(gitBlob(gitBytes(receipt_bytes))!==HISTORICAL_NATIVE_PAIR_GIT_BLOB)
   return blocked("ORIGINAL_NATIVE_PAIR_GIT_BLOB_DRIFT");
 return compareFrozenFiniteNative({
   fixture:JSON.parse(fixture_bytes.toString("utf8")),
   matrix:generateAdsMatrix(),
   receipt:JSON.parse(receipt_bytes.toString("utf8")),
   fixture_bytes,generator_bytes
 });
}
