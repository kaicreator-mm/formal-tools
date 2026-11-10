import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const fixtures = JSON.parse(readFileSync(new URL("../benchmarks/llm-methods/r0/spec-fidelity-cases.json", import.meta.url), "utf8"));

/** Oracle labels are frozen in source-anchored independent fixtures.
 * This interpreter only evaluates a *candidate* spec, never generates its own oracle.
 * Deliberately tiny, deterministic synthetic example; not native or LLM execution.
 */
function satisfies(caseData, constraints){
 const supported=new Set(["valid_windows","acyclic","precedence","writer_exclusive","all_nonoverlap","always_reject"]);
 if(!Array.isArray(constraints)||!constraints.length||new Set(constraints).size!==constraints.length||
   constraints.some(x=>typeof x!=="string"||!supported.has(x)))
   throw new TypeError("unknown, duplicate or missing model constraint");
 const tasks=caseData.tasks;
 const values=Object.values(tasks);
 const edges=caseData.edges;
 if(constraints.includes("always_reject"))return false;
 if(constraints.includes("valid_windows")){
   if(values.some(t=>!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start>=t.end))return false;
 }
 if(constraints.includes("acyclic")){
   const adjacency=new Map(Object.keys(tasks).map(id=>[id,[]]));
   for(const [from,to] of edges){
     if(!adjacency.has(from)||!adjacency.has(to))return false;
     adjacency.get(from).push(to);
   }
   const visiting=new Set(),done=new Set();
   function check(node){
     if(visiting.has(node))return false;
     if(done.has(node))return true;
     visiting.add(node);
     for(const next of adjacency.get(node))if(!check(next))return false;
     visiting.delete(node);done.add(node);
     return true;
   }
   if(![...adjacency.keys()].every(check))return false;
 }
 if(constraints.includes("precedence")&&edges.some(([a,b])=>!tasks[a]||!tasks[b]||tasks[a].end>tasks[b].start))return false;
 if(constraints.includes("writer_exclusive")||constraints.includes("all_nonoverlap")){
   for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){
     const a=values[i],b=values[j];
     const overlap=Math.max(a.start,b.start)<Math.min(a.end,b.end);
     if(overlap && (constraints.includes("all_nonoverlap")||
         (constraints.includes("writer_exclusive")&&a.resource===b.resource)))return false;
   }
 }
 return true;
}

function evaluateModel(model){
 const cases=fixtures.cases.map(c=>{
   const predicted=satisfies(c,model.constraints)?"PASS":"FAIL";
   return {id:c.id,expected:c.expected,predicted,correct:predicted===c.expected};
 });
 const falsePass=cases.filter(c=>c.expected==="FAIL"&&c.predicted==="PASS");
 const falseReject=cases.filter(c=>c.expected==="PASS"&&c.predicted==="FAIL");
 const isVacuous=cases.every(c=>c.predicted==="FAIL");
 const verdict=isVacuous?"REJECT_VACUOUS":falsePass.length?"REJECT_WEAK":falseReject.length?"REJECT_OVERSTRONG":"ACCEPT";
 return {model:model.id,verdict,falsePass,falseReject,cases};
}

test("reference requirements are source anchored and test labels pre-frozen",()=>{
 assert.deepEqual(fixtures.reference_requirements.map(x=>x.id),["R1","R2","R3"]);
 assert.equal(fixtures.cases.length,6);
 assert.equal(fixtures.cases.filter(x=>x.expected==="PASS").length,2);
 assert.equal(fixtures.cases.filter(x=>x.expected==="FAIL").length,4);
 assert.equal(new Set(fixtures.cases.map(x=>x.id)).size,6);
});
test("faithful candidate matches the reference labels",()=>{
 const x=evaluateModel(fixtures.models.find(x=>x.id==="faithful"));
 assert.equal(x.verdict,"ACCEPT");
 assert.equal(x.cases.filter(c=>!c.correct).length,0);
});
test("omitted writer-exclusivity is a false-positive despite satisfying remaining formula",()=>{
 const x=evaluateModel(fixtures.models.find(x=>x.id==="weak-omits-writer"));
 assert.equal(x.verdict,"REJECT_WEAK");
 assert.deepEqual(x.falsePass.map(c=>c.id),["negative-overlap-same-writer"]);
});
test("overstrong exclusion rejects valid independent concurrency",()=>{
 const x=evaluateModel(fixtures.models.find(x=>x.id==="overstrong-global-exclusion"));
 assert.equal(x.verdict,"REJECT_OVERSTRONG");
 assert.deepEqual(x.falseReject.map(c=>c.id),["positive-parallel-distinct-writers"]);
});
test("vacuous contradiction never becomes a proof of source requirements",()=>{
 const x=evaluateModel(fixtures.models.find(x=>x.id==="vacuous-always-false"));
 assert.equal(x.verdict,"REJECT_VACUOUS");
 assert.equal(x.falseReject.length,2);
});
test("all published candidate outcomes are reproducible on the same fixed cases",()=>{
 for(const m of fixtures.models)assert.equal(evaluateModel(m).verdict,m.expect,m.id);
});
test("claim-level evidence is not the same as tool invocation success",()=>{
 const claim={id:"claim-1",kind:"external_fact",source_refs:[],tool_receipt:{exit_code:0,claim_id:"claim-2"}};
 const validLink=claim.source_refs.length>0 && claim.tool_receipt.claim_id===claim.id;
 assert.equal(validLink,false);
 const result=claim.kind==="external_fact"&&claim.source_refs.length===0?"NEEDS_SOURCE":validLink?"SUPPORTED_WITH_SCOPE":"INCONCLUSIVE";
 assert.equal(result,"NEEDS_SOURCE");
});

test("unsupported or duplicate generated constraints are never treated as verified models",()=>{
 const base=fixtures.models.find(x=>x.id==="faithful");
 assert.throws(()=>evaluateModel({...base,constraints:[...base.constraints,"nonexistent_property"]}),/model constraint/);
 assert.throws(()=>evaluateModel({...base,constraints:[...base.constraints,"acyclic"]}),/model constraint/);
 assert.throws(()=>evaluateModel({...base,constraints:[]}),/model constraint/);
});
test("unrelated evidence cannot certify even a claimed symbolic result",()=>{
 const claim={id:"math-equation-1",kind:"symbolic",source_refs:["source#sha256:abc"],model_sha:"model-1"};
 const unrelated={exit_code:0,claim_id:"unrelated-claim",model_sha:"model-1",tool_status:"UNSAT"};
 const wrongModel={exit_code:0,claim_id:claim.id,model_sha:"model-other",tool_status:"UNSAT"};
 const link=receipt=>receipt.claim_id===claim.id && receipt.model_sha===claim.model_sha;
 assert.equal(link(unrelated),false);
 assert.equal(link(wrongModel),false);
 assert.equal(link({exit_code:0,claim_id:claim.id,model_sha:claim.model_sha}),true);
 // Even a matching identity is only evidence association, NOT semantic verification.
 const semanticOracleReviewed=false;
 assert.equal(link({exit_code:0,claim_id:claim.id,model_sha:claim.model_sha})&&semanticOracleReviewed,false);
});
