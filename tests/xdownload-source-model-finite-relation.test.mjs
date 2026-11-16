import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inspectDownloadGoal,confirmDownloadGoal} from
 '../benchmarks/llm-methods/g4/semantic/source/download-goal.mjs';

const root=new URL('../benchmarks/llm-methods/g4/',import.meta.url);
const manifestUrl=new URL('semantic/FINITE_RELATION.json',root);
const sourceUrl=new URL('semantic/source/download-goal.mjs',root);
const modelSetUrl=new URL('MODEL_SET.json',root);
const blob=bytes=>createHash('sha1').update('blob '+bytes.byteLength+'\0').update(bytes).digest('hex');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const flags=[
 'channel_ok','request_id_ok','url_ok','size_ok',
 'answers_allowed','confirmed','injected_draft_ready'
];

test('G4 finite mapping source/model origin, exact immutable formula anchors and scoped gate',async()=>{
 const [mBytes,sourceBytes,modelBytes,priorBytes]=await Promise.all([
  readFile(manifestUrl),readFile(sourceUrl),readFile(modelSetUrl),
  readFile(new URL('semantic/MAPPING.json',root))
 ]);
 const m=JSON.parse(mBytes.toString('utf8'));
 const prior=JSON.parse(priorBytes.toString('utf8'));
 const model=JSON.parse(modelBytes.toString('utf8'));
 assert.equal(m.schema,'formal-tools/g4-finite-source-model-relation/0.1');
 assert.equal(m.source.git_blob,blob(sourceBytes));
 assert.equal(m.source.sha256,sha256(sourceBytes));
 assert.equal(m.source.git_blob,prior.source.git_blob);
 assert.equal(m.model.git_blob,blob(modelBytes));
 assert.equal(m.model.sha256,sha256(modelBytes));
 assert.deepEqual(m.representative_flags,flags);
 assert.equal(m.expected_rows,2**flags.length);
 assert.equal(m.model.original_case_git_blobs.length,5);
 for(let i=0;i<model.cases.length;i++){
  const c=model.cases[i];
  const bytes=await readFile(new URL('../../../'+c.path,root));
  assert.equal(m.model.original_case_git_blobs[i].git_blob,blob(bytes),c.id);
  assert.equal(prior.source_to_model[i].git_blob,blob(bytes),c.id);
  assert.equal(sha256(bytes),c.sha256,c.id);
 }
 const validSmt=await readFile(new URL('cases/01-valid-inspect-and-confirm.smt2',root),'utf8');
 const draftSmt=await readFile(new URL('cases/04-undeclared-answer-and-forged-draft-cannot-be-ready.smt2',root),'utf8');
 const effectSmt=await readFile(new URL('cases/05-effect-is-unreachable.smt2',root),'utf8');
 assert.ok(validSmt.includes('(assert (= input_valid (and channel_ok request_id_ok url_ok size_ok)))'));
 assert.ok(validSmt.includes('(assert (= inspect_awaiting_confirmation input_valid))'));
 assert.ok(validSmt.includes('(assert (= confirm_ready_for_kdp (and input_valid answers_allowed confirmed)))'));
 assert.ok(draftSmt.includes('(assert (not answers_allowed))'));
 assert.ok(draftSmt.includes('(assert injected_draft_ready)'));
 assert.equal((draftSmt.match(/\binjected_draft_ready\b/g)||[]).length,2);
 assert.ok(effectSmt.includes('(assert (= effect_dispatched false))'));
 assert.ok(effectSmt.includes('(assert (= permitted_effect false))'));
 assert.equal(m.equations.injected_draft_ready,'NON_CAUSAL_NOT_IN_FROZEN_READY_FORMULA');
 assert.equal(m.qualification.trust_roots,'NOT_CONFIGURED');
 assert.equal(m.qualification.candidate,'NOT_ADMITTED');
 assert.equal(m.qualification.replay_allowed,false);
 assert.equal(m.qualification.positive_replay,'BLOCKED_UNQUALIFIED');
});

