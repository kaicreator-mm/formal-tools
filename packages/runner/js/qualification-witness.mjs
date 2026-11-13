/**
 * Issue #11 G4 R13: crypto evidence preflight, NOT a replay authorization.
 *
 * Verify an owner/oracle/host Ed25519 signature triad against an installed,
 * Git-versioned, Product-approved trust registry. The shipped registry has
 * NO approved anchors. An arbitrary caller cannot supply a trust key to the
 * production preflight. No result from this module grants an executable
 * Solution, Product Claim, DIS Host authority or Effect.
 */
import {readFileSync} from 'node:fs';
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {inspectStoredReplay} from './solution-store.mjs';
import {inspectCandidateReplay} from './solution-candidate.mjs';

const REGISTRY=new URL('../../../registry/G4_QUALIFICATION_ANCHORS.json',import.meta.url);
const ROLES=Object.freeze(['SOURCE_OWNER','INDEPENDENT_ORACLE','TRUSTED_HOST']);
const HEX64=/^[a-f0-9]{64}$/;
const REQ=['schema','candidate_sha256','problem_sha256','method_sha256',
  'source_id','source_sha256','oracle_id','oracle_sha256','model_sha256',
  'tool_id','tool_version','tool_binary_sha256','evidence_sha256',
  'claim_ref','scope','valid_from_ms','valid_until_ms'];
const B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const keysExact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const digest=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):
  plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const sealedBytes=(subject,role)=>Buffer.from(JSON.stringify(canonical({subject,role})),'utf8');
const deny=(reason,status='BLOCKED')=>Object.freeze({
  schema:'formal-tools/g4-qualification-preflight/0.1',status,reason,
  independent_professional_oracle:false,qualified_solution:false,
  claim_result:'UNVERIFIED',replay_allowed:false,solution_promotable:false,
  dis_host_executed:false,effect_dispatched:false
});
function exactSubject(subject,candidate,current){
 if(!keysExact(subject,REQ)||subject.schema!=='formal-tools/qualification-subject/0.1')
   return false;
 for(const k of ['candidate_sha256','problem_sha256','method_sha256','source_sha256',
   'oracle_sha256','model_sha256','tool_binary_sha256','evidence_sha256'])
   if(typeof subject[k]!=='string'||!HEX64.test(subject[k]))return false;
 for(const k of ['source_id','oracle_id','tool_id','tool_version','claim_ref','scope'])
   if(typeof subject[k]!=='string'||subject[k].length<1||subject[k].length>160)
     return false;
 if(!Number.isSafeInteger(subject.valid_from_ms)||
    !Number.isSafeInteger(subject.valid_until_ms)||
    subject.valid_until_ms<=subject.valid_from_ms)return false;
 const expected={
   candidate_sha256:candidate.candidate_sha256,
   problem_sha256:candidate.problem_sha256,method_sha256:candidate.method_sha256,
   source_id:current.source_id,source_sha256:current.source_sha256,
   oracle_id:current.oracle_id,oracle_sha256:current.oracle_sha256,
   model_sha256:current.model_sha256,tool_id:current.tool_id,
   tool_version:current.tool_version,tool_binary_sha256:current.tool_binary_sha256,
   evidence_sha256:current.evidence_sha256
 };
 return Object.entries(expected).every(([key,value])=>value===subject[key]);
}

/**
 * Crypto-only verification for an immutable witness bundle. A supplied
 * root set is **NOT a trusted policy input**: this function can only return
 * CRYPTOGRAPHICALLY_BOUND_UNQUALIFIED. Used by adversarial tests and by the
 * production wrapper *after* reading its own registered anchors.
 * @param {{candidate?:any,current_provenance?:any,bundle?:any,roots?:any,now_ms?:number}} [args]
 * @returns {any}
 */
