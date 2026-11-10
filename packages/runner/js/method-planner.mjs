/**
 * G2: LLM-proposed Method DAG — planning and static policy admission ONLY.
 *
 * All LLM/provider content is untrusted input. This module does not launch
 * processes, execute tools, certify facts, grant permissions or promote Solutions.
 * Existing native-catalog.mjs remains the only executable operation registry.
 */
import { createHash } from "node:crypto";
import { readCapabilityRegistry } from "./problem-capabilities.mjs";
import { describeNativeTool } from "./native-catalog.mjs";

const privacy = ["PUBLIC", "USER_PRIVATE", "RESTRICTED"];
const kinds = new Set(["symbolic", "bounded_model", "program", "statistical", "external_fact", "not_formalizable"]);
const idPattern = /^[a-z][a-z0-9_.-]{0,79}$/;
const hexPattern = /^[a-f0-9]{64}$/;
const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);
const isId = x => typeof x === "string" && idPattern.test(x);
const unique = arr => Array.isArray(arr) && new Set(arr).size === arr.length;
const finiteInt = (x, low, high) => Number.isSafeInteger(x) && x >= low && x <= high;
const within = (x, choices) => typeof x === "string" && choices.includes(x);
const hasOnly = (obj, names) => isObject(obj) && Object.keys(obj).every(k => names.includes(k));
const reference = (x, ids) => isId(x) && ids.has(x);
const strongest = labels => privacy[Math.max(0, ...labels.map(x => privacy.indexOf(x)))];
const rank = x => privacy.indexOf(x);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : isObject(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]))
  : value;
const digest = obj => createHash("sha256").update(JSON.stringify(canonical(obj))).digest("hex");

