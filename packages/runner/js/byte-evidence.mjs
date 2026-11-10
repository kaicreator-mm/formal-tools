/**
 * G3 R1: bind G2 Method and G3 receipt claims to supplied exact bytes.
 *
 * This is NOT a native runner, a trusted-host identity check, a semantic
 * oracle or a permission to promote Solutions. The bytes themselves are
 * caller-supplied until a trusted host supplies and attests them.
 */
import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { assessMethod } from "./method-planner.mjs";
import { inspectEvidenceBundle } from "./evidence-gate.mjs";

const MAX_SOURCE_BYTES = 1_048_576;
const MAX_MODEL_BYTES = 1_048_576;
const MAX_INVOCATION_BYTES = 1_048_576;
const MAX_OUTPUT_BYTES = 4_194_304;
const MAX_BINARY_BYTES = 83_886_080;
const validId = x => typeof x === "string" && /^[a-z][a-z0-9_.-]{0,79}$/.test(x);
const dataRecord = x => x!==null && typeof x==="object" && !Array.isArray(x) &&
  !utilTypes.isProxy(x) &&
  (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null) &&
  Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,"value"));
const hasOnly = (x, names) => dataRecord(x) && Object.keys(x).every(k=>names.includes(k));
// G2 checks JSON-like contracts, but direct JS callers may pass arrays whose
// instance-owned includes/every/some methods misrepresent permissions and DAG
// closure. Validate the entire ProblemSpec, Method and bundle as inert JSON
// before trusting their behavior or handing them to G2/G3.
function inertJsonData(root) {
  const seen=new WeakSet();
  let budget=20_000;
  const visit=(value,depth)=>{
    if(--budget<0||depth>32)return false;
    if(value===null||typeof value==="string"||typeof value==="boolean")return true;
    if(typeof value==="number")return Number.isFinite(value);
    if(typeof value!=="object"||utilTypes.isProxy(value)||seen.has(value))return false;
    seen.add(value);
    if(Array.isArray(value)){
      if(Object.getPrototypeOf(value)!==Array.prototype||
         value.length>4096||Reflect.ownKeys(value).length!==value.length+1)return false;
      for(let i=0;i<value.length;i++){
        const d=Object.getOwnPropertyDescriptor(value,String(i));
        if(!d||!Object.hasOwn(d,"value")||!visit(d.value,depth+1))return false;
      }
      return true;
    }
    if(!dataRecord(value))return false;
    const keys=Reflect.ownKeys(value);
    if(keys.length>4096||keys.some(k=>typeof k!=="string"))return false;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    return keys.every(k=>visit(descriptors[String(k)].value,depth+1));
  };
  try{return visit(root,0);}catch{return false;}
}

// Read the intrinsic typed-array byte length: subclasses may spoof a
// byteLength getter to bypass naive size checks. Reject custom buffer types.
const typedByteLength=Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),"byteLength").get;
const bytesOk = (x,max) => {
  if(!(x instanceof Uint8Array)||utilTypes.isProxy(x))return false;
  if(Object.getPrototypeOf(x)!==Uint8Array.prototype &&
     Object.getPrototypeOf(x)!==Buffer.prototype)return false;
  const actual=typedByteLength.call(x);
  return Number.isSafeInteger(actual)&&actual<=max;
};
const hex = value => createHash("sha256").update(value).digest("hex");
const sameSet = (a,b) => a.length===b.length && new Set(a).size===a.length &&
  a.every(x=>b.includes(x));
const privacy=["PUBLIC","USER_PRIVATE","RESTRICTED"];
const refused = (reason,status="BLOCKED") => ({
  status,issues:[reason],source_bytes_bound:false,model_bytes_bound:false,
  method_structure:"UNVERIFIED",native_host_attested:false,
  claim_result:status==="NEEDS_SOURCE"?"NEEDS_SOURCE":"INCONCLUSIVE",
  independent_oracle_review:"NOT_RUN",solution_promotable:false
});

/**
 * @param {any} input - Synthetic/host-supplied data. No network/filesystem
 *    access; caller must separately attest where all these bytes came from.
 * @returns {{status:string,issues:string[],source_bytes_bound:boolean,
 * model_bytes_bound:boolean,method_structure:string,native_host_attested:boolean,
 * claim_result:string,independent_oracle_review:string,solution_promotable:boolean}}
 */
