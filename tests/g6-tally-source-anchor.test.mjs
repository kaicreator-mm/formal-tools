import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Never execute a path-loaded module. Read once, verify the Git Blob,
// then import a data URL constructed from those exact verified bytes.
const sourcePath=new URL('../validation/g6-tally-source-anchor-2026-11-15/TALLY_BUSINESS_SOURCE.mjs',import.meta.url);
const manifestPath=new URL('../validation/g6-tally-source-anchor-2026-11-15/SOURCE_ANCHOR.json',import.meta.url);
const gitBlob=bytes=>createHash('sha1')
  .update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
const expectedSourceBlob='54015fb63ffb13b4f4e562f660d2172098b5f7f4';
const sourceBytes=readFileSync(sourcePath);
const verifiedSourceBlob=gitBlob(sourceBytes);
if(verifiedSourceBlob!==expectedSourceBlob){
  throw new Error('SOURCE_GIT_BLOB_MISMATCH expected='+expectedSourceBlob+' actual='+verifiedSourceBlob);
}
const importVerifiedBuffer=async(bytes,identity='')=>{
  const actual=gitBlob(bytes);
  if(actual!==expectedSourceBlob){
    throw new Error('SOURCE_GIT_BLOB_MISMATCH expected='+expectedSourceBlob+' actual='+actual);
  }
  const fragment=identity?'#'+encodeURIComponent(identity):'';
  const dataUrl='data:text/javascript;base64,'+Buffer.from(bytes).toString('base64')+fragment;
  return import(dataUrl);
};
const {assessTaskEvidence}=await importVerifiedBuffer(sourceBytes);
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const valid={
  issueRef:'https://github.com/kaicreator-mm/tally/issues/108',
  issueNumber:108,
  sourceSha:'a'.repeat(40),
  claimRef:'github:claim:108',
  dependenciesComplete:true
};
const view=value=>({state:value.state,reason:value.reason,admitted:value.admitted,taskPass:value.taskPass});
test('G6 mismatched source Buffer is rejected before module evaluation',async()=>{
  const marker='__g6_unverified_source_module_executed__';
  delete globalThis[marker];
  const mismatched=Buffer.from(
    'globalThis['+JSON.stringify(marker)+']=true; export const executed=true;'
  );
  await assert.rejects(
    importVerifiedBuffer(mismatched,'mismatched-buffer-proof'),
    /SOURCE_GIT_BLOB_MISMATCH/
  );
  assert.equal(Object.hasOwn(globalThis,marker),false);
});
test('G6 path replacement after read cannot change the executed verified Buffer',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'formal-tools-g6-verified-bytes-'));
  const path=join(directory,'TALLY_BUSINESS_SOURCE.mjs');
  const marker='__g6_replaced_path_module_executed__';
  delete globalThis[marker];
  try{
    writeFileSync(path,sourceBytes);
    const verifiedBuffer=readFileSync(path);
    assert.equal(gitBlob(verifiedBuffer),expectedSourceBlob);
    writeFileSync(path,Buffer.from(
      'globalThis['+JSON.stringify(marker)+']=true; export const replaced=true;'
    ));
    const loaded=await importVerifiedBuffer(verifiedBuffer,'path-replacement-proof');
    assert.equal(loaded.assessTaskEvidence(valid).state,'OBSERVED_INPUT_ONLY');
    assert.equal(loaded.replaced,undefined);
    assert.equal(Object.hasOwn(globalThis,marker),false);
  }finally{
    rmSync(directory,{recursive:true,force:true});
  }
});
test('G6 Tally source snapshot is byte-identical to upstream and DIS consumer pin',()=>{
  assert.equal(gitBlob(sourceBytes),expectedSourceBlob);
  assert.equal(manifest.source.git_blob,expectedSourceBlob);
  assert.equal(manifest.consumer_snapshot.git_blob,expectedSourceBlob);
  assert.equal(manifest.formal_tools_snapshot.git_blob,expectedSourceBlob);
  assert.equal(manifest.consumer_snapshot.exact_git_blob_match,true);
});
test('G6 source anchor locks complete Source, Consumer and Original Test provenance metadata',()=>{
  assert.deepEqual(manifest.source,{
    repository:'kaicreator-mm/tally',
    ref:'refs/heads/main',
    commit:'e988321439f65b55936a691c02250b6d62a29409',
    path:'packages/tally-engineering-business/src/index.mjs',
    git_blob:expectedSourceBlob,
    exported_symbol:'assessTaskEvidence',
    source_line_start:26,
    source_line_end:47
  });
  assert.deepEqual(manifest.consumer_snapshot,{
    repository:'kaicreator-mm/domain-harness',
    ref:'90afefa81ef9ad0d42087ffc8a0dbaa32757811f',
    ref_type:'immutable_commit',
    commit:'90afefa81ef9ad0d42087ffc8a0dbaa32757811f',
    path:'examples/dis-v020-cross-project/snapshots/tally/business.mjs',
    git_blob:expectedSourceBlob,
    exact_git_blob_match:true
  });
  assert.deepEqual(manifest.original_tests,{
    repository:'kaicreator-mm/tally',
    ref:'refs/heads/main',
    ref_type:'branch',
    commit:'e988321439f65b55936a691c02250b6d62a29409',
    path:'packages/tally-engineering-business/test/business-policy.test.mjs',
    git_blob:'88c5b6512ff5e8005c02a170d2336a2f6c4090b1',
    relevant_cases:[
      'canonical observed input still cannot grant K admission or Task PASS',
      'unproven DAG dependency refuses',
      'invalid/missing GitHub source identity refuses'
    ],
    authority:'same-project regression tests; not an independent professional semantic Oracle'
  });
  assert.equal(manifest.independent_reference_oracle.file,
    'tests/g6-tally-source-anchor.test.mjs');
  assert.equal(manifest.independent_reference_oracle.status,'PRESENT_IN_THIS_PR');
  assert.equal(manifest.independent_reference_oracle.kind,
    'executable-source-contract-regression-test');
  assert.equal(manifest.independent_reference_oracle.professional_semantic_oracle,false);
  assert.equal(manifest.independent_reference_oracle.independent_business_truth,false);
  assert.equal(manifest.tool_provenance.execution,'LAST_RECORDED_EXACT_HEAD_CI_SUCCESS');
  assert.equal(manifest.tool_provenance.last_successful_exact_head,
    'dd59ea51ee1b82147f6a33fc2e6ed3d9cfa3dc78');
  assert.deepEqual(manifest.tool_provenance.last_successful_ci,{
    provider:'Woodpecker',
    runtime:'Node.js 24.21.0',
    push:{
      pipeline:944,
      status:'SUCCESS',
      target_url:'https://ci.kaicreator.com/repos/39/pipeline/944/1'
    },
    pull_request:{
      pipeline:945,
      status:'SUCCESS',
      target_url:'https://ci.kaicreator.com/repos/39/pipeline/945/1'
    }
  });
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
