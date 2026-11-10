import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectByteBoundClaim } from "../packages/runner/js/byte-evidence.mjs";
import { assessMethod } from "../packages/runner/js/method-planner.mjs";

const digest=x=>createHash("sha256").update(x).digest("hex");
/** @returns {any} Synthetic input: self-supplied bytes do NOT attest host execution. */
function fixture() {
 const source=Buffer.from("Frozen ADS user requirement: forbid overlapping same-resource writers.");
 const model=Buffer.from("(set-logic QF_LIA)\n(assert true)\n(check-sat)\n");
 const binary=Buffer.from("MOCK Z3 executable bytes; not a trusted native tool");
 const invocation=Buffer.from("z3 -smt2 model.smt2");
 const output=Buffer.from("sat\n");
 const problem={
  schema:"formal-tools/problem-spec/0.1",problem_id:"ads.smoke.r0",
  source_refs:[{id:"req",sha256:digest(source),classification:"PUBLIC",
   purpose:"synthetic ADS fixture",consumer:"formal_tools"}],
  requirements:[{id:"req1",source_ref:"req",text:"Two same resource writers must not overlap"}],
  claims:[{id:"claim1",text:"Forbid overlapping writers",kind:"bounded_model",
   requirement_ids:["req1"],source_refs:["req"],capability_ids:["logic.smt"]}],
  oracles:[{id:"oracle1",source_ref:"req",frozen:true,positive_case_ids:["good"],
   negative_case_ids:["bad"],review_identity:"not_real_independent_reviewer"}],
  capability_ids:["logic.smt"],
  budget:{max_steps:3,max_depth:3,max_cost_units:10,max_total_time_ms:5000,max_retries:0},
  policy:{allowed_tools:["z3"],allowed_operations:{z3:["solve"]},destination:"LOCAL",
   max_input_classification:"PUBLIC",allow_network:false}
 };
 const method={schema:"formal-tools/method-proposal/0.1",method_id:"method1",
  problem_id:problem.problem_id,goal_claim_ids:["claim1"],oracle_ids:["oracle1"],
  semantic_review:"PENDING",
  steps:[{id:"step1",tool_id:"z3",operation:"solve",claim_ids:["claim1"],
   provides:["logic.smt"],source_refs:["req"],depends_on:[],
   estimated_cost_units:1,timeout_ms:1000,destination:"LOCAL",output_classification:"PUBLIC"}]};
 const methodSHA=assessMethod(problem,method).method_sha256;
 assert.equal(assessMethod(problem,method).status,"STRUCTURALLY_VALID");
 const bundle={schema:"formal-tools/evidence-bundle/0.1",
  claim:{id:"claim1",kind:"bounded_model",source_sha256:digest(source),
   model_sha256:digest(model),method_sha256:methodSHA,required_step_ids:["step1"]},
  source_sha256:digest(source),model_sha256:digest(model),method_sha256:methodSHA,
  policy:{allowed_tool_ids:["z3"],allowed_operations:{z3:["solve"]},
   classification:"PUBLIC",destination:"LOCAL",network_allowed:false},
  receipts:[{step_id:"step1",claim_id:"claim1",tool_id:"z3",operation:"solve",
   tool_binary_sha256:digest(binary),invocation_sha256:digest(invocation),
   output_sha256:digest(output),source_sha256:digest(source),
   model_sha256:digest(model),method_sha256:methodSHA,tool_status:"SAT",
   exit_code:0,input_classification:"PUBLIC",output_classification:"PUBLIC"}]};
 return {problem,method,claim_id:"claim1",source_id:"req",bundle,
  artifacts:{source,model,steps:{step1:{binary,invocation,output}}}};
}

