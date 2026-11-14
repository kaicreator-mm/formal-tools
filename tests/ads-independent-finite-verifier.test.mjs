import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {generateAdsMatrix} from "../benchmarks/llm-methods/g3/ads-native-matrix.mjs";
import {finiteAdsSemantics,compareFrozenFiniteNative,verifyHistoricalAds24}
 from "../benchmarks/llm-methods/g3/independent-finite-verifier.mjs";

const fixture_bytes=readFileSync(new URL("../benchmarks/llm-methods/r0/spec-fidelity-cases.json",import.meta.url));
const generator_bytes=readFileSync(new URL("../benchmarks/llm-methods/g3/ads-native-matrix.mjs",import.meta.url));
const originalReceipt=JSON.parse(readFileSync(new URL("../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url),"utf8"));
const make=()=>({fixture:JSON.parse(fixture_bytes.toString("utf8")),
 matrix:structuredClone(generateAdsMatrix()),receipt:structuredClone(originalReceipt),
 fixture_bytes,generator_bytes});
const check=x=>compareFrozenFiniteNative(x);
const fail=(x,contains)=>{
 const result=check(x);
 assert.equal(result.status,"BLOCKED",JSON.stringify(result));
 assert.match(result.reason,new RegExp(contains));
 assert.equal(result.qualified_solution,false);
 assert.equal(result.independent_professional_oracle,false);
};

test("G3 original R1/R2/R3 semantics independently cover 6 source cases and 24 recorded dual Native observations",()=>{
 const report=verifyHistoricalAds24();
 assert.equal(report.status,"SCORED_INDEPENDENT_ALGORITHM_UNATTESTED",JSON.stringify(report));
 assert.equal(report.cases_checked,6);
 assert.equal(report.model_queries_checked,24);
 assert.equal(report.historically_executed_native_observations,48);
 assert.deepEqual(report.per_model.faithful,{sat:2,unsat:4});
 assert.deepEqual(report.per_model["weak-omits-writer"],{sat:3,unsat:3});
 assert.deepEqual(report.per_model["overstrong-global-exclusion"],{sat:1,unsat:5});
 assert.deepEqual(report.per_model["vacuous-always-false"],{sat:0,unsat:6});
 assert.equal(report.real_native_execution_this_run,false);
 assert.equal(report.claim_result,"UNVERIFIED");
 assert.equal(report.independent_professional_oracle,false);
 assert.equal(report.independently_attested_host,false);
 assert.equal(report.qualified_solution,false);
 assert.equal(report.g6_accepted,false);
});
test("G3 finite verifier is logically independent of SMT: graph cycle, exact writer identity, strict interval and weakened/overstrong controls",()=>{
 const x=make().fixture;
 const one=id=>structuredClone(x.cases.find(c=>c.id===id));
 const model=id=>x.models.find(m=>m.id===id).constraints;
 assert.equal(finiteAdsSemantics(one("positive-parallel-distinct-writers"),model("faithful")),true);
 assert.equal(finiteAdsSemantics(one("positive-parallel-distinct-writers"),model("overstrong-global-exclusion")),false);
 assert.equal(finiteAdsSemantics(one("negative-overlap-same-writer"),model("faithful")),false);
 assert.equal(finiteAdsSemantics(one("negative-overlap-same-writer"),model("weak-omits-writer")),true);
 assert.equal(finiteAdsSemantics(one("negative-cycle"),model("faithful")),false);
 assert.equal(finiteAdsSemantics(one("negative-predecessor-order"),model("faithful")),false);
 assert.equal(finiteAdsSemantics(one("negative-zero-duration"),model("faithful")),false);
 let mutated=one("positive-parallel-distinct-writers");
 mutated.tasks.B.resource=mutated.tasks.A.resource;
 assert.equal(finiteAdsSemantics(mutated,model("faithful")),false);
 mutated=one("positive-parallel-distinct-writers");
 mutated.tasks.B.resource="R1";
 assert.equal(finiteAdsSemantics(mutated,model("faithful")),true);
 mutated=one("positive-sequential-same-writer");
 mutated.tasks.B.start=1;
 assert.equal(finiteAdsSemantics(mutated,model("faithful")),false);
 assert.throws(()=>finiteAdsSemantics(mutated,["unknown_predicate"]),/INVALID_MODEL/);
});
test("G3 prevents BOTH native engines agreeing on same wrong classification",()=>{
 const x=make();const row=x.receipt.observations.find(x=>x.id==="faithful__positive-sequential-same-writer");
 assert.equal(row.status,"SAT");
 row.status="UNSAT";row.z3_status="UNSAT";row.cvc5_status="UNSAT";
 fail(x,"SOURCE_VS_NATIVE_DISAGREEMENT");
});
test("G3 rejects authored oracle label mutation even if a source author calls it PASS",()=>{
 const x=make();x.fixture.cases.find(c=>c.id==="negative-overlap-same-writer").expected="PASS";
 // Simulate a hostile author re-pinning a changed source, not just a stale object.
 x.fixture_bytes=Buffer.from(JSON.stringify(x.fixture));
 x.receipt.source_fixture_git_blob=createHash("sha1").update(Buffer.concat([
   Buffer.from("blob "+x.fixture_bytes.length+"\0"),x.fixture_bytes])).digest("hex");
 fail(x,"ORIGINAL_CASE_LABEL_MISMATCH");
});
test("G3 rejects input hash drift, swapped case order and dropped observations",()=>{
 let x=make();x.receipt.observations[0].input_sha256="0".repeat(64);
 fail(x,"NATIVE_INPUT_BYTES_MISMATCH");
 x=make();[x.receipt.observations[0],x.receipt.observations[1]]=
    [x.receipt.observations[1],x.receipt.observations[0]];
 fail(x,"NATIVE_PAIR_ORDER_ID_MISMATCH");
 x=make();x.receipt.observations.pop();fail(x,"NATIVE_RECEIPT_MISSING");
});
test("G3 rejects tool identity/version drift, exit failures, missing stdout and bad source bytes",()=>{
 let x=make();x.receipt.solvers[0].executable_sha256="a".repeat(64);
 fail(x,"NATIVE_TOOL_PROVENANCE_DRIFT");
 x=make();x.receipt.solvers[1].version="changed";
 fail(x,"NATIVE_TOOL_PROVENANCE_DRIFT");
 x=make();x.receipt.observations[0].exit_code=1;
 fail(x,"SOURCE_VS_NATIVE_DISAGREEMENT");
 x=make();x.receipt.stdout_sha256.SAT="a".repeat(64);
 fail(x,"NATIVE_STDOUT_PIN_MISMATCH");
 x=make();x.fixture_bytes=Buffer.concat([x.fixture_bytes,Buffer.from("\n")]);
 fail(x,"SOURCE_GIT_BLOB_MISMATCH");
});
test("G3 fixture reference status cannot independently qualify Source/Oracle/Host/Replay",()=>{
 const s=verifyHistoricalAds24();
 assert.equal(s.technical_source_check,true);
 assert.equal(s.qualified_solution,false);
 assert.equal(s.replay_allowed,false);
 assert.equal(s.g3_full_qualified,false);
 assert.equal(s.independent_professional_oracle,false);
 assert.equal(s.independently_attested_host,false);
});
