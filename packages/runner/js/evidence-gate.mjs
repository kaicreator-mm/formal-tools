/**
 * G3 evidence linkage prework, not a native executor or semantic verifier.
 *
 * Tool runs, signed receipts, model/source semantics and external factual
 * provenance must be independently established by a later trusted host.
 * In particular: SAT/UNSAT, successful process exit, a matching SHA string
 * or an LLM "reviewed" claim can NEVER grant business-level PASS here.
 */
import { toolIds, describeNativeTool } from "./native-catalog.mjs";

const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);
// The direct API must not interpret inherited tool approvals or accessor-backed
// records as trustworthy JSON. An external caller may supply non-JSON objects.
const dataRecord = x => isObject(x) &&
  (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null) &&
  Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,"value"));
const own = (x, fields) => dataRecord(x) && Object.keys(x).every(k => fields.includes(k));
const id = x => typeof x === "string" && /^[a-z][a-z0-9_.-]{0,79}$/.test(x);
const sha = x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const uniq = xs => Array.isArray(xs) && xs.length === new Set(xs).size;
const kinds = new Set(["symbolic","bounded_model","program","statistical","external_fact","not_formalizable"]);
const statuses = new Set(["SAT","UNSAT","PROVED","COUNTEREXAMPLE","TEST_PASS","TEST_FAIL","OPTIMAL","FEASIBLE","UNKNOWN","ERROR","TIMEOUT","NOT_RUN"]);
const indeterminate = new Set(["UNKNOWN","ERROR","TIMEOUT","NOT_RUN"]);
const privacy = ["PUBLIC","USER_PRIVATE","RESTRICTED"];
const confidence = cls => privacy.indexOf(cls);

const denied = (issues, status="BLOCKED") => ({
  status, issues: [...new Set(issues)], tool_execution:"UNVERIFIED",
  linked_receipts:0, claim_result:"INCONCLUSIVE", semantic_fidelity:"NOT_EVALUATED",
  independent_oracle_review:"NOT_RUN", solution_promotable:false
});

/**
 * Accepts only source/model/method/step-anchored tool metadata.
 * Caller-supplied receipt fields are UNTRUSTED; even valid linkage means only
 * LINKED_UNVERIFIED, never SUPPORTED_WITH_SCOPE.
 *
 * @param {any} bundle
 * @returns {{status:string,issues:string[],tool_execution:string,linked_receipts:number,
 *   claim_result:string,semantic_fidelity:string,independent_oracle_review:string,solution_promotable:boolean}}
 */
