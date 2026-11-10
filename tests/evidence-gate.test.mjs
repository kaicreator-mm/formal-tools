import test from "node:test";
import assert from "node:assert/strict";
import { inspectEvidenceBundle } from "../packages/runner/js/evidence-gate.mjs";

/** @returns {any} Frozen synthetic receipt; all hash strings are untrusted placeholders. */
function fixture() {
  const source="a".repeat(64),model="b".repeat(64),method="c".repeat(64);
  return {
    schema:"formal-tools/evidence-bundle/0.1",
    claim:{id:"claim1",kind:"symbolic",source_sha256:source,model_sha256:model,
      method_sha256:method,required_step_ids:["step01"]},
    source_sha256:source,model_sha256:model,method_sha256:method,
    policy:{allowed_tool_ids:["z3"],classification:"PUBLIC",destination:"LOCAL",network_allowed:false},
    receipts:[{step_id:"step01",claim_id:"claim1",tool_id:"z3",operation:"solve",
      tool_binary_sha256:"d".repeat(64),invocation_sha256:"e".repeat(64),
      output_sha256:"f".repeat(64),source_sha256:source,model_sha256:model,
      method_sha256:method,tool_status:"SAT",exit_code:0,
      input_classification:"PUBLIC",output_classification:"PUBLIC"}]
  };
}
const snapshot=x=>structuredClone(x);
test("G3 prework: correctly linked SAT is NOT a verified business claim",()=>{
  const out=inspectEvidenceBundle(fixture());
  assert.equal(out.status,"LINKED_UNVERIFIED",JSON.stringify(out.issues));
  assert.equal(out.claim_result,"UNVERIFIED");
  assert.equal(out.solution_promotable,false);
  assert.equal(out.independent_oracle_review,"NOT_RUN");
  assert.equal(out.tool_execution,"RECEIPT_CLAIMED_NOT_ATTESTED");
  assert.equal(out.linked_receipts,1);
});
test("G3 prework: solver UNSAT or PROVED is still not source semantic proof",()=>{
  for(const tool_status of ["UNSAT","PROVED","COUNTEREXAMPLE","TEST_PASS","OPTIMAL"]){
    const data=fixture();data.receipts[0].tool_status=tool_status;
    assert.equal(inspectEvidenceBundle(data).claim_result,"UNVERIFIED");
  }
});
test("G3 prework: mismatched claim and method/source/model/output identities fail closed",()=>{
  for(const key of ["claim_id","source_sha256","model_sha256","method_sha256"]){
    const data=fixture();
    data.receipts[0][key]=key==="claim_id"?"otherclaim":"0".repeat(64);
    assert.equal(inspectEvidenceBundle(data).status,"BLOCKED",key);
  }
  const d=fixture();d.source_sha256="0".repeat(64);
  assert.equal(inspectEvidenceBundle(d).status,"BLOCKED");
});
test("G3 prework: unknown or candidate tools and unapproved operations are rejected",()=>{
  const x=fixture();x.receipts[0].tool_id="networkx";
  assert.equal(inspectEvidenceBundle(x).status,"BLOCKED");
  const y=fixture();y.receipts[0].operation="raw";
  assert.equal(inspectEvidenceBundle(y).status,"BLOCKED");
  const z=fixture();z.policy.allowed_tool_ids=["cvc5"];
  assert.equal(inspectEvidenceBundle(z).status,"BLOCKED");
});
test("G3 prework: forged assertion fields cannot make receipts authoritative",()=>{
  const b=fixture();
  b.claim_result="SUPPORTED_WITH_SCOPE";
  assert.equal(inspectEvidenceBundle(b).status,"BLOCKED");
  const c=fixture();
  c.receipts[0].proven=true;
  assert.equal(inspectEvidenceBundle(c).status,"BLOCKED");
});
test("G3 prework: UNKNOWN, ERROR, TIMEOUT and NOT_RUN never become PASS",()=>{
  for(const tool_status of ["UNKNOWN","ERROR","TIMEOUT","NOT_RUN"]){
    const b=fixture();b.receipts[0].tool_status=tool_status;
    assert.equal(inspectEvidenceBundle(b).status,"INCONCLUSIVE",tool_status);
    assert.equal(inspectEvidenceBundle(b).solution_promotable,false);
  }
});
test("G3 prework: external real-world facts are not validated by SAT",()=>{
  for(const kind of ["external_fact","not_formalizable"]){
    const b=fixture();b.claim.kind=kind;
    const r=inspectEvidenceBundle(b);
    assert.equal(r.status,"NEEDS_SOURCE");
    assert.equal(r.claim_result,"NEEDS_SOURCE");
  }
});
test("G3 prework: duplicate, missing or unexpected step receipts are rejected",()=>{
  const x=fixture();x.receipts.push(snapshot(x.receipts[0]));
  assert.equal(inspectEvidenceBundle(x).status,"BLOCKED");
  const y=fixture();y.claim.required_step_ids=["step01","step02"];
  assert.equal(inspectEvidenceBundle(y).status,"BLOCKED");
  const z=fixture();z.receipts[0].step_id="step99";
  assert.equal(inspectEvidenceBundle(z).status,"BLOCKED");
});
test("G3 prework: corrupted or excessive receipt data is safely rejected",()=>{
  const a=fixture();a.receipts=Array(20000).fill({});
  assert.equal(inspectEvidenceBundle(a).status,"BLOCKED");
  const b=fixture();b.claim.required_step_ids="step01";
  assert.equal(inspectEvidenceBundle(b).status,"BLOCKED");
  const c=fixture();c.policy.allowed_tool_ids={includes:true};
  assert.equal(inspectEvidenceBundle(c).status,"BLOCKED");
  assert.equal(inspectEvidenceBundle(null).status,"BLOCKED");
  const d=fixture();d.receipts=[null];
  assert.equal(inspectEvidenceBundle(d).status,"BLOCKED");
});
test("G3 prework: privacy declassification and non-local destinations cannot pass",()=>{
  const p=fixture();p.receipts[0].input_classification="RESTRICTED";
  p.receipts[0].output_classification="PUBLIC";
  p.policy.classification="RESTRICTED";
  assert.equal(inspectEvidenceBundle(p).status,"BLOCKED");
  const n=fixture();n.policy.network_allowed=true;
  assert.equal(inspectEvidenceBundle(n).status,"BLOCKED");
  const m=fixture();m.policy.destination="REMOTE";
  assert.equal(inspectEvidenceBundle(m).status,"BLOCKED");
});
test("G3 prework: non-zero exit cannot assert SAT, and outcome enums are bounded",()=>{
  const a=fixture();a.receipts[0].exit_code=1;
  assert.equal(inspectEvidenceBundle(a).status,"BLOCKED");
  const b=fixture();b.receipts[0].tool_status="PASS";
  assert.equal(inspectEvidenceBundle(b).status,"BLOCKED");
  const c=fixture();c.receipts[0].tool_status="TIMEOUT";c.receipts[0].exit_code=1;
  assert.equal(inspectEvidenceBundle(c).status,"INCONCLUSIVE");
});
test("G3 prework: no receipts remains unresolved, not proof",()=>{
  const b=fixture();b.receipts=[];
  const result=inspectEvidenceBundle(b);
  assert.equal(result.status,"BLOCKED");
  assert.equal(result.claim_result,"INCONCLUSIVE");
});
