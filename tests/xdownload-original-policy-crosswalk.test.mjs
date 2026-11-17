import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../benchmarks/llm-methods/g4/product-policy-crosswalk/',import.meta.url);
const project=new URL('../',import.meta.url);
const pin=bytes=>createHash('sha1').update('blob '+bytes.byteLength+'\0').update(bytes).digest('hex');
const data=async()=>JSON.parse(await readFile(new URL('CROSSWALK.json',root),'utf8'));
test('original xDownload product files and existing demo/policy sources are Git-Blob pinned',async()=>{
 const m=await data();
 assert.equal(m.status,'UNADOPTED_SOURCE_OWNER_HANDOFF');
 assert.equal(m.product.exact_commit,'e904f08c478b15147b1c07fbe53c610d2d81851f');
 assert.equal(m.product.sources.length,4);
 for(const f of m.product.sources){
  const raw=await readFile(new URL('original/'+f.path,root));
  assert.equal(pin(raw),f.git_blob,f.path);
 }
 const demo=await readFile(new URL(m.demonstration.local_snapshot,project));
 assert.equal(pin(demo),m.demonstration.git_blob);
 const policy=await readFile(new URL(m.policy_document.local_snapshot,project));
 assert.equal(pin(policy),m.policy_document.git_blob);
 assert.equal(m.policy_document.status,'CANDIDATE_ONLY_NO_L2_FREEZE');
});
test('crosswalk rejects demo READY as original authorized xDownload acquisition intent',async()=>{
 const m=await data();
 const fetch=async name=>(await readFile(new URL('original/'+m.product.sources.find(x=>x.role===name).path,root),'utf8'));
 const [business,intent,composition,network]=await Promise.all(['business','intent','composition','https'].map(fetch));
 assert.ok(business.includes('DECLARED_BYTES_PROFILE_BOUND = 1048576'));
 assert.ok(business.includes("eventType: 'DOWNLOAD_CONFIRMED'"));
 assert.ok(business.includes("effectType: 'effect:acquire'"));
 assert.ok(intent.includes('targetRef must be an opaque bounded token'));
 assert.ok(intent.includes("slice !== 'S1' && slice !== 'S3'"));
 assert.ok(intent.includes('lineageId'));
 assert.ok(intent.includes('outputRootScope'));
 assert.ok(intent.includes('allowedOperation'));
 assert.ok(intent.includes('sessionRef'));
 assert.ok(composition.includes("operationId: 'acquisition.acquire'"));
 assert.ok(network.includes('socket.encrypted === true && socket.authorized === true && socket.remoteAddress === pinnedIp'));
 assert.equal(m.mapping.find(x=>x.id==='canonical_intent')?.relation,'NOT_EQUIVALENT');
 assert.equal(m.mapping.find(x=>x.id==='host_effect')?.relation,'SEPARATE_GOVERNED_EFFECT');
 assert.equal(m.mapping.find(x=>x.id==='size_policy')?.relation,'DISTINCT_LIMITS');
 assert.equal(m.mapping.find(x=>x.id==='network')?.relation,'NOT_EQUIVALENT');
 assert.equal(m.mapping.find(x=>x.id==='oracle')?.relation,'NO_SOURCE_MODEL_REFINEMENT_PROVEN');
});
test('original Product/Oracle/Host source handoff remains unapproved and cannot grant Replay',async()=>{
 const m=await data(),a=m.adoption;
 assert.equal(a.source_owner,'NOT_APPROVED');
 assert.equal(a.product_claim_version,'NOT_FROZEN');
 assert.equal(a.professional_oracle,'NOT_ATTESTED');
 assert.equal(a.host_signing,'NOT_ATTESTED');
 assert.equal(a.g4_trust_roots,'NOT_CONFIGURED');
 assert.equal(a.qualified_solution,'NOT_ADMITTED');
 assert.equal(a.positive_replay,false);
 assert.equal(a.effect,false);
 const installed=JSON.parse(await readFile(new URL('registry/G4_QUALIFICATION_ANCHORS.json',project),'utf8'));
 assert.equal(installed.status,'NOT_CONFIGURED');
 assert.deepEqual(installed.anchors,[]);
});