test("G3: matching supplied bytes are not host attestation or business truth",()=>{
 const result=inspectByteBoundClaim(fixture());
 assert.equal(result.status,"BYTES_BOUND_UNATTESTED",JSON.stringify(result.issues));
 assert.equal(result.claim_result,"UNVERIFIED");
 assert.equal(result.source_bytes_bound,true);
 assert.equal(result.model_bytes_bound,true);
 assert.equal(result.native_host_attested,false);
 assert.equal(result.independent_oracle_review,"NOT_RUN");
 assert.equal(result.solution_promotable,false);
});
test("G3: changed source and wrong original ProblemSpec source hash fail closed",()=>{
 const a=fixture();a.artifacts.source=Buffer.from("a different requirement");
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();b.problem.source_refs[0].sha256="a".repeat(64);
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
});
test("G3: changed formal model bytes cannot launder an existing SAT receipt",()=>{
 const a=fixture();a.artifacts.model=Buffer.from("(assert false)");
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();b.bundle.model_sha256="f".repeat(64);
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
});
test("G3: changing G2 Method after hashing invalidates all old receipts",()=>{
 const a=fixture();a.method.steps[0].timeout_ms=999;
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();b.bundle.method_sha256="0".repeat(64);
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
});
test("G3: binary, invocation and output byte tampering fail without asserting proof",()=>{
 for(const key of ["binary","invocation","output"]){
  const a=fixture();a.artifacts.steps.step1[key]=Buffer.from("modified "+key);
  assert.equal(inspectByteBoundClaim(a).status,"BLOCKED",key);
 }
});
test("G3: fake tool ID and altered native operation are rejected",()=>{
 const a=fixture();a.bundle.receipts[0].operation="dimacs";
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();b.bundle.receipts[0].tool_id="cvc5";
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
});
test("G3: UNKNOWN or TIMEOUT is not a verified result",()=>{
 for(const state of ["UNKNOWN","TIMEOUT","ERROR","NOT_RUN"]){
  const a=fixture();a.bundle.receipts[0].tool_status=state;
  assert.equal(inspectByteBoundClaim(a).status,"INCONCLUSIVE",state);
  assert.equal(inspectByteBoundClaim(a).solution_promotable,false);
 }
});
test("G3: external factual claim cannot be verified by formally matching bytes",()=>{
 const a=fixture();a.problem.claims[0].kind="external_fact";
 a.problem.claims[0].capability_ids=[];
 a.bundle.claim.kind="external_fact";
 const r=inspectByteBoundClaim(a);
 assert.equal(r.status,"NEEDS_SOURCE");
 assert.equal(r.claim_result,"NEEDS_SOURCE");
});
test("G3: forged, missing or extra claim steps cannot reuse the old receipt",()=>{
 const a=fixture();a.bundle.claim.required_step_ids=["other"];
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();b.bundle.receipts=[];
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
 const c=fixture();c.bundle.receipts.push({...c.bundle.receipts[0],step_id:"extra"});
 assert.equal(inspectByteBoundClaim(c).status,"BLOCKED");
});
test("G3: G2 policy cannot be widened by a matching receipt bundle",()=>{
 const a=fixture();a.problem.policy.allowed_operations.z3=["dimacs"];
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();b.bundle.policy.allowed_tool_ids.push("cvc5");
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
});
test("G3: multi-source requirement is refused instead of collapsed to one hash",()=>{
 const a=fixture();
 a.problem.source_refs.push({id:"other",sha256:"f".repeat(64),
   classification:"PUBLIC",purpose:"extra source",consumer:"formal_tools"});
 a.problem.requirements.push({id:"req2",source_ref:"other",text:"Another requirement"});
 a.problem.claims[0].requirement_ids.push("req2");
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
});
test("G3: one Claim with transitive upstream DAG requires both step receipts",()=>{
 const a=fixture();const d=x=>digest(x);
 const input=Buffer.from("upstream input");
 a.method.steps[0].depends_on=["step0"];
 a.method.steps[0].source_refs=[];
 a.method.steps.unshift({id:"step0",tool_id:"z3",operation:"solve",claim_ids:[],
  provides:["logic.smt"],source_refs:["req"],depends_on:[],
  estimated_cost_units:1,timeout_ms:1000,destination:"LOCAL",output_classification:"PUBLIC"});
 const sha=assessMethod(a.problem,a.method).method_sha256;
 assert.equal(assessMethod(a.problem,a.method).status,"STRUCTURALLY_VALID");
 a.bundle.method_sha256=sha;a.bundle.claim.method_sha256=sha;
 a.bundle.claim.required_step_ids=["step0","step1"];
 a.bundle.receipts[0].method_sha256=sha;
 a.bundle.receipts.push({...a.bundle.receipts[0],step_id:"step0",
  invocation_sha256:d(input)});
 a.artifacts.steps.step0={binary:a.artifacts.steps.step1.binary,
  invocation:input,output:a.artifacts.steps.step1.output};
 assert.equal(inspectByteBoundClaim(a).status,"BYTES_BOUND_UNATTESTED");
 delete a.artifacts.steps.step0;
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
});
test("G3: malformed and oversized artifact bytes never become evidence",()=>{
 assert.equal(inspectByteBoundClaim(null).status,"BLOCKED");
 const a=fixture();a.artifacts.model="(check-sat)";
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();b.artifacts.steps.step1.output=Buffer.alloc(4_194_305);
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
 const c=fixture();c.bundle.policy.allowed_operations.z3=Object.create(null);
 assert.equal(inspectByteBoundClaim(c).status,"BLOCKED");
});


