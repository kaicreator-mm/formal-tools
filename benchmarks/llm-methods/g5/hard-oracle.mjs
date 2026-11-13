/**
 * Issue #11 / G5 hard-r1: independent source-only interpreter for R1/R2/R3.
 *
 * Freeze 20 author-labeled hard cases BEFORE any new native or model trials.
 * This finite interpreter has no LLM, SMT or external credentials. Agreement
 * with these authored labels does not constitute an independent Domain Owner,
 * Product Oracle, or real native SAT/UNSAT attestation.
 */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {renderAdsQuery} from "../g3/ads-native-matrix.mjs";

const sha=x=>createHash("sha256").update(x).digest("hex");
const ID=/^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX=1_000_000;
const validInt=x=>Number.isSafeInteger(x)&&Math.abs(x)<=MAX;
const fail=x=>{throw new TypeError(x);};
const FILE=new URL("./hard-cases-r1.json",import.meta.url);
const CONDITIONS=new Set(["R1","R2","R3"]);
const truth=new Set(["PASS","FAIL"]);

export function readHardCases(){
 const bytes=readFileSync(FILE);
 if(bytes.byteLength>131072)fail("oversized hard source");
 const source_sha256=sha(Buffer.from(bytes.toString("utf8").replace(/\r\n/g,"\n"),"utf8"));
 const doc=JSON.parse(bytes.toString("utf8"));
 if(doc.schema!=="formal-tools/ads-hard-scenarios/0.1"||
    doc.version!=="hard-r1-frozen-before-new-tool-model-experiments"||
    !Array.isArray(doc.cases)||doc.cases.length!==20||
    doc.authority?.independent_semantic_qualification!=="NOT_RUN"||
    doc.authority?.llm_ab_execution!=="NOT_RUN"||
    doc.authority?.native_execution!=="NOT_RUN")
   fail("hard-r1 source authority or count drift");
 const ids=new Set();
 for(const c of doc.cases){
   if(!c||typeof c.id!=="string"||!ID.test(c.id.replaceAll("-","_"))||
      ids.has(c.id)||!truth.has(c.expected)||
      !Array.isArray(c.requirements)||!c.requirements.length||
      c.requirements.some(x=>!CONDITIONS.has(x))||
      !c.tasks||typeof c.tasks!=="object"||Array.isArray(c.tasks)||
      !Array.isArray(c.edges)||c.edges.length>32)
     fail("invalid or duplicate source-authored hard case");
   ids.add(c.id);
   const tasks=Object.entries(c.tasks);
   if(!tasks.length||tasks.length>8||tasks.some(([k,t])=>
      !ID.test(k)||!t||!validInt(t.start)||!validInt(t.end)||
      typeof t.resource!=="string"||!t.resource||t.resource.length>64))
     fail("invalid case tasks or time range");
   const labels=new Set(tasks.map(x=>x[0]));
   if(c.edges.some(e=>!Array.isArray(e)||e.length!==2||
      !labels.has(e[0])||!labels.has(e[1])))
      fail("invalid case dependency");
 }
 return {source_sha256,cases:doc.cases,authority:doc.authority,
   schema:doc.schema,version:doc.version};
}

/** Independent finite oracle, intentionally not reusing SMT constraint code.
 * @param {any} c
 * @returns {"PASS"|"FAIL"}
 */
export function inspectSchedulingSemantics(c){
 const tasks=Object.entries(c.tasks),names=tasks.map(([id])=>id);
 // R3 validity is universal over every task, including isolated vertices.
 for(const [,t] of tasks){
   if(!validInt(t.start)||!validInt(t.end)||t.start>=t.end)return "FAIL";
 }
 // R1 requires every declared predecessor finish before the next start.
 const outgoing=new Map(names.map(k=>[k,[]]));
 for(const [before,after] of c.edges){
   if(!outgoing.has(before)||!outgoing.has(after)||
      c.tasks[before].end>c.tasks[after].start)return "FAIL";
   outgoing.get(before).push(after);
 }
 // Acyclicity proven by finite three-color DFS over the *entire* graph.
 const colors=new Map(names.map(x=>[x,0]));
 function visit(x){
   const seen=colors.get(x);
   if(seen===1)return false;
   if(seen===2)return true;
   colors.set(x,1);
   for(const y of outgoing.get(x))if(!visit(y))return false;
   colors.set(x,2);
   return true;
 }
 if(!names.every(visit))return "FAIL";
 // R2 no same-resource pair may share positive-duration intersection.
 for(let i=0;i<tasks.length;i++)for(let j=i+1;j<tasks.length;j++){
   const a=tasks[i][1],b=tasks[j][1];
   if(a.resource===b.resource &&
      Math.max(a.start,b.start)<Math.min(a.end,b.end))return "FAIL";
 }
 return "PASS";
}

export function buildHardNativeWorklist(){
 const frozen=readHardCases();
 const model={id:"faithful",constraints:["valid_windows","acyclic","precedence","writer_exclusive"]};
 const entries=frozen.cases.map(c=>{
   const smt2=renderAdsQuery(c,model);
   return {id:"faithful__"+c.id,case_id:c.id,
     case_sha256:sha(JSON.stringify(c)),input_sha256:sha(smt2),smt2,
     authored_reference:c.expected,model_id:model.id,tool_status:"NOT_RUN"};
 });
 return {schema:"formal-tools/hard-native-worklist/0.1",
   source_sha256:frozen.source_sha256,entries,
   real_native_executed:false,original_claim:"UNVERIFIED",g5_accepted:false};
}