export function inspectByteBoundClaim(input) {
  try {return inspectByteBoundClaimData(input);}
  catch {return refused("malformed or hostile byte-binding input");}
}
function inspectByteBoundClaimData(input){
  if(!hasOnly(input,["problem","method","claim_id","source_id","bundle","artifacts"]))
    return refused("unexpected byte-binding request fields");
  const {problem,method,claim_id:claimId,source_id:sourceId,bundle,artifacts}=input;
  if(!validId(claimId)||!validId(sourceId))
    return refused("invalid atomic claim or source ID");
  if(!inertJsonData(problem)||!inertJsonData(method)||!inertJsonData(bundle))
    return refused("ProblemSpec, Method and evidence bundle must be bounded inert JSON data");
  const claim=Array.isArray(problem?.claims)?problem.claims.find(x=>x?.id===claimId):null;
  if(claim?.kind==="external_fact"||claim?.kind==="not_formalizable")
    return refused("external or non-formalizable claims require independent external evidence","NEEDS_SOURCE");
  const check=assessMethod(problem,method);
  if(check.status!=="STRUCTURALLY_VALID"||check.candidate_tools_present)
    return refused("Method is not an accepted native-only G2 structural proposal");
  if(!claim||!method.goal_claim_ids.includes(claimId))
    return refused("claim not in the approved G2 goal list");
  // The existing G3 gate already rejects hostile arrays, Proxies, inherited
  // allowlist permissions, inconsistent claim/step metadata and forged states.
  // Require its fail-closed structural boundary before dereferencing receipts.
  const linkage=inspectEvidenceBundle(bundle);
  if(linkage.status==="BLOCKED")
    return refused("G3 structural evidence linkage blocked");
  // Current R1 deliberately supports exactly one source input; multi-source
  // semantics or mixed privacy labels must never be silently collapsed.
  const claimSources=new Set([...claim.source_refs,
    ...claim.requirement_ids.map(r=>problem.requirements.find(x=>x.id===r)?.source_ref)]);
  if(claimSources.size!==1||!claimSources.has(sourceId))
    return refused("multi-source or unrelated claim is not supported by this byte-binding profile");
  const source=problem.source_refs.find(x=>x.id===sourceId);
  if(!source||!hasOnly(artifacts,["source","model","steps"])||
     !bytesOk(artifacts.source,MAX_SOURCE_BYTES)||
     !bytesOk(artifacts.model,MAX_MODEL_BYTES)||
     !dataRecord(artifacts.steps))
    return refused("missing or oversized source/model bytes");
  if(hex(artifacts.source)!==source.sha256||
     hex(artifacts.source)!==bundle?.source_sha256)
    return refused("supplied source bytes differ from claimed source digest");
  if(hex(artifacts.model)!==bundle?.model_sha256)
    return refused("supplied model bytes differ from claimed model digest");
  if(check.method_sha256!==bundle?.method_sha256)
    return refused("G2 Method structure differs from evidence method digest");
  if(bundle?.claim?.id!==claimId)
    return refused("evidence bundle identifies a different claim");

  if(privacy.indexOf(bundle.policy.classification)>
     privacy.indexOf(problem.policy.max_input_classification))
    return refused("evidence permission scope exceeds original G2 policy");
  const stepIndex=new Map(method.steps.map(x=>[x.id,x]));
  const targets=method.steps.filter(x=>x.claim_ids.includes(claimId)).map(x=>x.id);
  if(!targets.length)return refused("no Method step bound to this Claim");
  const necessary=new Set(),visiting=new Set();
  const include=id=>{
    if(necessary.has(id))return true;
    if(visiting.has(id))return false;
    const step=stepIndex.get(id);
    if(!step)return false;
    visiting.add(id);
    for(const dep of step.depends_on)if(!include(dep))return false;
    visiting.delete(id);necessary.add(id);
    return true;
  };
  if(!targets.every(include))
    return refused("Method ancestors are missing or cyclic");
  const required=[...necessary];
  if(!Array.isArray(bundle?.claim?.required_step_ids)||
     !sameSet(required,bundle.claim.required_step_ids))
    return refused("required receipt steps differ from actual G2 Claim DAG ancestry");
  if(!Array.isArray(bundle.receipts)||!sameSet(required,bundle.receipts.map(r=>r?.step_id)))
    return refused("tool receipts differ from actual G2 dependency closure");
  if(Object.keys(artifacts.steps).length!==required.length||
     required.some(x=>!Object.hasOwn(artifacts.steps,x)))
    return refused("input/output byte payloads do not match required steps");
  for(const r of bundle.receipts){
    const step=stepIndex.get(r.step_id);
    if(!step||r.tool_id!==step.tool_id||r.operation!==step.operation)
      return refused("receipt tool identity/typed operation differs from G2 Method step");
    if(!problem.policy.allowed_tools.includes(r.tool_id)||
       !problem.policy.allowed_operations[r.tool_id]?.includes(r.operation)||
       !bundle.policy?.allowed_tool_ids?.includes(r.tool_id)||
       !bundle.policy?.allowed_operations?.[r.tool_id]?.includes(r.operation))
      return refused("receipt policy exceeds original G2 tool/operation authorization");
    const data=artifacts.steps[r.step_id];
    if(!hasOnly(data,["binary","invocation","output"])||
       !bytesOk(data.binary,MAX_BINARY_BYTES)||
       !bytesOk(data.invocation,MAX_INVOCATION_BYTES)||
       !bytesOk(data.output,MAX_OUTPUT_BYTES))
      return refused("missing or oversized tool binary/invocation/output bytes");
    if(hex(data.binary)!==r.tool_binary_sha256||
       hex(data.invocation)!==r.invocation_sha256||
       hex(data.output)!==r.output_sha256)
      return refused("reported tool/invocation/output hash disagrees with provided bytes");
    if(privacy.indexOf(r.input_classification)>privacy.indexOf(problem.policy.max_input_classification))
      return refused("tool receipt input sensitivity exceeds original G2 policy");
    if(privacy.indexOf(r.output_classification)<privacy.indexOf(step.output_classification))
      return refused("receipt output silently downgrades G2 step sensitivity");
    if(!step.source_refs.every(id=>id===sourceId))
      return refused("tool step has unbound source identities in single-source profile");
  }
  if(linkage.status==="INCONCLUSIVE")
    return refused("tool results remain UNKNOWN/ERROR/TIMEOUT/NOT_RUN","INCONCLUSIVE");
  if(linkage.status!=="LINKED_UNVERIFIED")
    return refused("G3 static evidence linkage did not pass");
  return {
    status:"BYTES_BOUND_UNATTESTED",issues:[],
    source_bytes_bound:true,model_bytes_bound:true,
    method_structure:"STRUCTURALLY_VALID",
    native_host_attested:false,claim_result:"UNVERIFIED",
    independent_oracle_review:"NOT_RUN",solution_promotable:false
  };
}