export function validateProblemSpec(problem) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!isObject(problem)) return {ok:false,errors:["ProblemSpec must be an object"]};
  if (!hasOnly(problem,["schema","problem_id","source_refs","requirements","claims","oracles","capability_ids","budget","policy"]))
    fail("ProblemSpec has unexpected fields");
  if(problem.schema!=="formal-tools/problem-spec/0.1"||!isId(problem.problem_id))fail("invalid ProblemSpec identity");
  const catalog=readCapabilityRegistry();
  const knownCaps=new Set(catalog.capabilities.map(x=>x.id));
  const caps=problem.capability_ids;
  if(!Array.isArray(caps)||!caps.length||!unique(caps)||caps.some(x=>!knownCaps.has(x)))
    fail("unknown, duplicate or empty problem capabilities");
  const sources=Array.isArray(problem.source_refs)?problem.source_refs:[];
  if(!sources.length||sources.length>32)fail("source_refs required (1..32)");
  const sourceIds=new Set();
  for(const s of sources){
    if(!hasOnly(s,["id","sha256","classification","purpose","consumer"])||
       !isId(s?.id)||!hexPattern.test(s?.sha256)||!within(s?.classification,privacy)||
       typeof s?.purpose!=="string"||!s.purpose.trim()||!isId(s?.consumer))
      {fail("invalid source reference, hash, purpose or classification");continue;}
    if(sourceIds.has(s.id))fail("duplicate source id "+s.id);
    sourceIds.add(s.id);
  }
  const reqs=Array.isArray(problem.requirements)?problem.requirements:[];
  if(!reqs.length||reqs.length>64)fail("requirements required (1..64)");
  const reqIds=new Set();
  for(const x of reqs){
    if(!hasOnly(x,["id","source_ref","text"])||!isId(x?.id)||!reference(x?.source_ref,sourceIds)||
       typeof x?.text!=="string"||!x.text.trim())
      {fail("invalid requirement or source anchor");continue;}
    if(reqIds.has(x.id))fail("duplicate requirement "+x.id);
    reqIds.add(x.id);
  }
  const claims=Array.isArray(problem.claims)?problem.claims:[];
  if(!claims.length||claims.length>64)fail("claims required (1..64)");
  const claimIds=new Set();
  for(const x of claims){
    if(!hasOnly(x,["id","text","kind","requirement_ids","source_refs","capability_ids"])||
       !isId(x?.id)||typeof x?.text!=="string"||!x.text.trim()||!kinds.has(x?.kind)||
       !Array.isArray(x?.requirement_ids)||!x.requirement_ids.length||!unique(x.requirement_ids)||
       x.requirement_ids.some(y=>!reference(y,reqIds))||
       !Array.isArray(x?.source_refs)||!unique(x.source_refs)||x.source_refs.some(y=>!reference(y,sourceIds))||
       !Array.isArray(x?.capability_ids)||!unique(x.capability_ids)||
       x.capability_ids.some(y=>!knownCaps.has(y)||!caps?.includes(y)))
      {fail("invalid claim/anchors/capability mappings");continue;}
    if(claimIds.has(x.id))fail("duplicate claim "+x.id);
    claimIds.add(x.id);
  }
  const oracles=Array.isArray(problem.oracles)?problem.oracles:[];
  if(!oracles.length||oracles.length>16)fail("oracle refs required (1..16)");
  const oracleIds=new Set();
  for(const x of oracles){
    if(!hasOnly(x,["id","source_ref","frozen","positive_case_ids","negative_case_ids","review_identity"])||
       !isId(x?.id)||!reference(x?.source_ref,sourceIds)||x?.frozen!==true||
       !Array.isArray(x?.positive_case_ids)||!x.positive_case_ids.length||!unique(x.positive_case_ids)||
       x.positive_case_ids.some(y=>!isId(y))||
       !Array.isArray(x?.negative_case_ids)||!x.negative_case_ids.length||!unique(x.negative_case_ids)||
       x.negative_case_ids.some(y=>!isId(y))||
       !isId(x?.review_identity))
      {fail("invalid/flexible oracle reference (positive and negative cases required)");continue;}
    if(oracleIds.has(x.id))fail("duplicate oracle "+x.id);
    oracleIds.add(x.id);
  }
  const b=problem.budget;
  if(!hasOnly(b,["max_steps","max_depth","max_cost_units","max_total_time_ms","max_retries"])||
     !finiteInt(b?.max_steps,1,12)||!finiteInt(b?.max_depth,1,12)||
     !finiteInt(b?.max_cost_units,1,100000)||!finiteInt(b?.max_total_time_ms,1,600000)||
     !finiteInt(b?.max_retries,0,2))fail("invalid bounded planning budget");
  const p=problem.policy;
  if(!hasOnly(p,["allowed_tools","allowed_operations","destination","max_input_classification","allow_network"])||
     !Array.isArray(p?.allowed_tools)||!unique(p.allowed_tools)||p.allowed_tools.some(x=>!isId(x))||
     !isObject(p?.allowed_operations)||
     !Object.entries(p?.allowed_operations??{}).every(([k,ops])=>p.allowed_tools.includes(k)&&Array.isArray(ops)&&unique(ops)&&ops.every(isId))||
     p?.destination!=="LOCAL"||!within(p?.max_input_classification,privacy)||p?.allow_network!==false)
    fail("invalid/unsafe source-to-tool permission policy (G2 is local-only)");
  return {ok:errors.length===0,errors,counts:{sources:sources.length,requirements:reqs.length,claims:claims.length,oracles:oracles.length}};
}

