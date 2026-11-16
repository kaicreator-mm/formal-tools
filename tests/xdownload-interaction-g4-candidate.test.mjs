import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sealSolutionCandidate,inspectCandidateReplay} from '../packages/runner/js/solution-candidate.mjs';

const base=new URL('../benchmarks/llm-methods/g4/',import.meta.url);
const evidenceRoot='../validation/xdownload-interaction-2026-11-16/';
const evidenceUrl=new URL(evidenceRoot+'PAIR.json',import.meta.url);
const rerunUrl=new URL(evidenceRoot+'PAIR-RERUN.json',import.meta.url);
const evidenceIndexUrl=new URL(evidenceRoot+'EVIDENCE_INDEX.json',import.meta.url);
const readJson=async url=>JSON.parse(await readFile(url,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('xDownload bounded dual-solver evidence seals only an unqualified G4 Candidate',async()=>{
 const [problem,method,provenance,pair,rerun,evidenceIndex,modelSet,modelSetBytes,pairBytes,rerunBytes,indexBytes]=await Promise.all([
  readJson(new URL('PROBLEM.json',base)),readJson(new URL('METHOD.json',base)),
  readJson(new URL('PROVENANCE.json',base)),readJson(evidenceUrl),readJson(rerunUrl),
  readJson(evidenceIndexUrl),readJson(new URL('MODEL_SET.json',base)),
  readFile(new URL('MODEL_SET.json',base)),readFile(evidenceUrl),readFile(rerunUrl),
  readFile(evidenceIndexUrl)
 ]);
 assert.equal(pair.pair_agreement.compared_queries,5);
 assert.equal(pair.pair_agreement.agree,5);
 assert.equal(pair.pair_agreement.disagree,0);
 assert.equal(method.steps.length,10);
 assert.equal(provenance.model_sha256,sha(modelSetBytes));
 assert.equal(provenance.evidence_sha256,sha(indexBytes));
 assert.equal(evidenceIndex.evidence[0].sha256,sha(pairBytes));
 assert.equal(evidenceIndex.evidence[1].sha256,sha(rerunBytes));
 assert.equal(rerun.pair_agreement.compared_queries,5);
 assert.equal(rerun.pair_agreement.agree,5);
 assert.equal(rerun.pair_agreement.disagree,0);
 assert.equal(rerun.execution_summary.native_invocations,10);
 assert.equal(rerun.execution_summary.exit_code_zero,10);
 assert.equal(provenance.evidence_gate,'BYTES_BOUND_UNATTESTED');
 for(const entry of modelSet.cases){
  const bytes=await readFile(new URL('../'+entry.path,import.meta.url));
  assert.equal(sha(bytes),entry.sha256,entry.id);
 }
 for(const observation of pair.observations){
  for(const solver of ['z3','cvc5']){
   const receipt=observation.solvers[solver];
   const bytes=await readFile(new URL('../'+receipt.stdout_path,import.meta.url));
   assert.equal(sha(bytes),receipt.stdout_sha256,observation.id+' '+solver);
   assert.equal(bytes.toString().trim().toUpperCase(),observation.expected_status);
   assert.equal(receipt.exit_code,0);
   assert.equal(receipt.stderr_empty,true);
  }
 }

 for(const observation of rerun.observations){
  for(const solver of ['z3','cvc5']){
   const receipt=observation.solvers[solver];
   const bytes=await readFile(new URL('../'+receipt.stdout_path,import.meta.url));
   const stderr=await readFile(new URL('../'+receipt.stderr_path,import.meta.url));
   assert.equal(sha(bytes),receipt.stdout_sha256,observation.id+' '+solver+' rerun');
   assert.equal(bytes.toString().trim().toUpperCase(),observation.expected_status);
   assert.equal(sha(stderr),receipt.stderr_sha256,observation.id+' '+solver+' stderr');
   assert.equal(receipt.exit_code,0);
   assert.equal(receipt.stderr_empty,true);
  }
 }
 const candidate=sealSolutionCandidate({problem_json:JSON.stringify(problem),
  method_json:JSON.stringify(method),provenance_json:JSON.stringify(provenance)});
 assert.equal(candidate.status,'CANDIDATE',JSON.stringify(candidate));
 assert.equal(candidate.qualification,'NOT_ADMITTED');
 assert.equal(candidate.claim_result,'UNVERIFIED');
 assert.equal(candidate.replay_allowed,false);
 assert.equal(candidate.solution_promotable,false);
 const replay=inspectCandidateReplay(JSON.stringify(candidate),JSON.stringify(provenance));
 assert.equal(replay.status,'REPLAY_BLOCKED_UNQUALIFIED');
 assert.equal(replay.fingerprint,candidate.candidate_sha256);
});

test('xDownload candidate becomes STALE when a pinned solver binary changes',async()=>{
 const [problem,method,provenance]=await Promise.all([
  readJson(new URL('PROBLEM.json',base)),readJson(new URL('METHOD.json',base)),
  readJson(new URL('PROVENANCE.json',base))
 ]);
 const candidate=sealSolutionCandidate({problem_json:JSON.stringify(problem),
  method_json:JSON.stringify(method),provenance_json:JSON.stringify(provenance)});
 assert.equal(candidate.status,'CANDIDATE');
 const drift={...provenance,tool_binary_sha256:'f'.repeat(64)};
 const result=inspectCandidateReplay(JSON.stringify(candidate),JSON.stringify(drift));
 assert.equal(result.status,'STALE');
 assert.deepEqual(result.changed_fields,['tool_binary_sha256']);
 assert.equal(result.replay_allowed,false);
 assert.equal(result.solution_promotable,false);
});