test("G3: custom typed-array subclass cannot spoof byte length to skip size policy",()=>{
 const a=fixture();
 class SpoofedBytes extends Uint8Array { get byteLength(){return 1;} }
 a.artifacts.model=new SpoofedBytes(a.artifacts.model);
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
});
test("G3: G3 receipts cannot widen original G2 privacy policy or downgrade step output",()=>{
 const a=fixture();
 a.bundle.policy.classification="RESTRICTED";
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();
 b.method.steps[0].output_classification="RESTRICTED";
 const newSHA=assessMethod(b.problem,b.method).method_sha256;
 b.bundle.method_sha256=newSHA;
 b.bundle.claim.method_sha256=newSHA;
 b.bundle.receipts[0].method_sha256=newSHA;
 const r=inspectByteBoundClaim(b);
 assert.equal(r.status,"BLOCKED");
 assert.match(r.issues.join(" "),/downgrades G2 step sensitivity/);
});

test("G3 security P1: instance-overridden G2 tool allowlist cannot forge authorization",()=>{
 const a=fixture();
 a.problem.policy.allowed_tools=[];
 a.problem.policy.allowed_tools.includes=()=>true;
 a.problem.policy.allowed_tools.some=()=>false;
 const result=inspectByteBoundClaim(a);
 assert.equal(result.status,"BLOCKED");
 assert.equal(result.native_host_attested,false);
 assert.equal(result.solution_promotable,false);
});

test("G3 security P1: overridden G2 typed operation array cannot grant extra operations",()=>{
 const a=fixture();
 a.problem.policy.allowed_operations.z3=[];
 a.problem.policy.allowed_operations.z3.includes=()=>true;
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();
 b.method.goal_claim_ids.includes=()=>true;
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
});

test("G3 security P1: nested Proxy, getter and sparse Method arrays fail closed",()=>{
 const a=fixture();
 a.problem.policy.allowed_tools=new Proxy(["z3"],{get:(target,key)=>key==="includes"?()=>true:Reflect.get(target,key)});
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();
 Object.defineProperty(b.method.steps,"0",{get(){return {};},configurable:true});
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
 const c=fixture();
 c.method.steps=new Array(1);
 assert.equal(inspectByteBoundClaim(c).status,"BLOCKED");
});

test("G3 security P1: ordinary parsed JSON Method and ProblemSpec retain unverified byte binding",()=>{
 const a=fixture();
 a.problem=JSON.parse(JSON.stringify(a.problem));
 a.method=JSON.parse(JSON.stringify(a.method));
 a.bundle=JSON.parse(JSON.stringify(a.bundle));
 const result=inspectByteBoundClaim(a);
 assert.equal(result.status,"BYTES_BOUND_UNATTESTED",JSON.stringify(result.issues));
 assert.equal(result.claim_result,"UNVERIFIED");
 assert.equal(result.native_host_attested,false);
 assert.equal(result.solution_promotable,false);
});


