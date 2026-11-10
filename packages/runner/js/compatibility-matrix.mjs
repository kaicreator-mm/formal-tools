/**
 * Tool-only compatibility inventory, derived from the authoritative registry.
 * Supports multiple OS/architecture/version observations per tool without
 * promoting self-reported runtime data into independent acceptance.
 */
import { toolIds,describeNativeTool } from "./native-catalog.mjs";

const sha40=/^[a-f0-9]{40}$/;
const sha256=/^[a-f0-9]{64}$/;
const simple=/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;
const reportedStatuses=new Set(["NOT_RUN","EXECUTED","ERROR","TIMEOUT","INCONCLUSIVE","UNVERIFIED"]);
const summarize=items=>({
  NOT_RUN:items.filter(x=>x.observation_status==="NOT_RUN").length,
  STALE_SHA:items.filter(x=>x.observation_status==="STALE_SHA").length,
  REPORTED_UNREVIEWED:items.filter(x=>x.observation_status==="REPORTED_UNREVIEWED").length
});
export function buildCompatibilityMatrix({targetHead,observations=[]}={}){
  if(typeof targetHead!=="string"||!sha40.test(targetHead))
    throw new TypeError("targetHead must be a full 40-character Git commit SHA");
  if(!Array.isArray(observations)||observations.length>10000)
    throw new TypeError("observations must be an array of at most 10000 entries");
  const byTool=new Map(toolIds.map(id=>[id,[]]));
  const unique=new Set();
  for(const obs of observations){
    if(!obs||typeof obs!=="object"||!byTool.has(obs.tool_id))
      throw new TypeError("observation references unknown tool");
    if(!sha40.test(obs.git_head??""))throw new TypeError("observation requires exact SHA");
    if(!simple.test(obs.platform??"")||!simple.test(obs.arch??""))
      throw new TypeError("observation requires valid platform and architecture");
    if(obs.tool_version!==undefined&&(typeof obs.tool_version!=="string"||!obs.tool_version||obs.tool_version.length>200))
      throw new TypeError("invalid native tool version");
    if(obs.evidence_sha256!==undefined&&!sha256.test(obs.evidence_sha256))
      throw new TypeError("invalid evidence SHA-256 digest");
    if(obs.run_status!==undefined&&!reportedStatuses.has(obs.run_status))
      throw new TypeError("invalid declared run status");
    // Same tool+host+version can legitimately be reported at different commits.
    const key=JSON.stringify([obs.tool_id,obs.git_head,obs.platform,obs.arch,obs.tool_version??""]);
    if(unique.has(key))throw new TypeError("duplicate tool/OS/version/SHA observation");
    unique.add(key);
    byTool.get(obs.tool_id).push({
      observation_status:obs.git_head===targetHead?"REPORTED_UNREVIEWED":"STALE_SHA",
      git_head:obs.git_head,platform:obs.platform,arch:obs.arch,
      ...(obs.tool_version?{tool_version:obs.tool_version}:{}),
      ...(obs.evidence_sha256?{evidence_sha256:obs.evidence_sha256}:{}),
      declared_run_status:obs.run_status??"UNKNOWN"
    });
  }
  const tools=toolIds.map(id=>{
    const desc=describeNativeTool(id);
    const observations=byTool.get(id).sort((a,b)=>{
      const ka=[a.platform,a.arch,a.tool_version??"",a.git_head].join("|");
      const kb=[b.platform,b.arch,b.tool_version??"",b.git_head].join("|");
      return ka<kb?-1:ka>kb?1:0;
    });
    const hasCurrent=observations.some(o=>o.observation_status==="REPORTED_UNREVIEWED");
    const status=hasCurrent?"REPORTED_UNREVIEWED":observations.length?"STALE_SHA":"NOT_RUN";
    return {
      id,title:desc.title,official_documentation:desc.documentation,
      entrypoints:[...desc.entries],
      typed_operation_count:Object.keys(desc.operations).length,
      observation_status:status,
      observations,
      // Compatibility for existing single-observation readers only.
      ...(observations.length===1?{reported:{
        git_head:observations[0].git_head,platform:observations[0].platform,
        arch:observations[0].arch,
        ...(observations[0].tool_version?{tool_version:observations[0].tool_version}:{}),
        ...(observations[0].evidence_sha256?{evidence_sha256:observations[0].evidence_sha256}:{}),
        declared_run_status:observations[0].declared_run_status
      }}:{})
    };
  });
  const rows=tools.flatMap(x=>x.observations);
  return {
    schema:"formal-tools/tool-compatibility-matrix/1",
    target_git_head:targetHead,
    status:"SOURCE_CATALOG_WITH_UNREVIEWED_HOST_OBSERVATIONS",
    tool_count:tools.length,
    typed_operation_count:tools.reduce((n,v)=>n+v.typed_operation_count,0),
    counts:summarize(tools), // counts are per registered tool
    observation_counts:{
      STALE_SHA:rows.filter(x=>x.observation_status==="STALE_SHA").length,
      REPORTED_UNREVIEWED:rows.filter(x=>x.observation_status==="REPORTED_UNREVIEWED").length
    },
    tools,
    caution:"Tool registration does not establish OS/runtime support. Matching-SHA reports remain unreviewed, older reports are stale. No cross-platform runtime PASS is inferred."
  };
}
