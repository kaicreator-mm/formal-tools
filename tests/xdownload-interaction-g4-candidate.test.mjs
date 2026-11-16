import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sealSolutionCandidate,inspectCandidateReplay} from '../packages/runner/js/solution-candidate.mjs';

const base=new URL('../benchmarks/llm-methods/g4/',import.meta.url);
const evidenceUrl=new URL('../validation/xdownload-interaction-2026-11-16/PAIR.json',import.meta.url);
const readJson=async url=>JSON.parse(await readFile(url,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('xDownload bounded dual-solver evidence seals only an unqualified G4 Candidate',async()=>{
 const [problem,method,provenance,pair,model]=await Promise.all([
  readJson(new URL('PROBLEM.json',base)),readJson(new URL('METHOD.json',base)),
  readJson(new URL('PROVENANCE.json',base)),readJson(evidenceUrl),
  readFile(new URL('xdownload-interaction-safety.smt2',base))
 ]);
 assert.equal(pair.pair_agreement.compared_queries,9);
 assert.equal(pair.pair_agreement.agree,9);
 assert.equal(pair.pair_agreement.disagree,0);
 assert.equal(provenance.model_sha256,sha(model));
 assert.equal(provenance.evidence_sha256,sha(await readFile(evidenceUrl)));
 assert.equal(provenance.evidence_gate,'BYTES_BOUND_UNATTESTED');
 const candidate=sealSolutionCandidate({
  problem_json:JSON.stringify(problem),method_json:JSON.stringify(method),
  provenance_json:JSON.stringify(provenance)
 });
 assert.equal(candidate.status,'CANDIDATE',JSON.stringify(candidate));
 assert.equal(candidate.qualification,'NOT_ADMITTED');
 assert.equal(candidate.claim_result,'UNVERIFIED');
 assert.equal(candidate.replay_allowed,false);
 assert.equal(candidate.solution_promotable,false);
 const replay=inspectCandidateReplay(JSON.stringify(candidate),JSON.stringify(provenance));
 assert.equal(replay.status,'REPLAY_BLOCKED_UNQUALIFIED');
 assert.equal(replay.fingerprint,candidate.candidate_sha256);
});

test('xDownload candidate becomes STALE when either solver binary pin changes',async()=>{
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
