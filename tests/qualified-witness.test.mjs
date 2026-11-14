import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectWitnessCrypto,inspectQualificationPreflight}
 from '../packages/runner/js/qualification-witness.mjs';
import {persistSolutionCandidate,revokeStoredCandidate}
 from '../packages/runner/js/solution-store.mjs';
import {buildRealLifecycleCandidate}
 from '../benchmarks/llm-methods/g4/real-provenance.mjs';

const roles=['SOURCE_OWNER','INDEPENDENT_ORACLE','TRUSTED_HOST'];
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):plain(x)?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const bytes=(subject,role)=>Buffer.from(JSON.stringify(canonical({subject,role})));
function fixture(){
 const source=buildRealLifecycleCandidate();
 const {candidate,provenance}=source;
 const now=Date.now(),scope='SYNTHETIC_FIXTURE_TEST_ONLY';
 const subject={schema:'formal-tools/qualification-subject/0.1',
   candidate_sha256:candidate.candidate_sha256,
   problem_sha256:candidate.problem_sha256,method_sha256:candidate.method_sha256,
   source_id:provenance.source_id,source_sha256:provenance.source_sha256,
   oracle_id:provenance.oracle_id,oracle_sha256:provenance.oracle_sha256,
   model_sha256:provenance.model_sha256,tool_id:provenance.tool_id,
   tool_version:provenance.tool_version,tool_binary_sha256:provenance.tool_binary_sha256,
   evidence_sha256:provenance.evidence_sha256,
   claim_ref:'ads.synthetic.r1-r2-r3.claim',scope,
   valid_from_ms:now-5000,valid_until_ms:now+60000};
 const keys=roles.map(role=>({role,...generateKeyPairSync('ed25519')}));
 const anchors=keys.map(({role,publicKey},i)=>({role,key_id:'testkey'+i,
   public_key_spki_der_b64:publicKey.export({format:'der',type:'spki'}).toString('base64'),
   allowed_scope:scope}));
 const signatures=keys.map(({role,privateKey},i)=>({role,key_id:'testkey'+i,
   signature_b64:sign(null,bytes(subject,role),privateKey).toString('base64')}));
 const roots={schema:'formal-tools/g4-trust-roots/0.1',status:'PRODUCT_APPROVED',anchors};
 const bundle={schema:'formal-tools/qualification-witnesses/0.1',subject,signatures};
 const request=()=>({candidate,current_provenance:provenance,bundle,roots,now_ms:now});
 return {source,candidate,provenance,now,keys,roots,bundle,request};
}
const noAuthority=x=>{assert.equal(x.qualified_solution,false);assert.equal(x.replay_allowed,false);
 assert.equal(x.claim_result,'UNVERIFIED');assert.equal(x.dis_host_executed,false)};
test('G4 triad is cryptographically valid in synthetic test but NEVER authorizes Replay',()=>{
 const a=fixture(),result=inspectWitnessCrypto(a.request());
 assert.equal(result.status,'CRYPTOGRAPHICALLY_BOUND_UNQUALIFIED');
 assert.deepEqual(result.roles_verified,roles);noAuthority(result);
});
test('G4 forged owner signature fails before any authority',()=>{
 const a=fixture();a.bundle.signatures[0].signature_b64=a.bundle.signatures[1].signature_b64;
 const x=inspectWitnessCrypto(a.request());assert.equal(x.status,'BLOCKED');noAuthority(x);
});
test('G4 duplicate role, duplicate signer, and wrong key IDs all fail',()=>{
 for(const mutation of [
  a=>{a.bundle.signatures[0].role=a.bundle.signatures[1].role},
  a=>{a.roots.anchors[1].public_key_spki_der_b64=a.roots.anchors[0].public_key_spki_der_b64},
  a=>{a.bundle.signatures[1].key_id='caller-chosen-key'},
 ]){const a=fixture();mutation(a);const x=inspectWitnessCrypto(a.request());
   assert.equal(x.status,'BLOCKED');noAuthority(x);}
});
test('G4 Subject digest binds candidate, source, model, oracle, tool and evidence',()=>{
 const changes=[['candidate_sha256','0'.repeat(64)],['source_sha256','a'.repeat(64)],
   ['oracle_sha256','b'.repeat(64)],['model_sha256','c'.repeat(64)],
   ['tool_binary_sha256','d'.repeat(64)],['evidence_sha256','e'.repeat(64)],
   ['tool_version','forged']];
 for(const [key,value] of changes){const a=fixture();a.bundle.subject[key]=value;
   const x=inspectWitnessCrypto(a.request());assert.equal(x.status,'BLOCKED',key);noAuthority(x);}
});
test('G4 expired and premature signatures are STALE, even if signatures were otherwise valid',()=>{
 for(const time of [-100000,100000]){const a=fixture();
   const x=inspectWitnessCrypto({...a.request(),now_ms:a.now+time});
   assert.equal(x.status,'STALE');noAuthority(x);}
});
test('G4 missing real Product anchors never upgrades a real persisted candidate',async()=>{
 const a=fixture(),dir=mkdtempSync(join(tmpdir(),'ft-g4-ownerwitness-'));
 try{
  const stored=await persistSolutionCandidate({store_dir:dir,...a.source});
  assert.equal(stored.status,'CANDIDATE_PERSISTED');
  const data={store_dir:dir,candidate_sha256:a.candidate.candidate_sha256,
    candidate_json:JSON.stringify(a.candidate),current_provenance_json:a.source.provenance_json,
    witness_json:JSON.stringify(a.bundle)};
  const no=await inspectQualificationPreflight(data);
  assert.equal(no.status,'BLOCKED');assert.equal(no.reason,'PRODUCT_TRUST_ROOTS_NOT_APPROVED');
  noAuthority(no);
  const stale=await inspectQualificationPreflight({...data,current_provenance_json:
    JSON.stringify({...a.provenance,tool_version:'5.4.1'})});
  assert.equal(stale.status,'STALE');noAuthority(stale);
  const tombstone=await revokeStoredCandidate({store_dir:dir,candidate_sha256:a.candidate.candidate_sha256,reason:'OPERATOR_REVOKED'});
  assert.equal(tombstone.status,'INVALIDATED');
  const after=await inspectQualificationPreflight(data);
  assert.equal(after.status,'BLOCKED');assert.equal(after.reason,'G4_STORE_INVALIDATED');noAuthority(after);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('G4 malformed or caller-chosen trust records never enter production API',async()=>{
 const out=await inspectQualificationPreflight({store_dir:'/tmp/not-owned',
   witness_json:'{bad',candidate_sha256:'f'.repeat(64)});
 assert.equal(out.status,'BLOCKED');noAuthority(out);
 assert.equal('roots' in out,false);
});