test("G3 independent P1: receipt Claim kind cannot differ from original G2 Claim",()=>{
 const a=fixture();
 a.bundle.claim.kind="symbolic";
 const result=inspectByteBoundClaim(a);
 assert.equal(result.status,"BLOCKED");
 assert.match(result.issues.join(" "),/Claim kind/);
 assert.equal(result.solution_promotable,false);
});

test("G3 independent P1: even unused G3 tool/operation permissions cannot widen G2",()=>{
 const a=fixture();
 a.bundle.policy.allowed_operations.z3.push("dimacs");
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=fixture();
 b.bundle.policy.allowed_tool_ids.push("cvc5");
 b.bundle.policy.allowed_operations.cvc5=["solve"];
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED");
});

test("G3 independent P1: source sensitivity cannot be erased by receipt policy or input labels",()=>{
 const makeSensitive=()=>{
  const a=fixture();
  a.problem.source_refs[0].classification="USER_PRIVATE";
  a.problem.policy.max_input_classification="USER_PRIVATE";
  a.method.steps[0].output_classification="USER_PRIVATE";
  const checked=assessMethod(a.problem,a.method);
  assert.equal(checked.status,"STRUCTURALLY_VALID",JSON.stringify(checked.issues));
  a.bundle.method_sha256=checked.method_sha256;
  a.bundle.claim.method_sha256=checked.method_sha256;
  a.bundle.receipts[0].method_sha256=checked.method_sha256;
  a.bundle.receipts[0].output_classification="USER_PRIVATE";
  return a;
 };
 const a=makeSensitive();
 // Existing G3 permits this syntactically, but it launders a private source
 // into a PUBLIC evidence policy while every SHA still matches.
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED");
 const b=makeSensitive();
 b.bundle.policy.classification="USER_PRIVATE";
 assert.equal(inspectByteBoundClaim(b).status,"BLOCKED",
   "input label PUBLIC must not describe USER_PRIVATE source bytes");
 b.bundle.receipts[0].input_classification="USER_PRIVATE";
 const ok=inspectByteBoundClaim(b);
 assert.equal(ok.status,"BYTES_BOUND_UNATTESTED",JSON.stringify(ok.issues));
 assert.equal(ok.claim_result,"UNVERIFIED");
 assert.equal(ok.native_host_attested,false);
 assert.equal(ok.solution_promotable,false);
});

test("G3 independent P1: downstream input taint includes upstream Method outputs",()=>{
 const a=fixture(), input=Buffer.from("upstream input");
 a.method.steps[0].depends_on=["step0"];
 a.method.steps[0].source_refs=[];
 a.method.steps[0].output_classification="RESTRICTED";
 a.method.steps.unshift({id:"step0",tool_id:"z3",operation:"solve",claim_ids:[],
  provides:["logic.smt"],source_refs:["req"],depends_on:[],
  estimated_cost_units:1,timeout_ms:1000,destination:"LOCAL",
  output_classification:"RESTRICTED"});
 const checked=assessMethod(a.problem,a.method);
 assert.equal(checked.status,"STRUCTURALLY_VALID",JSON.stringify(checked.issues));
 a.bundle.method_sha256=checked.method_sha256;
 a.bundle.claim.method_sha256=checked.method_sha256;
 a.bundle.claim.required_step_ids=["step0","step1"];
 a.bundle.policy.classification="RESTRICTED";
 a.bundle.receipts[0].method_sha256=checked.method_sha256;
 a.bundle.receipts[0].output_classification="RESTRICTED";
 a.bundle.receipts.push({...a.bundle.receipts[0],step_id:"step0",
  invocation_sha256:digest(input)});
 a.artifacts.steps.step0={binary:a.artifacts.steps.step1.binary,
  invocation:input,output:a.artifacts.steps.step1.output};
 assert.equal(inspectByteBoundClaim(a).status,"BLOCKED",
   "downstream PUBLIC input label must not hide RESTRICTED predecessor");
 a.bundle.receipts[0].input_classification="RESTRICTED";
 const ok=inspectByteBoundClaim(a);
 assert.equal(ok.status,"BYTES_BOUND_UNATTESTED",JSON.stringify(ok.issues));
 assert.equal(ok.claim_result,"UNVERIFIED");
});