export function assessMethod(problem, method) {
  const pre=validateProblemSpec(problem);
  const issues=[...pre.errors];
  const fail = message => issues.push(message);
  if(!isObject(method))return {status:"REJECTED",issues:[...issues,"Method must be an object"],executable:false,claim_result:"INCONCLUSIVE"};
  if(!hasOnly(method,["schema","method_id","problem_id","goal_claim_ids","steps","oracle_ids","semantic_review"]))
    fail("Method contains unexpected fields (no shell, argv or tool output claims)");
  if(method.schema!=="formal-tools/method-proposal/0.1"||!isId(method.method_id)||
     method.problem_id!==problem?.problem_id)fail("Method identity or ProblemSpec link invalid");
  if(method.semantic_review!=="PENDING")fail("G2 cannot claim semantic review success");
  const claimIds=new Set((problem?.claims??[]).filter(x=>isId(x?.id)).map(x=>x.id));
  const target=(problem?.claims??[]).filter(x=>x?.kind!=="external_fact"&&x?.kind!=="not_formalizable").map(x=>x.id);
  if(!Array.isArray(method.goal_claim_ids)||!unique(method.goal_claim_ids)||
     method.goal_claim_ids.some(x=>!reference(x,claimIds))||target.some(x=>!method.goal_claim_ids.includes(x)))
    fail("uncovered, forged or duplicate goal claim ID");
  const validOracleIds=new Set((problem?.oracles??[]).map(x=>x.id));
  if(!Array.isArray(method.oracle_ids)||!method.oracle_ids.length||!unique(method.oracle_ids)||
     method.oracle_ids.some(x=>!reference(x,validOracleIds)))fail("unknown, duplicate or missing frozen oracle references");
  const steps=Array.isArray(method.steps)?method.steps:[];
  const budget=problem?.budget??{};
  if(!steps.length||steps.length>budget.max_steps)fail("step count exceeds budget or is empty");
  const catalog=readCapabilityRegistry(), tools=new Map(catalog.tools.map(t=>[t.id,t]));
  const capIds=new Set(problem?.capability_ids??[]);
  const sourceMap=new Map((problem?.source_refs??[]).filter(x=>isId(x?.id)).map(x=>[x.id,x]));
  const permissions=problem?.policy??{};
  const stepMap=new Map(),coverage=new Set();
  let cost=0, totalTime=0, hasCandidate=false;
  for(const s of steps){
    if(!hasOnly(s,["id","tool_id","operation","provides","depends_on","source_refs","estimated_cost_units","timeout_ms","destination","output_classification"])) {fail("invalid step fields");continue;}
    if(!isId(s.id)||stepMap.has(s.id)){fail("invalid/duplicate step id");continue;}
    stepMap.set(s.id,s);
    const tool=tools.get(s.tool_id);
    if(!tool){fail("unregistered tool: "+s.tool_id);continue;}
    if(!permissions.allowed_tools?.includes(s.tool_id))fail("tool not permitted by source policy: "+s.tool_id);
    if(!Array.isArray(s.provides)||!s.provides.length||!unique(s.provides)||
       s.provides.some(x=>!capIds.has(x)||!tool.capability_ids.includes(x)))
      fail("tool does not provide claimed required capabilities: "+s.id);
    else s.provides.forEach(x=>coverage.add(x));
    if(!Array.isArray(s.depends_on)||!unique(s.depends_on)||s.depends_on.some(x=>!isId(x)||x===s.id))
      fail("bad dependencies: "+s.id);
    if(!Array.isArray(s.source_refs)||!unique(s.source_refs)||s.source_refs.some(x=>!reference(x,new Set(sourceMap.keys()))))
      fail("unknown source dependencies: "+s.id);
    if(!finiteInt(s.estimated_cost_units,0,100000)||!finiteInt(s.timeout_ms,1,600000))
      fail("unbounded per-step cost/time: "+s.id);
    else {cost+=s.estimated_cost_units;totalTime+=s.timeout_ms;}
    if(s.destination!=="LOCAL"||!within(s.output_classification,privacy))
      fail("unauthorized destination or output classification: "+s.id);
    if(tool.origin==="native-ref"){
      let operations={};
      try {operations=describeNativeTool(s.tool_id).operations;} catch {fail("native catalog missing referenced tool: "+s.tool_id);}
      if(!Object.hasOwn(operations,s.operation)||s.operation==="raw")fail("unsupported native typed operation: "+s.id);
      if(!permissions.allowed_operations?.[s.tool_id]?.includes(s.operation))fail("typed operation not permitted: "+s.id);
    }else{
      hasCandidate=true;
      if(s.operation!=="UNRESOLVED")fail("candidate tool may not claim a runnable operation: "+s.id);
    }
  }
  if(steps.some(s=>!isObject(s)))fail("malformed step record");
  for(const needed of target.flatMap(id=>(problem.claims.find(x=>x.id===id)?.capability_ids??[]))){
    if(!coverage.has(needed))fail("required checkable-claim capability uncovered: "+needed);
  }
  if(cost>budget.max_cost_units||totalTime>budget.max_total_time_ms)fail("total method budget exceeded");
  const levels=new Map(),visiting=new Set();
  const depthOf=id=>{
    if(levels.has(id))return levels.get(id);
    if(visiting.has(id)){fail("dependency cycle at "+id);return 1000;}
    const s=stepMap.get(id);
    if(!s){fail("unknown dependency: "+id);return 1000;}
    visiting.add(id);
    let depth=1;
    for(const dep of (Array.isArray(s.depends_on)?s.depends_on:[]))depth=Math.max(depth,depthOf(dep)+1);
    visiting.delete(id);levels.set(id,depth);
    return depth;
  };
  for(const id of stepMap.keys())if(depthOf(id)>budget.max_depth)fail("method depth exceeds budget: "+id);
  const taint=new Map();
  const classOf=id=>{
    if(taint.has(id))return taint.get(id);
    const s=stepMap.get(id);if(!s)return "RESTRICTED";
    const inputs=(Array.isArray(s.source_refs)?s.source_refs:[]).map(ref=>sourceMap.get(ref)?.classification??"RESTRICTED");
    const inherited=(Array.isArray(s.depends_on)?s.depends_on:[]).map(dep=>taint.get(dep)??"RESTRICTED");
    const label=strongest([...inputs,...inherited]);
    if(rank(s.output_classification)<rank(label))fail("derived output illegally declassified: "+id);
    if(rank(label)>rank(permissions.max_input_classification))fail("input sensitivity exceeds policy: "+id);
    taint.set(id,strongest([label,s.output_classification]));
    return taint.get(id);
  };
  for(const [id] of [...stepMap.entries()].sort((a,b)=>(levels.get(a[0])??0)-(levels.get(b[0])??0)))classOf(id);
  const unverifiable=(problem?.claims??[]).filter(x=>x?.kind==="external_fact" && !x?.source_refs?.length).map(x=>x.id);
  const status=issues.length?"REJECTED":"STRUCTURALLY_VALID";
  return {
    status,issues:[...new Set(issues)],method_sha256:digest(method),problem_sha256:digest(problem),
    candidate_tools_present:hasCandidate,tool_execution:"NOT_RUN",executable:false,
    semantic_fidelity:"NOT_EVALUATED",independent_oracle_review:"NOT_RUN",
    claim_result:unverifiable.length?"NEEDS_SOURCE":"INCONCLUSIVE",
    needs_source_claim_ids:unverifiable,solution_promotable:false,
    budget:{planned_cost_units:cost,planned_total_timeout_ms:totalTime,step_count:steps.length}
  };
}

