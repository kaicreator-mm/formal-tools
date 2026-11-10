import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  readFrozenAdsCases,renderAdsQuery,generateAdsMatrix,scoreAdsMatrix
} from "../benchmarks/llm-methods/g3/ads-native-matrix.mjs";

const fixture=readFrozenAdsCases();
const model=id=>fixture.models.find(x=>x.id===id);
const scenario=id=>fixture.cases.find(x=>x.id===id);
const goodStatus=e=>e.oracle_case_verdict==="PASS"?"SAT":"UNSAT";
const synthetic=(matrix,selected)=>Object.fromEntries(matrix.entries.map(x=>
  [x.id,selected?.[x.id]??goodStatus(x)]));
test("G3 D-ADS: frozen six cases and four models generate 24 stable native requests, never execute",()=>{
 const x=generateAdsMatrix();
 const again=generateAdsMatrix();
 assert.equal(x.entries.length,24);
 assert.deepEqual(x,again);
 assert.equal(x.run_status,"NOT_RUN");
 assert.equal(x.semantic_review,"NOT_RUN");
 assert.equal(x.solution_promotable,false);
 assert.equal(new Set(x.entries.map(r=>r.id)).size,24);
 for(const e of x.entries){
  assert.match(e.smt2,/^\(set-logic QF_LIA\)/);
  assert.match(e.smt2,/\(check-sat\)\n$/);
  assert.match(e.input_sha256,/^[0-9a-f]{64}$/);
  assert.equal(e.input_sha256,createHash("sha256").update(e.smt2).digest("hex"));
  assert.equal(e.native_tool,"z3");
  assert.equal(e.native_operation,"solve");
  assert.equal(e.engine_result,"NOT_RUN");
 }
});
test("G3 D-ADS: faithful writer exclusivity forbids identical-resource overlap",()=>{
 const src=renderAdsQuery(scenario("negative-overlap-same-writer"),model("faithful"));
 assert.match(src,/\(assert \(or \(<= end_A start_B\) \(<= end_B start_A\)\)\)/);
 const weak=renderAdsQuery(scenario("negative-overlap-same-writer"),model("weak-omits-writer"));
 assert.doesNotMatch(weak,/\(assert \(or \(<= end_A start_B\)/);
 assert.doesNotMatch(src,/REJECT_WEAK|false_pass|oracle_case_verdict/);
});
test("G3 D-ADS: independent resources may overlap unless overstrong model forbids it",()=>{
 const source=scenario("positive-parallel-distinct-writers");
 const faithful=renderAdsQuery(source,model("faithful"));
 const overstrong=renderAdsQuery(source,model("overstrong-global-exclusion"));
 assert.doesNotMatch(faithful,/\(assert \(or \(<= end_A start_B\)/);
 assert.match(overstrong,/\(assert \(or \(<= end_A start_B\) \(<= end_B start_A\)\)\)/);
});
test("G3 D-ADS: dependency cycles use solver rank constraints not a JS fabricated verdict",()=>{
 const q=renderAdsQuery(scenario("negative-cycle"),model("faithful"));
 assert.match(q,/\(declare-const rank_A Int\)/);
 assert.match(q,/\(declare-const rank_B Int\)/);
 assert.match(q,/\(assert \(< rank_A rank_B\)\)/);
 assert.match(q,/\(assert \(< rank_B rank_A\)\)/);
 assert.match(q,/\(assert \(<= end_A start_B\)\)/);
});
test("G3 D-ADS: invalid time windows and reversed predecessors become solver inequalities",()=>{
 const q=renderAdsQuery(scenario("negative-zero-duration"),model("faithful"));
 assert.match(q,/\(assert \(= start_A 0\)\)/);
 assert.match(q,/\(assert \(= end_A 0\)\)/);
 assert.match(q,/\(assert \(< start_A end_A\)\)/);
 const p=renderAdsQuery(scenario("negative-predecessor-order"),model("faithful"));
 assert.match(p,/\(assert \(<= end_A start_B\)\)/);
});
test("G3 D-ADS: impossible model emits an explicit contradiction, not solver success",()=>{
 const s=renderAdsQuery(scenario("positive-sequential-same-writer"),model("vacuous-always-false"));
 assert.match(s,/\(assert false\)/);
 assert.doesNotMatch(renderAdsQuery(scenario("positive-sequential-same-writer"),model("faithful")),/\(assert false\)/);
});
test("G3 D-ADS: source-frozen reference examples classify synthetic faithfully observed results but NOT proof",()=>{
 const m=generateAdsMatrix();
 const out=scoreAdsMatrix(m,synthetic(m));
 assert.equal(out.status,"SCORED_UNATTESTED");
 assert.ok(out.summaries.every(x=>x.diagnostic_classification==="MATCHES_FROZEN_SAMPLES_UNATTESTED"));
 assert.equal(out.original_claim_verdict,"UNVERIFIED");
 assert.equal(out.independent_oracle_review,"NOT_RUN");
 assert.equal(out.solution_promotable,false);
});
test("G3 D-ADS: synthetic weak spec is reported false-PASS",()=>{
 const m=generateAdsMatrix();
 const outcomes=synthetic(m);
 outcomes["weak-omits-writer__negative-overlap-same-writer"]="SAT";
 const r=scoreAdsMatrix(m,outcomes).summaries.find(x=>x.model_id==="weak-omits-writer");
 assert.equal(r.diagnostic_classification,"REJECT_WEAK");
 assert.deepEqual(r.false_pass_ids,["weak-omits-writer__negative-overlap-same-writer"]);
});
test("G3 D-ADS: synthetic overstrong spec and vacuous spec never earn acceptance",()=>{
 const m=generateAdsMatrix();
 const outcomes=synthetic(m);
 outcomes["overstrong-global-exclusion__positive-parallel-distinct-writers"]="UNSAT";
 for(const e of m.entries.filter(x=>x.model_id==="vacuous-always-false"))outcomes[e.id]="UNSAT";
 const a=scoreAdsMatrix(m,outcomes).summaries;
 assert.equal(a.find(x=>x.model_id==="overstrong-global-exclusion").diagnostic_classification,"REJECT_OVERSTRONG");
 assert.equal(a.find(x=>x.model_id==="vacuous-always-false").diagnostic_classification,"REJECT_VACUOUS");
});
test("G3 D-ADS: UNKNOWN, ERROR, TIMEOUT and absent reports stay inconclusive",()=>{
 const m=generateAdsMatrix();
 for(const state of ["UNKNOWN","ERROR","TIMEOUT","NOT_RUN"]){
  const outputs=synthetic(m);
  outputs[m.entries[0].id]=state;
  const r=scoreAdsMatrix(m,outputs).summaries.find(x=>x.model_id===m.entries[0].model_id);
  assert.equal(r.diagnostic_classification,"INCONCLUSIVE");
  assert.equal(r.observed,5);
 }
 const only=scoreAdsMatrix(m,{}).summaries;
 assert.ok(only.every(x=>x.diagnostic_classification==="INCONCLUSIVE"));
});
test("G3 D-ADS: malformed candidate IDs, unknown predicates and oversized edges are rejected",()=>{
 const c=structuredClone(scenario("negative-overlap-same-writer"));
 c.edges=Array(33).fill(["A","B"]);
 assert.throws(()=>renderAdsQuery(c,model("faithful")),/edges/);
 const bad=structuredClone(model("faithful"));bad.constraints.push("unsafe_shell");
 assert.throws(()=>renderAdsQuery(scenario("negative-overlap-same-writer"),bad),/constraints/);
 const src=structuredClone(scenario("negative-zero-duration"));src.tasks.A.start=NaN;
 assert.throws(()=>renderAdsQuery(src,model("faithful")),/task/);
});
test("G3 D-ADS: forged native statuses cannot silently become business acceptance",()=>{
 const m=generateAdsMatrix();
 const values=synthetic(m);values[m.entries[0].id]="PROVED";
 assert.throws(()=>scoreAdsMatrix(m,values),/unrecognized native solver outcome/);
});


test("G3 D-ADS: scoring cannot be cheated by rewriting frozen reference verdicts or solver input",()=>{
 const m=generateAdsMatrix();
 const forged=structuredClone(m);
 forged.entries[0].oracle_case_verdict="PASS";
 if(m.entries[0].oracle_case_verdict==="PASS")forged.entries[0].oracle_case_verdict="FAIL";
 assert.throws(()=>scoreAdsMatrix(forged,{}),/source-frozen/);
 const different=structuredClone(m);
 different.entries[0].smt2+="(assert false)\n";
 assert.throws(()=>scoreAdsMatrix(different,{}),/source-frozen/);
});
test("G3 D-ADS: known false-PASS is not concealed by another unavailable solver outcome",()=>{
 const m=generateAdsMatrix();
 const outs=synthetic(m);
 outs["weak-omits-writer__negative-overlap-same-writer"]="SAT";
 outs["weak-omits-writer__positive-sequential-same-writer"]="NOT_RUN";
 const a=scoreAdsMatrix(m,outs).summaries.find(x=>x.model_id==="weak-omits-writer");
 assert.equal(a.diagnostic_classification,"REJECT_WEAK");
 assert.equal(a.observed,5);
 assert.equal(a.false_pass_ids.length,1);
 assert.equal(scoreAdsMatrix(m,outs).original_claim_verdict,"UNVERIFIED");
});
test("G3 D-ADS: extra result keys and getter-based native statuses are refused",()=>{
 const m=generateAdsMatrix();
 assert.throws(()=>scoreAdsMatrix(m,{"not-a-frozen-case":"SAT"}),/accessor key/);
 const x={};
 Object.defineProperty(x,m.entries[0].id,{get(){return "SAT";},enumerable:true});
 assert.throws(()=>scoreAdsMatrix(m,x),/accessor key/);
});
