/**
 * Read-only capability index (G1).
 *
 * Native execution authority remains native-catalog.mjs. This index adds only
 * problem capability labels and candidate metadata; it cannot launch tools.
 * G2 LLM semantic classification and G3 native verification are deliberately
 * NOT implemented here.
 */
import { readFileSync } from "node:fs";
import { toolIds } from "./native-catalog.mjs";

export const REGISTRY_PATH = new URL("../../../registry/PROBLEM_CAPABILITIES.json", import.meta.url);
const availability = new Set(["NOT_ASSESSED","DOWNLOADED","INSTALLED","NATIVE_VERIFIED","UNAVAILABLE"]);
const outcomes = new Set(["SAT","UNSAT","UNKNOWN","ERROR","TIMEOUT","NOT_RUN"]);

export function validateCapabilityRegistry(input, nativeSourceIds=toolIds) {
  const issues = [];
  const fail = (message) => issues.push(message);
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok:false, issues:["registry must be an object"] };
  if (input.schema !== "formal-tools/problem-capabilities/0.1") fail("wrong schema");
  if (input.authority?.native_catalog !== "packages/runner/js/native-catalog.mjs") fail("wrong native source authority");
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  const tools = Array.isArray(input.tools) ? input.tools : [];
  if (!Array.isArray(input.capabilities) || !Array.isArray(input.tools)) fail("capabilities/tools arrays required");
  if (capabilities.length!==23) fail("expected 23 capability categories in R0");
  if (tools.length!==36) fail("expected 36 catalog entries in R0");
  const ids = new Set();
  for(const c of capabilities) {
    if(!c || typeof c.id!=="string" || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(c.id) ||
        typeof c.label!=="string" || !c.label.trim() || typeof c.limitations!=="string" || !c.limitations.trim())
      {fail("invalid capability");continue;}
    if(ids.has(c.id))fail("duplicate capability: "+c.id);
    ids.add(c.id);
  }
  const toolMap = new Set(); const nativeRefs=[];
  for(const t of tools) {
    if(!t || typeof t.id!=="string" || !/^[a-z][a-z0-9-]*$/.test(t.id)) {fail("invalid tool ID");continue;}
    if(toolMap.has(t.id))fail("duplicate tool ID: "+t.id);
    toolMap.add(t.id);
    if(!["native-ref","candidate"].includes(t.origin))fail("invalid tool origin: "+t.id);
    if(t.origin==="native-ref") {
      nativeRefs.push(t.id);
      if(t.priority!=="existing")fail("native tool must have existing priority: "+t.id);
    } else if(!["A","B","C"].includes(t.priority))fail("invalid candidate priority: "+t.id);
    if(!Array.isArray(t.capability_ids)||!t.capability_ids.length)fail("empty capability mapping: "+t.id);
    else {
      const cs = new Set();
      for(const capability of t.capability_ids) {
        if(cs.has(capability))fail("repeated tool capability: "+t.id);
        if(!ids.has(capability))fail("unknown capability "+capability+" for "+t.id);
        cs.add(capability);
      }
    }
    if(!availability.has(t.availability))fail("unknown availability: "+t.id);
    if(t.runtime_verified!==false || t.version!==null || t.evidence_ref!==null ||
       t.availability!=="NOT_ASSESSED")fail("initial G1 has no runtime claim: "+t.id);
    if(typeof t.official_url!=="string"||!t.official_url.startsWith("https://"))fail("missing official HTTPS source: "+t.id);
    if(!["FORMAL_TOOLS_GENERIC","DOMAIN_SIMULATOR"].includes(t.consumer_scope))fail("unknown consumer scope: "+t.id);
    if(t.license_status!=="REVIEW_REQUIRED")fail("R0 requires licensing review: "+t.id);
  }
  const expected=[...nativeSourceIds].sort();
  const observed=nativeRefs.sort();
  if(new Set(expected).size!==expected.length || JSON.stringify(expected)!==JSON.stringify(observed))
    fail("native tool references differ from native-catalog.mjs; never duplicate executable tool IDs");
  if(capabilities.some(c=>!tools.some(t=>t.capability_ids?.includes(c.id))))
    fail("at least one capability has no tool");
  if(input.semantics?.tool_result_states?.some(x=>!outcomes.has(x)) ||
     !input.semantics?.tool_result_states?.includes("NOT_RUN"))fail("tool result contract missing NOT_RUN");
  if(!input.semantics?.claim_result_states?.includes("NEEDS_SOURCE"))fail("external claims must support NEEDS_SOURCE");
  return {ok:issues.length===0,issues,counts:{capabilities:capabilities.length,tools:tools.length,native_refs:nativeRefs.length,candidates:tools.length-nativeRefs.length}};
}

export function readCapabilityRegistry() {
  const parsed=JSON.parse(readFileSync(REGISTRY_PATH,"utf8"));
  const report=validateCapabilityRegistry(parsed);
  if(!report.ok)throw new Error("Capability registry invalid: "+report.issues.join("; "));
  return parsed;
}

/**
 * Capability identifiers only: the caller/LLM is responsible for mapping
 * natural-language statements to these exact names. No semantic guarantee.
 */
export function discoverTools(capabilityIds,{includeCandidates=true}={}) {
  if(!Array.isArray(capabilityIds) || !capabilityIds.length ||
      capabilityIds.some(x=>typeof x!=="string"||!x.length))throw new TypeError("capabilityIds must be nonempty strings");
  if(typeof includeCandidates!=="boolean")throw new TypeError("includeCandidates must be boolean");
  const registry=readCapabilityRegistry();
  const known=new Set(registry.capabilities.map(c=>c.id));
  const needed=new Set(capabilityIds);
  for(const id of needed)if(!known.has(id))throw new RangeError("unknown capability: "+id);
  const rank={existing:0,A:1,B:2,C:3};
  const records=registry.tools
    .filter(t=>(includeCandidates||t.origin==="native-ref")&&t.capability_ids.some(c=>needed.has(c)))
    .map(t=>({
       id:t.id, origin:t.origin, priority:t.priority,
       matched_capabilities:t.capability_ids.filter(c=>needed.has(c)),
       availability:t.availability,
       executable:false, // tool availability remains unverified and must be separately probed
       verification_status:"NOT_RUN",
       evidence_ref:t.evidence_ref,
       official_url:t.official_url,
       limitation:"Discovery is not an executable/verified tool plan"
    }))
    .sort((a,b)=>rank[a.priority]-rank[b.priority]||b.matched_capabilities.length-a.matched_capabilities.length||a.id.localeCompare(b.id));
  return {required_capabilities:[...needed].sort(), candidates:records,
          uncovered_capabilities:[...needed].filter(c=>!records.some(t=>t.matched_capabilities.includes(c))).sort(),
          status:"DISCOVERY_ONLY_NOT_RUN"};
}

export function listProblemCapabilities() {
  return readCapabilityRegistry().capabilities.map(c=>({id:c.id,label:c.label,limitations:c.limitations}));
}
