import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inspectDownloadGoal,confirmDownloadGoal,INTERACTION_SOURCE_VERSION} from
 '../benchmarks/llm-methods/g4/semantic/source/download-goal.mjs';

const sourceUrl=new URL('../benchmarks/llm-methods/g4/semantic/source/download-goal.mjs',import.meta.url);
const mappingUrl=new URL('../benchmarks/llm-methods/g4/semantic/MAPPING.json',import.meta.url);
const modelSetUrl=new URL('../benchmarks/llm-methods/g4/MODEL_SET.json',import.meta.url);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\\0').update(bytes).digest('hex');
const valid=()=>({channel:'cli',requestId:'req_01',url:'https://example.com/a',declaredBytes:12});
const confirm=(proposal=valid(),confirmed=true,answers={},draftFields={})=>
 confirmDownloadGoal({draft:{proposal,...draftFields},answers,confirmed});
const noEffects=(response)=>{
 assert.equal(response.authority,'NONE');
 assert.equal(response.effectDispatched,false);
 assert.equal(Object.isFrozen(response),true);
};

test('pins exact original source, five frozen SMT Git Blobs and explicit qualification limits',async()=>{
 const [sourceBytes,mapBytes,modelBytes]=await Promise.all([
  readFile(sourceUrl),readFile(mappingUrl),readFile(modelSetUrl)
 ]);
 const map=JSON.parse(mapBytes),model=JSON.parse(modelBytes);
 assert.equal(INTERACTION_SOURCE_VERSION,'dis.v0.2.download-interaction/1');
 assert.equal(gitBlob(sourceBytes),'f57747aa7996c88833e72288a0acd594a7ce5468');
 assert.equal(sha256(sourceBytes),map.source.sha256);
 assert.equal(map.source.git_blob,gitBlob(sourceBytes));
 assert.equal(gitBlob(modelBytes),map.model.git_blob);
 assert.equal(sha256(modelBytes),map.model.sha256);
 assert.equal(map.source_to_model.length,5);
 assert.equal(model.cases.length,5);
 for(let i=0;i<model.cases.length;i++){
  const sourceMap=map.source_to_model[i];
  const row=model.cases[i];
  assert.equal(sourceMap.case_id,row.id);
  assert.equal(sourceMap.expected_solver,row.expected_status);
  assert.equal(sourceMap.smt,row.path.split('/').at(-1));
  const data=await readFile(new URL('../'+row.path,import.meta.url));
  assert.equal(sha256(data),row.sha256,row.id);
  assert.equal(gitBlob(data),sourceMap.git_blob,row.id);
  assert.ok(sourceMap.assumptions.length>0);
  assert.ok(sourceMap.cannot_prove.length>0);
 }
 assert.equal(map.qualification.semantic_review,'PENDING_INDEPENDENT_SOURCE_FIRST');
 assert.equal(map.qualification.authority,'NOT_ATTESTED');
 assert.equal(map.qualification.g4_trust_roots,'NOT_CONFIGURED');
 assert.equal(map.qualification.candidate,'NOT_ADMITTED');
 assert.equal(map.qualification.replay_allowed,false);
 assert.equal(map.qualification.effect_authorized,false);
});

test('valid source inspect and confirmed revalidation match only the bounded SAT witness',()=>{
 const proposal=valid();
 const inspected=inspectDownloadGoal(proposal);
 assert.equal(inspected.status,'AWAITING_CONFIRMATION');
 assert.equal(inspected.proposal.url,'https://example.com/a');
 noEffects(inspected);
 const response=confirm(inspected.proposal);
 assert.equal(response.status,'READY_FOR_KDP');
 assert.equal(response.permittedEffect,false);
 assert.equal(response.prerequisite,'A_SEPARATE_SELECTED_KDP_INTENT_CALL_IS_REQUIRED');
 noEffects(response);
});

test('unconfirmed/nonboolean confirmed stays AWAITING_CONFIRMATION, not READY',()=>{
 for(const confirmed of [false,undefined,null,'true',1]){
  const response=confirm(valid(),confirmed);
  assert.equal(response.status,'AWAITING_CONFIRMATION',String(confirmed));
  noEffects(response);
 }
});

