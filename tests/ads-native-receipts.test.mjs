import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { generateAdsMatrix, scoreAdsMatrix } from "../benchmarks/llm-methods/g3/ads-native-matrix.mjs";

const hash=x=>createHash("sha256").update(x).digest("hex");
const gitBlob=x=>createHash("sha1").update(Buffer.concat([
  Buffer.from("blob "+x.length+"\0"),x])).digest("hex");
// Checkout-agnostic: hash the git-object (LF) byte form, not the working-tree form,
// so autocrlf checkouts on Windows produce the same blob identity as CI Linux.
// Normalization touches only EOL bytes, so any real content edit still fails the comparison.
const gitBytes=x=>Buffer.from(x.toString("utf8").replace(/\r\n/g,"\n"),"utf8");
const receipt=JSON.parse(readFileSync(new URL("../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url),"utf8"));

test("G3 original git bytes and all 24 native replay input hashes match frozen source generator",()=>{
 const fixture=readFileSync(new URL("../benchmarks/llm-methods/r0/spec-fidelity-cases.json",import.meta.url));
 const generator=readFileSync(new URL("../benchmarks/llm-methods/g3/ads-native-matrix.mjs",import.meta.url));
 assert.equal(gitBlob(gitBytes(fixture)),receipt.source_fixture_git_blob);
 assert.equal(gitBlob(gitBytes(generator)),receipt.source_generator_git_blob);
 const matrix=generateAdsMatrix();
 assert.equal(receipt.observations.length,24);
 assert.equal(matrix.entries.length,24);
 for(let i=0;i<24;i++){
   const got=receipt.observations[i],source=matrix.entries[i];
   assert.equal(got.id,source.id);
   assert.equal(got.input_sha256,hash(source.smt2),got.id);
   assert.equal(got.input_sha256,source.input_sha256);
   assert.equal(got.exit_code,0);
   assert.ok(["SAT","UNSAT"].includes(got.status));
   assert.equal(got.z3_status,got.status);
   assert.equal(got.cvc5_status,got.status);
   assert.equal(receipt.stdout_sha256[got.status],hash(got.status.toLowerCase()+"\n"));
 }
});
test("G3 dual-solver real output receipts still cannot certify independent business semantics",()=>{
 const matrix=generateAdsMatrix();
 const outcomes=Object.fromEntries(receipt.observations.map(r=>[r.id,r.status]));
 const score=scoreAdsMatrix(matrix,outcomes);
 assert.equal(score.status,"SCORED_UNATTESTED");
 assert.equal(score.original_claim_verdict,"UNVERIFIED");
 assert.equal(score.independent_oracle_review,"NOT_RUN");
 assert.equal(score.solution_promotable,false);
 for(const record of score.summaries)
   assert.equal(record.diagnostic_classification,receipt.summary.diagnostics[record.model_id]);
 assert.equal(receipt.host.independent_process_attestation,false);
 assert.equal(receipt.scope.synthetic_oracle_independently_certified,false);
 assert.equal(receipt.scope.solution_promotable,false);
 assert.equal(receipt.scope.full_G3_qualification,false);
 assert.equal(receipt.summary.cross_solver_agree,24);
 assert.equal(receipt.solvers.length,2);
 assert.ok(receipt.solvers.every(s=>s.all_24_exit_zero&&s.all_24_stderr_empty));
});
