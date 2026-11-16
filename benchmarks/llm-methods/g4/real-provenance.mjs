/**
 * Issue #11 / G4+G6 real lifecycle: candidate bound to REAL committed evidence.
 *
 * Provenance binds the frozen spec-fidelity fixture and the G3 dual-solver
 * native receipt NATIVE_PAIR.json (real z3 5.4.0 executable digest, faithful
 * model SAT/UNSAT observations), all hashed in checkout-agnostic git-object
 * (LF) byte form. Engineering scope only: evidence_gate stays
 * BYTES_BOUND_UNATTESTED; nothing here qualifies a Source/Oracle/Host/Tool
 * or promotes a Solution.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sealSolutionCandidate } from "../../../packages/runner/js/solution-candidate.mjs";

const sha=/^[a-f0-9]{64}$/;
const sha256=x=>createHash("sha256").update(x).digest("hex");
// Checkout-agnostic: hash the git-object (LF) byte form, never the working-tree
// CRLF form, so autocrlf checkouts bind the same evidence bytes as POSIX.
const gitBytes=p=>Buffer.from(readFileSync(p).toString("utf8").replace(/\r\n/g,"\n"),"utf8");
const plain=x=>x&&typeof x==="object"&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):
  plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const canonicalJSON=x=>JSON.stringify(canonical(x));

const fixtureBytes=gitBytes(new URL("../r0/spec-fidelity-cases.json",import.meta.url));
const pairBytes=gitBytes(new URL("../../../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url));
export const FIXTURE_SHA256=sha256(fixtureBytes);
export const NAT_PAIR_SHA256=sha256(pairBytes);
const fixture=JSON.parse(fixtureBytes.toString("utf8"));
const pair=JSON.parse(pairBytes.toString("utf8"));

const z3=pair.solvers.find(s=>s.id==="z3");
if(!z3||z3.version!=="5.4.0"||!sha.test(z3.executable_sha256))
  throw new Error("NATIVE_PAIR z3 5.4.0 real executable identity missing or drifted");
// Content digests of the frozen oracle requirements and the faithful model,
// exported for receipt headers and reviewer readback. The sealed provenance
// binds oracle_sha256 to the frozen SOURCE hash because sealSolutionCandidate
// (solution-candidate.mjs) refuses any oracle_sha256 !== source.sha256.
export const ORACLE_CONTENT_SHA256=sha256(canonicalJSON(fixture.reference_requirements));
export const FAITHFUL_MODEL_SHA256=sha256(canonicalJSON(fixture.models.find(m=>m.id==="faithful")));

/** The six faithful__* native observations; throws if the real receipt drifted. */
export function FAITHFUL_OBSERVATIONS(){
  const rows=pair.observations.filter(o=>o.id.startsWith("faithful__"));
  if(rows.length!==6||rows.some(o=>o.exit_code!==0||!["SAT","UNSAT"].includes(o.status)))
    throw new Error("NATIVE_PAIR faithful observations drifted from 6 clean SAT/UNSAT runs");
  return rows.map(o=>({...o}));
}

/** G2 problem/method/provenance bound to real evidence, sealed as CANDIDATE. */
export function buildRealLifecycleCandidate(){
  const requirements=fixture.reference_requirements.map(r=>({
    id:r.id.toLowerCase(),source_ref:"requirements",text:r.text}));
  const claims=fixture.reference_requirements.map(r=>({
    id:"claim_"+r.id.toLowerCase(),text:r.text,kind:"bounded_model",
    requirement_ids:[r.id.toLowerCase()],source_refs:["requirements"],
    capability_ids:["logic.smt"]}));
  const problem={
    schema:"formal-tools/problem-spec/0.1",problem_id:"ads.real-lifecycle",
    source_refs:[{id:"requirements",sha256:FIXTURE_SHA256,classification:"PUBLIC",
      purpose:"frozen synthetic case",consumer:"formal_tools"}],
    requirements,claims,
    oracles:[{id:"oracle1",source_ref:"requirements",frozen:true,
      positive_case_ids:fixture.cases.filter(c=>c.expected==="PASS").map(c=>c.id),
      negative_case_ids:fixture.cases.filter(c=>c.expected==="FAIL").map(c=>c.id),
      review_identity:"independent_reviewer"}],
    capability_ids:["logic.smt"],
    budget:{max_steps:3,max_depth:3,max_cost_units:10,max_total_time_ms:10000,max_retries:0},
    policy:{allowed_tools:["z3"],allowed_operations:{z3:["solve"]},
      destination:"LOCAL",max_input_classification:"PUBLIC",allow_network:false}};
  const method={schema:"formal-tools/method-proposal/0.1",method_id:"real_lifecycle_method",
    problem_id:problem.problem_id,goal_claim_ids:claims.map(c=>c.id),oracle_ids:["oracle1"],
    semantic_review:"PENDING",
    steps:[{id:"step01",tool_id:"z3",operation:"solve",claim_ids:claims.map(c=>c.id),
      provides:["logic.smt"],depends_on:[],source_refs:["requirements"],
      estimated_cost_units:2,timeout_ms:300,destination:"LOCAL",output_classification:"PUBLIC"}]};
  const provenance={schema:"formal-tools/solution-provenance/0.1",
    source_id:"requirements",source_sha256:FIXTURE_SHA256,
    oracle_id:"oracle1",oracle_sha256:FIXTURE_SHA256,
    model_sha256:FAITHFUL_MODEL_SHA256,tool_id:"z3",tool_version:z3.version,
    tool_binary_sha256:z3.executable_sha256,platform:"debian13-x86_64",
    evidence_sha256:NAT_PAIR_SHA256,evidence_gate:"BYTES_BOUND_UNATTESTED"};
  const problem_json=JSON.stringify(problem),method_json=JSON.stringify(method),
    provenance_json=JSON.stringify(provenance);
  const candidate=sealSolutionCandidate({problem_json,method_json,provenance_json});
  if(candidate.status!=="CANDIDATE")
    throw new Error("real lifecycle candidate refused: "+JSON.stringify(candidate.issues));
  return {problem_json,method_json,provenance_json,provenance,candidate};
}