export function inspectEvidenceBundle(bundle) {
  try { return inspectEvidenceBundleData(bundle); }
  catch { return denied(["malformed evidence bundle or unsafe object access"]); }
}
function inspectEvidenceBundleData(bundle) {
  if(!dataRecord(bundle))return denied(["evidence bundle must be a plain data object"]);
  const issues=[];
  const fail=msg=>issues.push(msg);
  if(!own(bundle,["schema","claim","receipts","method_sha256","source_sha256","model_sha256","policy"]))
    fail("forged/unknown evidence-bundle fields");
  if(bundle.schema!=="formal-tools/evidence-bundle/0.1")fail("invalid evidence schema");
  const claim=bundle.claim;
  if(!own(claim,["id","kind","source_sha256","model_sha256","method_sha256","required_step_ids"])||
     !id(claim?.id)||!kinds.has(claim?.kind)||!sha(claim?.source_sha256)||
     !sha(claim?.model_sha256)||!sha(claim?.method_sha256)||
     !Array.isArray(claim?.required_step_ids)||claim.required_step_ids.length>16||
     !uniq(claim.required_step_ids)||!claim.required_step_ids.length||
     claim?.required_step_ids?.some(step=>!id(step)))
    fail("invalid or empty atomic claim anchor");
  if(!sha(bundle.source_sha256)||!sha(bundle.model_sha256)||!sha(bundle.method_sha256)||
     bundle.source_sha256!==claim?.source_sha256||
     bundle.model_sha256!==claim?.model_sha256||
     bundle.method_sha256!==claim?.method_sha256)
    fail("source/model/method digest mismatch");
  const policy=bundle.policy;
  if(!own(policy,["allowed_tool_ids","allowed_operations","classification","destination","network_allowed"])||
     !Array.isArray(policy?.allowed_tool_ids)||policy.allowed_tool_ids.length>toolIds.length||
     !uniq(policy.allowed_tool_ids)||policy.allowed_tool_ids.some(x=>!id(x))||
     !dataRecord(policy?.allowed_operations)||
     Object.keys(policy.allowed_operations).length>toolIds.length||
     !Object.entries(policy.allowed_operations).every(([tool,ops])=>
       policy.allowed_tool_ids.includes(tool)&&Array.isArray(ops)&&ops.length<=64&&
       uniq(ops)&&ops.every(id))||
     !policy.allowed_tool_ids.every(tool=>Object.hasOwn(policy.allowed_operations,tool))||
     !privacy.includes(policy?.classification)||policy?.destination!=="LOCAL"||
     policy?.network_allowed!==false)
    fail("invalid or unsafe execution policy");
  // Fail closed before dereferencing any nested untrusted policy or claim shape.
  if(issues.length)return denied(issues);
  const receipts=Array.isArray(bundle.receipts)?bundle.receipts:[];
  if(!Array.isArray(bundle.receipts)||receipts.length>16)
    return denied([...issues,"invalid or excessive tool receipts"]);
  const ids=new Set(),nativeIds=new Set(toolIds);
  for(const receipt of receipts) {
    if(!own(receipt,["step_id","claim_id","tool_id","operation","tool_binary_sha256",
      "invocation_sha256","output_sha256","source_sha256","model_sha256",
      "method_sha256","tool_status","exit_code","input_classification","output_classification"])) {
      fail("malformed/forged tool receipt");continue;
    }
    if(!id(receipt.step_id)||!id(receipt.claim_id)||!id(receipt.tool_id)||!id(receipt.operation)||
      !sha(receipt.tool_binary_sha256)||!sha(receipt.invocation_sha256)||!sha(receipt.output_sha256)||
      !sha(receipt.source_sha256)||!sha(receipt.model_sha256)||!sha(receipt.method_sha256)) {
      fail("invalid receipt identity or digest");continue;
    }
    if(ids.has(receipt.step_id))fail("duplicate/ambiguous tool step: "+receipt.step_id);
    ids.add(receipt.step_id);
    if(receipt.claim_id!==claim?.id)fail("receipt claims unrelated atomic claim");
    if(!claim?.required_step_ids?.includes(receipt.step_id))
      fail("unexpected tool step not bound to claim: "+receipt.step_id);
    if(receipt.source_sha256!==bundle.source_sha256||
       receipt.model_sha256!==bundle.model_sha256||
       receipt.method_sha256!==bundle.method_sha256)fail("receipt source/model/method digest mismatch");
    if(!nativeIds.has(receipt.tool_id)||
       !policy?.allowed_tool_ids?.includes(receipt.tool_id))fail("unregistered or unpermitted native tool: "+receipt.tool_id);
    else if(!Object.hasOwn(policy.allowed_operations,receipt.tool_id)||
            !policy.allowed_operations[receipt.tool_id]?.includes(receipt.operation))
      fail("tool operation not permitted by execution policy: "+receipt.tool_id+"/"+receipt.operation);
    else{
      let operations;
      try {operations=describeNativeTool(receipt.tool_id).operations;}
      catch {fail("registered native tool unavailable in catalog: "+receipt.tool_id);}
      if(!operations||!Object.hasOwn(operations,receipt.operation)||receipt.operation==="raw")
        fail("unsupported typed tool operation: "+receipt.tool_id+"/"+receipt.operation);
    }
    if(!statuses.has(receipt.tool_status))fail("invalid tool-specific result");
    if(!Number.isSafeInteger(receipt.exit_code)||receipt.exit_code<0||receipt.exit_code>255)
      fail("invalid tool exit code");
    if(!privacy.includes(receipt.input_classification)||
       !privacy.includes(receipt.output_classification)||
       !privacy.includes(policy?.classification)||
       confidence(receipt.input_classification)>confidence(policy.classification)||
       confidence(receipt.output_classification)<confidence(receipt.input_classification))
      fail("unsafe input/output privacy classification");
    if(receipt.exit_code!==0&&!indeterminate.has(receipt.tool_status))
      fail("non-zero exit cannot assert decisive solver status");
  }
  if(claim?.required_step_ids?.some(step=>!ids.has(step)))
    fail("missing required claim-to-receipt linkage");
  if(issues.length)return denied(issues);
  if(claim.kind==="external_fact"||claim.kind==="not_formalizable")
    return {...denied(["formal tool receipts cannot establish external or non-formalizable factual truth"],"NEEDS_SOURCE"),
      claim_result:"NEEDS_SOURCE",linked_receipts:receipts.length};
  if(!receipts.length)
    return {...denied(["no tool receipts"],"INCONCLUSIVE")};
  if(receipts.some(r=>indeterminate.has(r.tool_status)))
    return {...denied(["at least one tool outcome is UNKNOWN/ERROR/TIMEOUT/NOT_RUN"],"INCONCLUSIVE"),
      linked_receipts:receipts.length};
  return {
    status:"LINKED_UNVERIFIED",issues:[],
    tool_execution:"RECEIPT_CLAIMED_NOT_ATTESTED",linked_receipts:receipts.length,
    claim_result:"UNVERIFIED",semantic_fidelity:"NOT_EVALUATED",
    independent_oracle_review:"NOT_RUN",solution_promotable:false
  };
}