/**
 * Optional LLM adapter (injected callback). One bounded proposal only;
 * no provider dependency, retries, executable tool calls or self-verification.
 * Callback receives read-only metadata and must return JSON or JSON object.
 */
export async function proposeMethod(problem, generate) {
  const checked=validateProblemSpec(problem);
  if(!checked.ok)return {status:"REJECTED",issues:checked.errors,tool_execution:"NOT_RUN",executable:false,solution_promotable:false};
  if(typeof generate!=="function")throw new TypeError("generate must be an injected LLM proposal callback");
  const catalog=readCapabilityRegistry();
  const wanted=new Set(problem.capability_ids);
  const options=catalog.tools.filter(t=>t.capability_ids.some(c=>wanted.has(c)))
    .map(t=>({id:t.id,origin:t.origin,capability_ids:t.capability_ids.filter(c=>wanted.has(c)),
              availability:t.availability,operation_policy:"native-typed-allowlist-or-candidate-UNRESOLVED"}));
  const prompt={mode:"UNTRUSTED_PROPOSAL_ONLY",problem:structuredClone(problem),
                candidates:options,max_steps:problem.budget.max_steps,
                warning:"No execution authority. Do not invent claim verification, model equivalence or tool receipts."};
  try {
    let reply=await generate(prompt);
    if(typeof reply==="string"){
      if(reply.length>65536)throw new RangeError("LLM proposal too long");
      reply=JSON.parse(reply);
    }
    return assessMethod(problem,reply);
  }catch(error){
    return {status:"REJECTED",issues:["proposal provider failed or returned invalid JSON"],
      provider_failure:String(error?.message??error).slice(0,200),tool_execution:"NOT_RUN",
      executable:false,solution_promotable:false};
  }
}