export function inspectWitnessCrypto({candidate,current_provenance,bundle,roots,now_ms}={}){
 try{
   if(!keysExact(bundle,['schema','subject','signatures'])||
      bundle.schema!=='formal-tools/qualification-witnesses/0.1'||
      !plain(candidate)||!plain(current_provenance)||
      !Number.isSafeInteger(now_ms))return deny('INVALID_WITNESS_INPUT');
   const subject=bundle.subject;
   if(!exactSubject(subject,candidate,current_provenance))
     return deny('WITNESS_SUBJECT_DRIFT');
   if(now_ms<subject.valid_from_ms||now_ms>=subject.valid_until_ms)
     return deny('WITNESS_NOT_CURRENT','STALE');
   if(!keysExact(roots,['schema','status','anchors'])||
      roots.schema!=='formal-tools/g4-trust-roots/0.1'||
      roots.status!=='PRODUCT_APPROVED'||
      !Array.isArray(roots.anchors)||roots.anchors.length!==3||
      !Array.isArray(bundle.signatures)||bundle.signatures.length!==3)
     return deny('PRODUCT_TRUST_ROOTS_NOT_APPROVED');
   const signerSet=new Set(), keySet=new Set();
   for(const role of ROLES){
     const entries=bundle.signatures.filter(x=>x?.role===role);
     if(entries.length!==1||!keysExact(entries[0],['role','key_id','signature_b64']))
       return deny('WITNESS_ROLE_NOT_UNIQUE');
     const signature=entries[0];
     if(typeof signature.key_id!=='string'||signature.key_id.length>128||
        typeof signature.signature_b64!=='string'||!B64.test(signature.signature_b64))
       return deny('WITNESS_SIGNATURE_FORMAT');
     const anchors=roots.anchors.filter(x=>x?.role===role&&x.key_id===signature.key_id);
     if(anchors.length!==1||!keysExact(anchors[0],['role','key_id','public_key_spki_der_b64','allowed_scope']))
       return deny('UNTRUSTED_SIGNER');
     const anchor=anchors[0];
     if(anchor.allowed_scope!==subject.scope||signerSet.has(signature.key_id)||
        keySet.has(anchor.public_key_spki_der_b64))
       return deny('WITNESS_IDENTITY_OR_SCOPE_REUSED');
     signerSet.add(signature.key_id);keySet.add(anchor.public_key_spki_der_b64);
     if(typeof anchor.public_key_spki_der_b64!=='string'||
        !B64.test(anchor.public_key_spki_der_b64))return deny('INVALID_SIGNER_KEY');
     const key=createPublicKey({key:Buffer.from(anchor.public_key_spki_der_b64,'base64'),
       format:'der',type:'spki'});
     if(key.asymmetricKeyType!=='ed25519'||
       !verifySignature(null,sealedBytes(subject,role),key,
         Buffer.from(signature.signature_b64,'base64')))
       return deny('WITNESS_BAD_SIGNATURE');
   }
   if(signerSet.size!==3||keySet.size!==3)return deny('DUPLICATE_SIGNERS');
   // Signature validity alone cannot certify a professional Oracle or Host.
   return Object.freeze({...deny('PRODUCT_AND_HOST_ADMISSION_STILL_REQUIRED'),
     status:'CRYPTOGRAPHICALLY_BOUND_UNQUALIFIED',
     exact_candidate_sha256:subject.candidate_sha256,
     signed_subject_sha256:digest(sealedBytes(subject,'SIGNED_SUBJECT')),
     roles_verified:[...ROLES]});
 }catch{return deny('UNPARSABLE_OR_INVALID_WITNESS');}
}
const parse=t=>{
 if(typeof t!=='string'||Buffer.byteLength(t,'utf8')>131072)throw Error('bounded json');
 const obj=JSON.parse(t);if(!plain(obj))throw Error('json record');return obj;
};
/**
 * Read the ORIGINAL durable G4 tombstone/version gate BEFORE crypto, then
 * compare caller candidate bytes to the stored source-sealed digest. Trust
 * anchors come only from the versioned Product-approved registry (empty until
 * real Owner, Oracle, Host credentials are issued). This NEVER grants replay.
 * @param {{store_dir?:string,candidate_sha256?:string,candidate_json?:string,
 *  current_provenance_json?:string,witness_json?:string}} [args]
 */
export async function inspectQualificationPreflight({store_dir,candidate_sha256,
  candidate_json,current_provenance_json,witness_json}={}){
 try{
   const original=await inspectStoredReplay({store_dir,candidate_sha256,
     current_provenance_json});
   if(original.status!=='REPLAY_BLOCKED_UNQUALIFIED')
     return deny('G4_STORE_'+original.status,original.status==='STALE'?'STALE':'BLOCKED');
   const c=parse(candidate_json),now=parse(current_provenance_json),witness=parse(witness_json);
   const candidateCheck=inspectCandidateReplay(candidate_json,current_provenance_json);
   if(candidateCheck.status!=='REPLAY_BLOCKED_UNQUALIFIED'||
      original.fingerprint!==candidate_sha256||
      candidateCheck.fingerprint!==candidate_sha256||
      c.candidate_sha256!==candidate_sha256)
     return deny('SIGNED_CANDIDATE_VS_DURABLE_STORE_MISMATCH');
   // No externally supplied trust-root path or public key input.
   const roots=parse(readFileSync(REGISTRY,'utf8'));
   return inspectWitnessCrypto({candidate:c,current_provenance:now,
     bundle:witness,roots,now_ms:Date.now()});
 }catch{return deny('MALFORMED_OR_UNAVAILABLE_QUALIFICATION_EVIDENCE');}
}