test('missing source input returns clarification, not the SMT abstract invalid=REJECTED',()=>{
 for(const removed of ['url','declaredBytes']){
  const input=valid();
  delete input[removed];
  const observed=inspectDownloadGoal(input);
  assert.equal(observed.status,'CLARIFICATION_REQUIRED',removed);
  assert.deepEqual([...observed.missing],[removed]);
  noEffects(observed);
  const rechecked=confirm(input,true);
  assert.equal(rechecked.status,'CLARIFICATION_REQUIRED',removed);
  noEffects(rechecked);
 }
});

test('concrete channel/request ID and HTTPS URL rejection branches are not SMT-derived',()=>{
 const changes=[
  {channel:'other'},
  {requestId:'bad id'},
  {url:'http://example.com/a'},
  {url:'https://user:pass@example.com/a'},
  {url:'https://example.com/a#fragment'},
  {url:'https://example.com/a?token=abc'},
  {url:'not a valid URL'}
 ];
 for(const changed of changes){
  const input={...valid(),...changed};
  const response=inspectDownloadGoal(input);
  assert.equal(response.status,'REJECTED',JSON.stringify(changed));
  assert.notEqual(confirm(input,true).status,'READY_FOR_KDP',JSON.stringify(changed));
  noEffects(response);
 }
 const allowed=inspectDownloadGoal({...valid(),url:'https://example.com/a?mytoken=abc'});
 assert.equal(allowed.status,'AWAITING_CONFIRMATION');
 assert.equal(allowed.proposal.url,'https://example.com/a?mytoken=abc');
 noEffects(allowed);
 const normalized=inspectDownloadGoal({...valid(),url:'https://EXAMPLE.com/a/../b'});
 assert.equal(normalized.status,'AWAITING_CONFIRMATION');
 assert.equal(normalized.proposal.url,'https://example.com/b');
 noEffects(normalized);
});

test('declaredBytes exact source boundary 0/1/1MiB/1MiB+1',()=>{
 const cases=[
  [0,'REJECTED'],[1,'AWAITING_CONFIRMATION'],
  [1048576,'AWAITING_CONFIRMATION'],[1048577,'REJECTED'],
  [-1,'REJECTED'],[1.5,'REJECTED']
 ];
 for(const [declaredBytes,expected] of cases){
  const res=inspectDownloadGoal({...valid(),declaredBytes});
  assert.equal(res.status,expected,String(declaredBytes));
  noEffects(res);
 }
});

test('undeclared answers reject regardless of externally supplied draft READY status',()=>{
 const response=confirm(valid(),true,{unauthorized:true},{status:'READY_FOR_KDP'});
 assert.equal(response.status,'REJECTED');
 assert.equal(response.reason,'UNDECLARED_ANSWER');
 noEffects(response);
 const invalid=confirm({...valid(),url:'http://example.com/a'},true,{}, {status:'READY_FOR_KDP'});
 assert.equal(invalid.status,'REJECTED');
 noEffects(invalid);
});

test('counterexample: forged draft status and absent previous inspect do not prevent pure confirm READY',()=>{
 // This refutes a temporal or "forged draft status always rejected" claim.
 // The source REVALIDATES the supplied proposal; it does not authenticate
 // previous inspect history. The pure function has no such session store.
 const fabricated=confirm(valid(),true,{}, {status:'READY_FOR_KDP'});
 assert.equal(fabricated.status,'READY_FOR_KDP');
 assert.equal(fabricated.permittedEffect,false);
 noEffects(fabricated);
});

test('scope counterexamples: nonenumerable fields and thrown getters are outside selected safe DTO',()=>{
 const withHidden=valid();
 Object.defineProperty(withHidden,'hidden',{value:99,enumerable:false});
 const got=inspectDownloadGoal(withHidden);
 assert.equal(got.status,'AWAITING_CONFIRMATION');
 noEffects(got);
 let getterCalls=0;
 const hostile=valid();
 Object.defineProperty(hostile,'channel',{
  enumerable:true,configurable:true,
  get(){getterCalls++;throw new Error('GETTER_TRAP');}
 });
 assert.throws(()=>inspectDownloadGoal(hostile),/GETTER_TRAP/);
 assert.equal(getterCalls,1);
 // No Host UNKNOWN or no-Effect theorem can be deduced from this direct JS throw.
});
