import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {observeTypedGuard,decideTypedConfirmed,PROFILE_BOUND} from '../benchmarks/llm-methods/g4/product-refinement/typed-t03-successor/typed-t03.mjs';
import {MAX_DECLARED_BYTES,validateConfirmedIntent} from '../benchmarks/llm-methods/g4/product-refinement/model/t01-intent-model.mjs';
import {materializePayload,runMatrix} from '../benchmarks/llm-methods/g4/product-refinement/kernel-lte-differential/differential-drive.mjs';
const root=new URL('../benchmarks/llm-methods/g4/product-refinement/',import.meta.url);
const evidence=JSON.parse(await readFile(new URL('typed-t03-successor/SUCCESSOR.json',root),'utf8'));
const receipt=JSON.parse(await readFile(new URL('kernel-lte-differential/DIFFERENTIAL.json',root),'utf8'));
/** @param {string} path */
async function gitBlob(path){
 const bytes=await readFile(new URL(path,root));
 return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
test('immutable predecessor evidence and executable inputs',async()=>{
 for(const [path,blob] of [
  ['kernel-lte-differential/DIFFERENTIAL.json',evidence.historical.receiptGitBlob],
  ['kernel-lte-differential/differential-drive.mjs',evidence.historical.driverGitBlob],
  ['model/t03-effect-gate-model.mjs',evidence.historical.oldModelGitBlob],
  ['kernel-lte-differential/original-snapshot/kernel-mechanism-v1.mjs',evidence.historical.kernelGitBlob]
 ]) assert.equal(await gitBlob(path),blob,path);
});
test('actual sealed Kernel and immutable old v1 replay; typed v2 removes all five false-acquires',async()=>{
 const old=await runMatrix(receipt.cases);
 assert.equal(old.length,19);
 assert.deepEqual(evidence.cases.map(x=>x.id),receipt.cases.map(x=>x.id));
 const counts={GUARD_TRUE:0,GUARD_FALSE:0,PREPARATION_ERROR:0};
 let historicalFalse=0,newFalse=0;
 for(const [i,entry] of receipt.cases.entries()){
  const live=old[i], expected=evidence.cases[i], payload=materializePayload(entry);
  assert.equal(live.verdict,entry.expect.verdict,entry.id);
  const next=observeTypedGuard(payload);
  assert.equal(next.kind,expected.expected,entry.id);
  const actualKind=live.kernelGuard.preparationError?'PREPARATION_ERROR':live.kernelGuard.enveloped?'GUARD_TRUE':'GUARD_FALSE';
  assert.equal(next.kind,actualKind,entry.id);
  counts[next.kind]++;
  assert.equal(next.authority,'NONE');assert.equal(next.effectDispatched,false);
  if(expected.historicalFalseAcquire){
   historicalFalse++;
   assert.equal(live.model.transition,'acquire');
   assert.equal(next.passed,false);
   assert.equal(decideTypedConfirmed({...valid(1),declaredBytes:payload.declaredBytes}).effectIntents.length,0);
  }
  if(next.passed && !live.kernelGuard.enveloped)newFalse++;
  if(next.passed) assert.equal(live.kernelAdmission.code,'ADMISSION_EFFECT_BINDING_UNVALIDATED');
 }
 assert.deepEqual(counts,{GUARD_TRUE:5,GUARD_FALSE:11,PREPARATION_ERROR:3});
 assert.equal(historicalFalse,5);assert.equal(newFalse,0);
});
/** @param {any} n */
function valid(n){
 return {requestId:'req-1',lineageId:'lineage-1',targetRef:'ref:opaque',outputRootScope:'/tmp/downloads',allowedOperation:'acquisition.acquire',slice:'S3',declaredBytes:n,caller:{actor:'actor',sessionRef:'session'}};
}
test('exact 1 MiB profile vs separate 1 TiB T01 grammar, raw nonpositive direction never grants intent',()=>{
 assert.equal(PROFILE_BOUND,1048576);
 for(const n of [1,PROFILE_BOUND-1,PROFILE_BOUND]){
  const out=decideTypedConfirmed(valid(n));
  assert.equal(out.transition,'acquire');assert.equal(out.effectIntents.length,1);
  assert.equal(out.effectIntents[0].executed,false);
  assert.equal(out.effectDispatched,false);assert.equal(out.authority,'NONE');
 }
 for(const n of [0,-1,.5,PROFILE_BOUND+1,MAX_DECLARED_BYTES,MAX_DECLARED_BYTES+1]){
  assert.equal(decideTypedConfirmed(valid(n)).effectIntents.length,0);
 }
 for(const n of [0,-1,.5])assert.equal(observeTypedGuard({declaredBytes:n}).passed,true);
 assert.equal(validateConfirmedIntent(valid(MAX_DECLARED_BYTES)).ok,true);
 assert.equal(validateConfirmedIntent(valid(MAX_DECLARED_BYTES+1)).ok,false);
 const absent=valid(1);delete absent.declaredBytes;
 assert.equal(observeTypedGuard(absent).reason,'MISSING_OPERAND');
 assert.equal(decideTypedConfirmed(absent).transition,'refuse');
});
test('hostile own-data boundary: no getter, coercion or Proxy trap executed',()=>{
 let calls=0;
 const accessor=Object.defineProperty(valid(1),'declaredBytes',{get(){calls++;return 1},enumerable:true});
 const inner=Object.defineProperty({},'actor',{get(){calls++;return 'actor'},enumerable:true});
 const proxy=new Proxy(valid(1),{get(){calls++;throw Error('trap')},ownKeys(){calls++;throw Error('trap')},getPrototypeOf(){calls++;throw Error('trap')}});
 const coercion={valueOf(){calls++;return 1},[Symbol.toPrimitive](){calls++;return 1}};
 const cyclic=valid(1);Object.assign(cyclic,{cycle:cyclic});
 const bad=[accessor,proxy,{...valid(1),caller:inner},{...valid(1),declaredBytes:coercion},Object.create({declaredBytes:1}),{...valid(1),declaredBytes:undefined},{...valid(1),declaredBytes:NaN},{...valid(1),declaredBytes:Infinity},{...valid(1),declaredBytes:1n},{...valid(1),declaredBytes:new Proxy([1],{get(){calls++;throw Error('trap')}})},cyclic];
 for(const value of bad){
  assert.equal(observeTypedGuard(value).kind,'PREPARATION_ERROR');
  assert.equal(decideTypedConfirmed(value).effectIntents.length,0);
 }
 assert.equal(calls,0);
});
