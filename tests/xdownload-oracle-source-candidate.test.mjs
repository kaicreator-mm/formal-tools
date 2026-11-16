import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assessMethod} from '../packages/runner/js/method-planner.mjs';
import {sealSolutionCandidate,inspectCandidateReplay} from '../packages/runner/js/solution-candidate.mjs';

const root=new URL('../benchmarks/llm-methods/g4/oracle-source-candidate/',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const json=async name=>JSON.parse(await read(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.byteLength+'\0').update(bytes).digest('hex');

test('separate R10 source is immutable and explicitly not an accepted Oracle',async()=>{
 const [bytes,gate]=await Promise.all([readFile(new URL('DIS_R10_POLICY_SOURCE.md',root)),json('ADOPTION_GATE.json')]);
 const document=bytes.toString('utf8');
 assert.equal(gitBlob(bytes),gate.oracle_candidate.git_blob);
 assert.equal(gitBlob(bytes),'db6de58693614c6f653cce60f35c00d34be4829b');
 assert.equal(sha(bytes),gate.oracle_candidate.sha256);
 assert.equal(sha(bytes),'c17135d98dfa2134a64d053328dc7b0440dab51a9e353215abe097e1335ca4b1');
 assert.match(document,/Candidate only/);
 assert.match(document,/READY_FOR_KDP/);
 assert.match(document,/separate selected KDP Intent call/);
 assert.equal(gate.oracle_candidate.qualified_oracle,false);
 assert.equal(gate.oracle_candidate.independent_professional_review,'NOT_DONE');
 assert.equal(gate.oracle_candidate.source_owner_adoption,'NOT_DONE');
 assert.equal(gate.policy.trust_roots,'NOT_CONFIGURED');
 assert.equal(gate.cases.length,5);
});

test('v0.2 separate oracle source Candidate structurally valid, always unqualified',async()=>{
 const [problem,method,prov,gate]=await Promise.all([
  json('PROBLEM_CANDIDATE.json'),json('METHOD_CANDIDATE.json'),
  json('PROVENANCE_CANDIDATE.json'),json('ADOPTION_GATE.json')
 ]);
 const oracle=problem.oracles.find(o=>o.id===prov.oracle_id);
 assert.equal(prov.schema,'formal-tools/solution-provenance/0.2');
 assert.equal(prov.source_id,'xdownload_interaction');
 assert.equal(prov.oracle_source_id,'xdownload_dis_r10_policy_source');
 assert.notEqual(prov.source_id,prov.oracle_source_id);
 assert.notEqual(prov.source_sha256,prov.oracle_sha256);
 assert.equal(prov.source_sha256,gate.source.sha256);
 assert.equal(prov.oracle_sha256,gate.oracle_candidate.sha256);
 assert.equal(oracle.source_ref,prov.oracle_source_id);
 assert.equal(oracle.frozen,true);
 assert.equal(oracle.review_identity,'professional_oracle_pending');
 assert.equal(problem.source_refs.find(s=>s.id===prov.oracle_source_id).sha256,prov.oracle_sha256);
 assert.equal(prov.evidence_gate,'BYTES_BOUND_UNATTESTED');
 const assessment=assessMethod(problem,method);
 assert.equal(assessment.status,'STRUCTURALLY_VALID',JSON.stringify(assessment.issues??[]));
 const candidate=sealSolutionCandidate({problem_json:JSON.stringify(problem),method_json:JSON.stringify(method),provenance_json:JSON.stringify(prov)});
 assert.equal(candidate.status,'CANDIDATE',JSON.stringify(candidate.issues??[]));
 assert.equal(candidate.provenance.oracle_source_id,prov.oracle_source_id);
 assert.equal(candidate.qualification,'NOT_ADMITTED');
 assert.equal(candidate.claim_result,'UNVERIFIED');
 assert.equal(candidate.replay_allowed,false);
 assert.equal(candidate.solution_promotable,false);
 const exact=inspectCandidateReplay(JSON.stringify(candidate),JSON.stringify(prov));
 assert.equal(exact.status,'REPLAY_BLOCKED_UNQUALIFIED');
 assert.equal(exact.replay_allowed,false);
 for(const field of ['oracle_source_id','oracle_sha256','source_sha256','tool_version','evidence_sha256']){
  const altered={...prov,[field]:field.endsWith('_sha256')?'f'.repeat(64):'changed_'+field};
  const changed=inspectCandidateReplay(JSON.stringify(candidate),JSON.stringify(altered));
  assert.equal(changed.status,'STALE',field);
  assert.equal(changed.replay_allowed,false);
  assert.ok(changed.changed_fields.includes(field));
 }
 const badProblem=JSON.parse(JSON.stringify(problem));
 badProblem.source_refs.find(x=>x.id===prov.oracle_source_id).sha256='0'.repeat(64);
 const bad=sealSolutionCandidate({problem_json:JSON.stringify(badProblem),method_json:JSON.stringify(method),provenance_json:JSON.stringify(prov)});
 assert.equal(bad.status,'BLOCKED');
 assert.equal(bad.replay_allowed,false);
});

test('production trust-root registry is unconfigured; policy candidate authorizes nothing',async()=>{
 const anchors=JSON.parse(await readFile(new URL('../registry/G4_QUALIFICATION_ANCHORS.json',import.meta.url),'utf8'));
 const gate=await json('ADOPTION_GATE.json');
 assert.equal(anchors.status,'NOT_CONFIGURED');
 assert.deepEqual(anchors.anchors,[]);
 assert.equal(gate.status,'UNADOPTED_DEMO_POLICY_REFERENCE');
 assert.equal(gate.policy.source_owner_signer,'NOT_PROVIDED');
 assert.equal(gate.policy.professional_oracle_signer,'NOT_PROVIDED');
 assert.equal(gate.policy.trusted_host_signer,'NOT_PROVIDED');
 assert.equal(gate.policy.positive_replay,'BLOCKED_UNQUALIFIED');
 assert.equal(gate.policy.effect_authorized,false);
 assert.equal(gate.existing_native_evidence.new_solver_runs,0);
});