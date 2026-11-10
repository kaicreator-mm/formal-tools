/**
 * Technical compatibility inventory, derived from the authoritative catalog.
 * A locally submitted run receipt is NOT an independent acceptance verdict.
 * Historical reports are only attributable to their own exact Git SHA.
 */
import { toolIds,describeNativeTool } from "./native-catalog.mjs";

const sha40=/^[a-f0-9]{40}$/;
const sha256=/^[a-f0-9]{64}$/;
export function buildCompatibilityMatrix({targetHead,observations=[]}={}){
  if(typeof targetHead!=="string"||!sha40.test(targetHead))
    throw new TypeError("targetHead must be a full 40-character Git commit SHA");
  if(!Array.isArray(observations))throw new TypeError("observations must be an array");
  const source=new Map();
  for(const obs of observations){
    if(!obs||typeof obs!=="object"||!toolIds.includes(obs.tool_id))
      throw new TypeError("observation references unknown tool");
    if(source.has(obs.tool_id))throw new TypeError("duplicate observation for "+obs.tool_id);
    if(!sha40.test(obs.git_head??""))throw new TypeError("observation requires exact SHA");
    if(typeof obs.platform!=="string"||!obs.platform||
      typeof obs.arch!=="string"||!obs.arch)
      throw new TypeError("observation requires platform and architecture");
    if(obs.evidence_sha256!==undefined&&!sha256.test(obs.evidence_sha256))
      throw new TypeError("invalid evidence SHA-256 digest");
    source.set(obs.tool_id,obs);
  }
  const tools=toolIds.map(id=>{
    const desc=describeNativeTool(id),obs=source.get(id);
    const status=!obs?"NOT_RUN":obs.git_head!==targetHead?"STALE_SHA":"REPORTED_UNREVIEWED";
    return {
      id,title:desc.title,official_documentation:desc.documentation,
      entrypoints:[...desc.entries],
      typed_operation_count:Object.keys(desc.operations).length,
      observation_status:status,
      ...(obs?{reported:{git_head:obs.git_head,platform:obs.platform,arch:obs.arch,
        ...(obs.tool_version?{tool_version:obs.tool_version}:{}),
        ...(obs.evidence_sha256?{evidence_sha256:obs.evidence_sha256}:{}),
        declared_run_status:obs.run_status??"UNKNOWN"}}:{})
    };
  });
  return {
    schema:"formal-tools/tool-compatibility-matrix/1",
    target_git_head:targetHead,
    status:"SOURCE_CATALOG_WITH_UNREVIEWED_HOST_OBSERVATIONS",
    tool_count:tools.length,
    typed_operation_count:tools.reduce((n,v)=>n+v.typed_operation_count,0),
    counts:{
      NOT_RUN:tools.filter(x=>x.observation_status==="NOT_RUN").length,
      STALE_SHA:tools.filter(x=>x.observation_status==="STALE_SHA").length,
      REPORTED_UNREVIEWED:tools.filter(x=>x.observation_status==="REPORTED_UNREVIEWED").length
    },
    tools,
    caution:"Tool registration does not establish OS/runtime support. Submitted host observations are not independent runtime acceptance. Never promote reports across Git SHAs."
  };
}