test('128/128 selected ordinary DTO truth table matches the frozen Boolean relation',async()=>{
 const m=JSON.parse(await readFile(manifestUrl,'utf8'));
 const seen=new Set();
 let ready=0,validInspect=0,forgedReady=0;
 for(let mask=0;mask<m.expected_rows;mask++){
  const bit={};
  for(let i=0;i<flags.length;i++)bit[flags[i]]=Boolean(mask&(1<<i));
  const combo=flags.map(k=>Number(bit[k])).join('');
  assert.equal(seen.has(combo),false,'duplicate finite representative');
  seen.add(combo);
  const input=Object.freeze({
   channel:bit.channel_ok?'cli':'INVALID_CHANNEL',
   requestId:bit.request_id_ok?'req_01':'bad id',
   url:bit.url_ok?'https://example.com/a':'http://example.com/a',
   declaredBytes:bit.size_ok?12:0
  });
  assert.equal(Object.getPrototypeOf(input),Object.prototype);
  const allowed=bit.answers_allowed;
  const answers=allowed?Object.freeze({}):Object.freeze({unapproved:'x'});
  const draftStatus=bit.injected_draft_ready?'READY_FOR_KDP':'REJECTED';
  const draft=Object.freeze({proposal:input,status:draftStatus});
  const valid=bit.channel_ok&&bit.request_id_ok&&bit.url_ok&&bit.size_ok;
  const expectedReady=valid&&allowed&&bit.confirmed;
  const inspection=inspectDownloadGoal(input);
  const confirmation=confirmDownloadGoal({draft,answers,confirmed:bit.confirmed});
  assert.equal(inspection.status,valid?'AWAITING_CONFIRMATION':'REJECTED',combo);
  assert.equal(confirmation.status,expectedReady?'READY_FOR_KDP':(!valid||!allowed?'REJECTED':'AWAITING_CONFIRMATION'),combo);
  assert.equal(confirmation.status==='READY_FOR_KDP',expectedReady,combo);
  assert.equal(inspection.authority,'NONE',combo);
  assert.equal(confirmation.authority,'NONE',combo);
  assert.equal(inspection.effectDispatched,false,combo);
  assert.equal(confirmation.effectDispatched,false,combo);
  assert.equal(Object.isFrozen(inspection),true);
  assert.equal(Object.isFrozen(confirmation),true);
  if(expectedReady){
   assert.equal(confirmation.permittedEffect,false);
   assert.equal(confirmation.prerequisite,'A_SEPARATE_SELECTED_KDP_INTENT_CALL_IS_REQUIRED');
   ready++;
   if(bit.injected_draft_ready)forgedReady++;
  }else{
   // The pure function does not emit permittedEffect in rejection/clarification.
   // Do not invent a Host Effect permission conclusion from this absence.
   assert.equal(Object.hasOwn(confirmation,'permittedEffect'),false);
  }
  if(valid)validInspect++;
 }
 assert.equal(seen.size,128);
 assert.equal(validInspect,8);
 assert.equal(ready,2);
 assert.equal(forgedReady,1);
});

test('draft.status is non-causal and no original inspect event is required by pure confirm',()=>{
 const plain=Object.freeze({channel:'cli',requestId:'req_01',url:'https://example.com/a',declaredBytes:12});
 const a=confirmDownloadGoal({draft:{proposal:plain,status:'READY_FOR_KDP'},answers:{},confirmed:true});
 const b=confirmDownloadGoal({draft:{proposal:plain,status:'REJECTED'},answers:{},confirmed:true});
 assert.equal(a.status,'READY_FOR_KDP');
 assert.equal(b.status,'READY_FOR_KDP');
 assert.equal(a.authority,'NONE');
 assert.equal(a.effectDispatched,false);
 assert.equal(a.permittedEffect,false);
 // These are independently created drafts, never produced by inspect.
 // No authority/Effect grant follows from either observation.
});
