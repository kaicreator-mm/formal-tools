import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { interpretNativeObservation } from "../packages/runner/js/native.mjs";

test("Dafny SDK adapter distinguishes verified output from verifier rejection",()=>{
  const pos=interpretNativeObservation("dafny","Dafny program verifier finished with 1 verified, 0 errors","",0);
  assert.equal(pos.tool_outcome,"VERIFIED");
  assert.equal(pos.process_outcome,"EXIT_ZERO");
  assert.equal(pos.test_verdict,"NOT_EVALUATED");
  assert.equal(pos.claim_verdict,"NOT_EVALUATED");

  const neg=interpretNativeObservation("dafny","Error: a postcondition could not be proved\nDafny program verifier finished with 0 verified, 1 error","",4);
  assert.equal(neg.tool_outcome,"VERIFICATION_ERROR");
  assert.equal(neg.process_outcome,"NONZERO_EXIT");
  assert.equal(neg.test_verdict,"NOT_EVALUATED");
  assert.equal(neg.claim_verdict,"NOT_EVALUATED");
});

test("Dafny SDK adapter identifies parse errors and fails closed on unrelated failures",()=>{
  const err=interpretNativeObservation("dafny","2 parse errors detected in err.dfy","",2);
  assert.equal(err.tool_outcome,"PARSE_ERROR");
  assert.equal(err.process_outcome,"NONZERO_EXIT");

  const zeroErrors=interpretNativeObservation("dafny","0 parse errors detected in err.dfy","",2);
  assert.equal(zeroErrors.tool_outcome,"UNPARSED");
  assert.equal(zeroErrors.process_outcome,"NONZERO_EXIT");
  assert.equal(zeroErrors.test_verdict,"NOT_EVALUATED");
  assert.equal(zeroErrors.claim_verdict,"NOT_EVALUATED");

  for(const [output,exit] of [
    ["timeout while starting runtime",124],
    ["Error: failed to load a runtime library",134],
    ["Dafny program verifier finished with 0 verified, 1 error",0],
    ["Dafny program verifier finished with 1 verified, 0 errors",4],
    ["2 parse errors detected in err.dfy",4]
  ]) assert.equal(interpretNativeObservation("dafny",output,"",exit).tool_outcome,"UNPARSED");
});

test("Dafny portable Runner fixture contract pins POS/NEG/ERR exits and narrow diagnostics",async()=>{
  const text=await readFile(new URL("../portable/verification/cases/dafny/expect.sh",import.meta.url),"utf8");
  assert.match(text,/^EXPECT_POS_EXIT=0$/m);
  assert.match(text,/^EXPECT_POS_REGEX='Dafny program verifier finished with 1 verified, 0 errors'$/m);
  assert.match(text,/^EXPECT_NEG_EXIT=4$/m);
  assert.match(text,/^EXPECT_NEG_REGEX='postcondition could not be proved'$/m);
  assert.match(text,/^EXPECT_ERR_EXIT=2$/m);
  assert.match(text,/^EXPECT_ERR_REGEX='parse errors detected in err\.dfy'$/m);
  assert.doesNotMatch(text,/EXPECT_(?:NEG|ERR)_EXIT=['"]?\*/);
  assert.doesNotMatch(text,/EXPECT_(?:NEG|ERR)_REGEX=.*(?:^|[| ])error(?:[| ]|$)/im);
});
