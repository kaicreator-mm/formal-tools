import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assessTaskEvidence} from '../validation/g6-tally-source-anchor-2026-11-15/TALLY_BUSINESS_SOURCE.mjs';

const sourcePath=new URL('../validation/g6-tally-source-anchor-2026-11-15/TALLY_BUSINESS_SOURCE.mjs',import.meta.url);
const manifestPath=new URL('../validation/g6-tally-source-anchor-2026-11-15/SOURCE_ANCHOR.json',import.meta.url);
const sourceBytes=readFileSync(sourcePath);
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const gitBlob=bytes=>createHash('sha1')
  .update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
const expectedSourceBlob='54015fb63ffb13b4f4e562f660d2172098b5f7f4';
const valid={
  issueRef:'https://github.com/kaicreator-mm/tally/issues/108',
  issueNumber:108,
  sourceSha:'a'.repeat(40),
  claimRef:'github:claim:108',
  dependenciesComplete:true
};
const view=value=>({state:value.state,reason:value.reason,admitted:value.admitted,taskPass:value.taskPass});
test('G6 Tally source snapshot is byte-identical to upstream and DIS consumer pin',()=>{
  assert.equal(gitBlob(sourceBytes),expectedSourceBlob);
  assert.equal(manifest.source.git_blob,expectedSourceBlob);
  assert.equal(manifest.consumer_snapshot.git_blob,expectedSourceBlob);
  assert.equal(manifest.formal_tools_snapshot.git_blob,expectedSourceBlob);
  assert.equal(manifest.consumer_snapshot.exact_git_blob_match,true);
});
test('G6 valid source identity is advisory only and never admits or passes a Task',()=>{
  const result=assessTaskEvidence(valid);
  assert.deepEqual(view(result),{
    state:'OBSERVED_INPUT_ONLY',
    reason:'REQUIRES_NATIVE_CLAIM_AND_KERNEL_ADMISSION',
    admitted:false,
    taskPass:false
  });
  assert.equal(Object.hasOwn(result,'authorized'),false);
});
test('G6 missing and non-object inputs fail closed without admission',()=>{
  for(const input of [undefined,null,[],{},'not-an-object']){
    const result=assessTaskEvidence(input);
    assert.deepEqual(view(result),{
      state:'UNQUALIFIED_INPUT',
      reason:input&&typeof input==='object'&&!Array.isArray(input)?
        'MISSING_SOURCE_IDENTITY':'MISSING_INPUT',
      admitted:false,
      taskPass:false
    });
  }
});
test('G6 invalid source identity fails closed before dependency interpretation',()=>{
  const cases=[
    {...valid,issueRef:'https://example.invalid/tally/issues/108'},
    {...valid,issueNumber:109},
    {...valid,issueNumber:0},
    {...valid,issueNumber:108.5},
    {...valid,sourceSha:'A'.repeat(40)},
    {...valid,sourceSha:'not-a-sha'},
    {...valid,claimRef:''},
    {...valid,claimRef:'x'.repeat(513)}
  ];
  for(const input of cases){
    assert.deepEqual(view(assessTaskEvidence(input)),{
      state:'UNQUALIFIED_INPUT',
      reason:'MISSING_SOURCE_IDENTITY',
      admitted:false,
      taskPass:false
    });
  }
});
test('G6 dependenciesComplete must be exactly true and never promotes a claim',()=>{
  for(const dependenciesComplete of [false,undefined,null,0,'true',1]){
    const result=assessTaskEvidence({...valid,dependenciesComplete});
    assert.deepEqual(view(result),{
      state:'UNQUALIFIED_INPUT',
      reason:'DEPENDENCIES_UNVERIFIED',
      admitted:false,
      taskPass:false
    });
  }
});
test('G6 bounded metamorphic variants preserve advisory-only non-promotion',()=>{
  for(const issueNumber of [1,2,108,999999]){
    const result=assessTaskEvidence({
      issueRef:'https://github.com/kaicreator-mm/tally/issues/'+issueNumber,
      issueNumber,
      sourceSha:String(issueNumber).padStart(40,'0'),
      claimRef:'claim:'+issueNumber,
      dependenciesComplete:true
    });
    assert.equal(result.state,'OBSERVED_INPUT_ONLY');
    assert.equal(result.admitted,false);
    assert.equal(result.taskPass,false);
  }
});
