import test from "node:test";
import assert from "node:assert/strict";
import { toolIds } from "../packages/runner/js/native-catalog.mjs";
import {
  readCapabilityRegistry, validateCapabilityRegistry,
  discoverTools, listProblemCapabilities
} from "../packages/runner/js/problem-capabilities.mjs";

const clone=x=>structuredClone(x);

test("G1 registry is machine readable, 23 capabilities, 36 tools, exact 13 native refs",()=>{
  const reg=readCapabilityRegistry();
  const result=validateCapabilityRegistry(reg);
  assert.equal(result.ok,true,JSON.stringify(result.issues));
  assert.deepEqual(result.counts,{capabilities:23,tools:36,native_refs:13,candidates:23});
  assert.deepEqual(reg.tools.filter(t=>t.origin==="native-ref").map(x=>x.id).sort(),[...toolIds].sort());
  assert.equal(listProblemCapabilities().length,23);
});
test("all catalog entries are discovery-only; no tool or proof is claimed verified",()=>{
  const reg=readCapabilityRegistry();
  for(const t of reg.tools){
    assert.equal(t.availability,"NOT_ASSESSED");
    assert.equal(t.runtime_verified,false);
    assert.equal(t.version,null);
    assert.equal(t.evidence_ref,null);
    assert.equal(t.license_status,"REVIEW_REQUIRED");
  }
});
test("find candidate alternatives by problem capability, not executable tool command",()=>{
  const res=discoverTools(["opt.combinatorial"]);
  assert.equal(res.status,"DISCOVERY_ONLY_NOT_RUN");
  assert.ok(res.candidates.some(x=>x.id==="ortools"));
  assert.ok(res.candidates.some(x=>x.id==="minizinc"));
  assert.ok(res.candidates.some(x=>x.id==="clingo"));
  for(const x of res.candidates){
    assert.equal(x.executable,false);
    assert.equal(x.verification_status,"NOT_RUN");
  }
});
test("one tool can match multiple capabilities without a second native registry",()=>{
  const res=discoverTools(["logic.smt","model.state"]);
  const apalache=res.candidates.find(x=>x.id==="apalache");
  assert.deepEqual(new Set(apalache.matched_capabilities),new Set(["logic.smt","model.state"]));
});
test("nativeOnly request never returns candidate-only tools, reports uncovered",()=>{
  const res=discoverTools(["math.symbolic","logic.smt"],{includeCandidates:false});
  assert.deepEqual(res.uncovered_capabilities,["math.symbolic"]);
  assert.ok(res.candidates.every(x=>x.origin==="native-ref"));
  assert.ok(res.candidates.some(x=>x.id==="z3"));
});
test("reject unknown capability and malformed input, no natural-language hallucinated mapping",()=>{
  assert.throws(()=>discoverTools(["this-is-not-a-capability"]),RangeError);
  assert.throws(()=>discoverTools([""]),TypeError);
  assert.throws(()=>discoverTools([]),TypeError);
  assert.throws(()=>discoverTools(["logic.smt"],{includeCandidates:"true"}),TypeError);
});
test("tampered native tool list fail closed before execution",()=>{
  const reg=clone(readCapabilityRegistry());
  reg.tools=reg.tools.filter(x=>x.id!=="z3");
  assert.equal(validateCapabilityRegistry(reg).ok,false);
  assert.ok(validateCapabilityRegistry(reg).issues.some(x=>x.includes("native tool references")));
});
test("reject additional unsanctioned native reference and ghost capability",()=>{
  const reg=clone(readCapabilityRegistry());
  reg.tools.find(x=>x.id==="ortools").origin="native-ref";
  reg.tools.find(x=>x.id==="ortools").priority="existing";
  assert.ok(validateCapabilityRegistry(reg).issues.some(x=>x.includes("native tool references")));
  const reg2=clone(readCapabilityRegistry());
  reg2.tools.find(x=>x.id==="z3").capability_ids=["logic.smt","missing.kind"];
  assert.ok(validateCapabilityRegistry(reg2).issues.some(x=>x.includes("unknown capability")));
});
test("duplicate capability/tool and candidate claiming verified state are rejected",()=>{
  const reg=clone(readCapabilityRegistry());
  reg.tools[1].id=reg.tools[0].id;
  assert.ok(validateCapabilityRegistry(reg).issues.some(x=>x.includes("duplicate tool ID")));
  const reg2=clone(readCapabilityRegistry());
  reg2.capabilities[1].id=reg2.capabilities[0].id;
  assert.ok(validateCapabilityRegistry(reg2).issues.some(x=>x.includes("duplicate capability")));
  const reg3=clone(readCapabilityRegistry());
  reg3.tools.find(x=>x.id==="sympy").runtime_verified=true;
  reg3.tools.find(x=>x.id==="sympy").availability="NATIVE_VERIFIED";
  assert.ok(validateCapabilityRegistry(reg3).issues.some(x=>x.includes("no runtime claim")));
});
test("unverified external facts cannot acquire fake formal PASS",()=>{
  const reg=clone(readCapabilityRegistry());
  reg.semantics.claim_result_states=reg.semantics.claim_result_states.filter(x=>x!=="NEEDS_SOURCE");
  assert.ok(validateCapabilityRegistry(reg).issues.some(x=>x.includes("NEEDS_SOURCE")));
});


test("new problem capabilities and candidate tools can be added without a hardcoded 36-tool cap",()=>{
  const reg=clone(readCapabilityRegistry());
  reg.capabilities.push({id:"graph.flow",label:"network flow",limitations:"model completeness required",claim_scope:"FORMAL_CHECKABLE_WITH_EXPLICIT_MODEL"});
  reg.tools.push({
    id:"future-network-flow",origin:"candidate",priority:"C",capability_ids:["graph.flow"],
    official_url:"https://example.org/flow-tool",distribution:"manual",
    availability:"NOT_ASSESSED",runtime_verified:false,version:null,evidence_ref:null,
    license_status:"REVIEW_REQUIRED",consumer_scope:"FORMAL_TOOLS_GENERIC"
  });
  const report=validateCapabilityRegistry(reg);
  assert.equal(report.ok,true,JSON.stringify(report.issues));
  assert.deepEqual(report.counts,{capabilities:24,tools:37,native_refs:13,candidates:24});
});
test("fail closed for malformed null capability and null tool records",()=>{
  const base=readCapabilityRegistry();
  const a=clone(base);
  a.capabilities[0]=null;
  const b=clone(base);
  b.tools[1]=null;
  assert.equal(validateCapabilityRegistry(a).ok,false);
  assert.equal(validateCapabilityRegistry(b).ok,false);
});
