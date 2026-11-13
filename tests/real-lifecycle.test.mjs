import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRealLifecycleCandidate, FAITHFUL_OBSERVATIONS, FIXTURE_SHA256, NAT_PAIR_SHA256 }
  from "../benchmarks/llm-methods/g4/real-provenance.mjs";
import { expectPhase, phaseLog } from "../benchmarks/llm-methods/g4/real-store-lifecycle.mjs";

// Windows-safe: seals candidates and inspects committed receipts only; no store
// persistence, no directory fsync, no POSIX-only assumption.
const pair=JSON.parse(readFileSync(
  new URL("../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url),"utf8"));

test("G4 real builder seals a CANDIDATE bound to the real z3 executable identity",()=>{
  const {candidate,provenance}=buildRealLifecycleCandidate();
  assert.equal(candidate.status,"CANDIDATE");
  assert.match(candidate.candidate_sha256,/^[a-f0-9]{64}$/);
  const z3=pair.solvers.find(s=>s.id==="z3");
  assert.equal(provenance.tool_binary_sha256,z3.executable_sha256);
  assert.equal(provenance.tool_version,z3.version);
  assert.equal(provenance.platform,"debian13-x86_64");
  assert.equal(provenance.evidence_gate,"BYTES_BOUND_UNATTESTED");
});

test("G4 real builder provenance binding is schema-exact and stable across invocations",()=>{
  const a=buildRealLifecycleCandidate(),b=buildRealLifecycleCandidate();
  assert.equal(a.candidate.candidate_sha256,b.candidate.candidate_sha256);
  assert.equal(a.provenance.source_sha256,b.provenance.source_sha256);
  assert.equal(a.provenance.evidence_sha256,b.provenance.evidence_sha256);
  assert.equal(a.provenance.source_sha256,FIXTURE_SHA256);
  assert.equal(a.provenance.evidence_sha256,NAT_PAIR_SHA256);
  // solution-candidate.mjs seals only when the frozen oracle hash equals the
  // frozen source hash; the requirements-array content hash is exported
  // separately as ORACLE_CONTENT_SHA256 for receipts.
  assert.equal(a.provenance.oracle_sha256,a.provenance.source_sha256);
  for(const k of ["source_sha256","oracle_sha256","model_sha256","tool_binary_sha256","evidence_sha256"])
    assert.match(a.provenance[k],/^[a-f0-9]{64}$/);
  assert.equal(a.candidate.replay_allowed,false);
  assert.equal(a.candidate.solution_promotable,false);
  assert.equal(a.candidate.claim_result,"UNVERIFIED");
});

test("G3 faithful observations are exactly the six clean SAT/UNSAT native runs",()=>{
  const obs=FAITHFUL_OBSERVATIONS();
  assert.equal(obs.length,6);
  for(const o of obs){
    assert.ok(o.id.startsWith("faithful__"),o.id);
    assert.equal(o.exit_code,0);
    assert.ok(["SAT","UNSAT"].includes(o.status));
    assert.match(o.input_sha256,/^[a-f0-9]{64}$/);
  }
});

test("expectPhase records a passing phase with a UTC ISO timestamp",()=>{
  const before=phaseLog.length;
  const entry=expectPhase("unit-pass",{status:"OK"},x=>x.status==="OK");
  assert.equal(entry.ok,true);
  assert.equal(entry.phase,"unit-pass");
  assert.match(entry.at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(phaseLog.length,before+1);
  assert.equal(phaseLog.at(-1),entry);
});

test("expectPhase throws naming the phase on a missed expectation",()=>{
  const before=phaseLog.length;
  assert.throws(()=>expectPhase("unit-miss",{status:"BAD"},x=>x.status==="OK"),/unit-miss/);
  assert.equal(phaseLog.length,before+1,"a miss is still recorded fail-closed");
  assert.equal(phaseLog.at(-1).ok,false);
});
