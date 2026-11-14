/**
 * Issue #11 G6 — formal-tools->DIS v0.2.0 bounded handoff PRE-FLIGHT.
 *
 * It deliberately cannot execute a domain Function or reuse a Solution:
 * PR #23 candidates are NOT_ADMITTED and no professional source/semantic
 * Oracle/Host/Tool qualification exists. This is a typed refusal envelope
 * for a future real consumer, not a second DIS Runtime or real E2E proof.
 *
 * External reference (READ-ONLY, re-pinned at real-consumer implementation
 * time per Issue #11 R15 target selection):
 * kaicreator-mm/domain-harness PR #1497 HEAD 90afefa8...
 * examples/dis-v020-native-sdk/b05-target-consumer.test.mjs
 * Git blob 242930c5b10f629a13115a45069f2814f6042316.
 * Its bounded observations have kind/authority and no business attestation.
 */
import {createHash} from "node:crypto";
import {inspectCandidateReplay} from "./solution-candidate.mjs";

const SHA=/^[a-f0-9]{40}$/;
export const DIS_V020_REFERENCE=Object.freeze({
  repository:"kaicreator-mm/domain-harness",
  pr:1497,
  source_head:"90afefa81ef9ad0d42087ffc8a0dbaa32757811f",
  example_path:"examples/dis-v020-native-sdk/b05-target-consumer.test.mjs",
  example_blob:"242930c5b10f629a13115a45069f2814f6042316",
  target:"linux/x64/node",
  contract:"dis.v0.2",
});
const hash=value=>createHash("sha256").update(value).digest("hex");
function unqualified(reason,status,candidate_sha256,provenance_sha256){
  return Object.freeze({
    schema:"formal-tools/dis-v020-preflight/0.1",
    status,reason,
    candidate_sha256,provenance_sha256,
    consumer:DIS_V020_REFERENCE,
    kind:"UNKNOWN",authority:"NONE",
    evidence:Object.freeze({attested:false,independent_oracle:false,
      dis_host_executed:false,source_authority:"NOT_ADMITTED"}),
    claim_result:"UNVERIFIED",replay_allowed:false,solution_promotable:false,
    effect_dispatched:false,host_invocations:0,
    g6_accepted:false,
  });
}

/** Fail-closed handoff of unqualified G4 candidate into a DIS-compatible
 * negative envelope, with no operation that could invoke a Host.
 * @param {{candidate_json?:string,current_provenance_json?:string,
 *   target_head?:string}} [args]
 * @returns {any}
 */
export function inspectDisV020Consumption({candidate_json,current_provenance_json,target_head}={}){
  const sourceOK=typeof candidate_json==="string"&&
    Buffer.byteLength(candidate_json,"utf8")<=131072;
  const provenanceOK=typeof current_provenance_json==="string"&&
    Buffer.byteLength(current_provenance_json,"utf8")<=131072;
  const candidateSha=sourceOK?hash(candidate_json):null;
  const provenanceSha=provenanceOK?hash(current_provenance_json):null;
  if(!sourceOK||!provenanceOK)
    return unqualified("INVALID_HANDOFF","BLOCKED",candidateSha,provenanceSha);
  if(typeof target_head!=="string"||!SHA.test(target_head)||target_head!==DIS_V020_REFERENCE.source_head)
    return unqualified("DIS_TARGET_VERSION_DRIFT","STALE",candidateSha,provenanceSha);
  const assessment=inspectCandidateReplay(candidate_json,current_provenance_json);
  if(assessment.status==="STALE")
    return unqualified("SOURCE_MODEL_TOOL_OR_EVIDENCE_DRIFT","STALE",candidateSha,provenanceSha);
  if(assessment.status==="BLOCKED")
    return unqualified("INVALID_SOLUTION","BLOCKED",candidateSha,provenanceSha);
  if(assessment.status!=="REPLAY_BLOCKED_UNQUALIFIED")
    return unqualified("UNRECOGNIZED_REPLAY_GATE","BLOCKED",candidateSha,provenanceSha);
  // Never inspect caller-supplied fabricated 'approved' booleans, nor accept
  // SAT/UNSAT as a professional Oracle. A real DIS KDP must recheck credentials
  // independently at the time of execution. None are available at this stage.
  return unqualified("SOURCE_MODEL_ORACLE_HOST_TOOL_NOT_QUALIFIED",
    "REPLAY_BLOCKED_UNQUALIFIED",candidateSha,provenanceSha);
}
