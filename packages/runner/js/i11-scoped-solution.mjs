/**
 * #11/#170 R109-C: first-party, read-only finite-Solution consumer contract.
 *
 * Separate namespace from G4 Candidate persistence/qualification-witness:
 * this module does NOT change Candidate NOT_ADMITTED, the empty G4 trust-root
 * registry, professional business Oracle authority or external Effect rights.
 * Its QUALIFIED_WITH_SCOPE is restricted to one fully frozen finite graph.
 */
import {readFileSync} from "node:fs";
import {open, link, unlink, lstat, readFile, realpath} from "node:fs/promises";
import {createHash, randomUUID} from "node:crypto";
import {isAbsolute, join} from "node:path";
import {fileURLToPath} from "node:url";
import {enumerateSimplePaths} from "../../../benchmarks/llm-methods/i11/r109/c/independent-oracle.mjs";

const SOURCE = new URL("../../../benchmarks/llm-methods/i11/r109/c/graph-source.json", import.meta.url);
const ORACLE = new URL("../../../benchmarks/llm-methods/i11/r109/c/independent-oracle.mjs", import.meta.url);
const TOOL = new URL(import.meta.url);
const SCOPE = "LOCAL_FINITE_GRAPH_READ_ONLY";
const CONSUMER = "formal-tools-local-consumer";
const VERSION = "finite-dijkstra/1";
const START = 1767225600000; // 2026-01-01: frozen finite example
const END = 1893456000000;   // 2030-01-01: expires; no user override
const HEX64 = /^[0-9a-f]{64}$/;
const NONCE = /^[a-z0-9._-]{12,80}$/;
const EXPECTED_EDGES = [["a","b",2],["a","c",9],["b","c",3],["b","d",7],["c","d",2]];
const FIELDS = ["schema","source_id","source_version","source_sha256","oracle_sha256",
  "model_sha256","tool_sha256","tool_version","evidence_sha256","distance","path",
  "scope","consumer_id","valid_from_ms","valid_until_ms","qualification","effect_authority"];
const isPlain = x => x !== null && typeof x === "object" &&
  !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const exact = (x, keys) => isPlain(x) && Object.keys(x).length === keys.length &&
  keys.every(k => Object.hasOwn(x,k));
const sha256 = x => createHash("sha256").update(x).digest("hex");
const deny = (status,reason) => Object.freeze({schema:"formal-tools/i11-scoped-consumer-result/1",
  status,reason,qualified_solution:false,local_reuse_allowed:false,effect_dispatched:false,
  external_host_executed:false});
const uniqueId = x => typeof x === "string" && HEX64.test(x);
const sourceOK = x => exact(x,["schema","source_id","source_version","scope","nodes",
    "start","goal","edges"]) && x.schema==="formal-tools/i11-r109-fixed-graph/1" &&
  x.source_id==="local.finite.graph.v1" && x.source_version==="1" &&
  x.scope===SCOPE && x.start==="a" && x.goal==="d" &&
  JSON.stringify(x.nodes)===JSON.stringify(["a","b","c","d"]) &&
  JSON.stringify(x.edges)===JSON.stringify(EXPECTED_EDGES);

function dijkstra(graph){
  const costs = new Map(graph.nodes.map(n=>[n,Infinity]));
  const paths = new Map([[graph.start,[graph.start]]]);
  const visited = new Set();
  costs.set(graph.start,0);
  while(visited.size < graph.nodes.length){
    let next=null;
    for(const n of graph.nodes)
      if(!visited.has(n) && (next===null || costs.get(n)<costs.get(next))) next=n;
    if(next===null || !Number.isFinite(costs.get(next))) break;
    visited.add(next);
    for(const [from,to,cost] of graph.edges){
      if(from===next && !visited.has(to) && costs.get(next)+cost<costs.get(to)){
        costs.set(to,costs.get(next)+cost);
        paths.set(to,[...paths.get(next),to]);
      }
    }
  }
  return {status:Number.isFinite(costs.get(graph.goal))?"PROVEN":"UNKNOWN",
    distance:costs.get(graph.goal),path:paths.get(graph.goal)??[]};
}

function makeCanonical(){
  const raw=readFileSync(SOURCE);
  if(raw.length>4096)throw Error("SOURCE_OVER_BUDGET");
  const graph=JSON.parse(raw.toString("utf8"));
  if(!sourceOK(graph))throw Error("SOURCE_NOT_APPROVED_FIXED_GRAPH");
  const oracleBytes=readFileSync(ORACLE);
  const toolBytes=readFileSync(TOOL);
  const oracle=enumerateSimplePaths(graph);
  const solved=dijkstra(graph);
  if(solved.status!=="PROVEN" || oracle.status!=="PROVEN" ||
     oracle.distance!==7 || solved.distance!==oracle.distance ||
     JSON.stringify(solved.path)!==JSON.stringify(["a","b","c","d"]))
    throw Error("INDEPENDENT_SEMANTIC_ORACLE_DISAGREES");
  const source_sha256=sha256(raw);
  const oracle_sha256=sha256(oracleBytes);
  const tool_sha256=sha256(toolBytes);
  const model_sha256=sha256(JSON.stringify({nodes:graph.nodes,edges:graph.edges,
    start:graph.start,goal:graph.goal}));
  const evidence_sha256=sha256(JSON.stringify({solver:solved,oracle}));
  const record={
    schema:"formal-tools/i11-scoped-solution/1",
    source_id:graph.source_id,source_version:graph.source_version,
    source_sha256,oracle_sha256,model_sha256,tool_sha256,
    tool_version:VERSION,evidence_sha256,distance:solved.distance,
    path:solved.path,scope:SCOPE,consumer_id:CONSUMER,
    valid_from_ms:START,valid_until_ms:END,
    qualification:"QUALIFIED_WITH_SCOPE",effect_authority:"NONE"
  };
  return {...record,solution_id:sha256(JSON.stringify(record))};
}

/** The current evidence is locally computed, never imported from an app or Host. */
export function observeLocalScopedEvidence(){
  try{
    const record=makeCanonical();
    const {solution_id, ...rest}=record;
    return {source_sha256:rest.source_sha256,oracle_sha256:rest.oracle_sha256,
      model_sha256:rest.model_sha256,tool_sha256:rest.tool_sha256,
      tool_version:rest.tool_version,evidence_sha256:rest.evidence_sha256};
  }catch{return null;}
}

async function ownerRoot(dir){
  if(typeof dir!=="string" || !isAbsolute(dir))throw Error("LOCAL_ROOT_REQUIRED");
  const stat=await lstat(dir);
  if(!stat.isDirectory() || stat.isSymbolicLink())throw Error("UNTRUSTED_STORE_ROOT");
  return realpath(dir);
}
function paths(root,id){
  return {solution:join(root,"local-qualified-"+id+".json"),
    revoked:join(root,"local-qualified-"+id+".revoked.json")};
}
async function boundedRead(path){
  const stat=await lstat(path);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size<1 || stat.size>8192)
    throw Error("NOT_BOUNDED_REGULAR_FILE");
  return readFile(path,"utf8");
}
async function existsStrict(path){
  try{await boundedRead(path);return true;}
  catch(error){if(error?.code==="ENOENT")return false;throw error;}
}
async function dirsync(root){
  const handle=await open(root,"r");
  try{await handle.sync();}finally{await handle.close();}
}
async function publish(root,path,text){
  // fsync BEFORE and AFTER atomic no-replace hard-link publication.
  await dirsync(root);
  const temp=join(root,".i11-pending-"+randomUUID());
  let file;
  try{
    file=await open(temp,"wx",0o600);
    await file.writeFile(text,"utf8");
    await file.sync();await file.close();file=null;
    try{await link(temp,path);}
    catch(e){
      if(e?.code!=="EEXIST")throw e;
      if(await boundedRead(path)!==text)throw Error("EXISTING_RECORD_MISMATCH");
      return "EXISTING";
    }
    await dirsync(root);
    return "NEW";
  }finally{
    await file?.close();
    await unlink(temp).catch(e=>{if(e?.code!=="ENOENT")throw e;});
  }
}
function validateStored(text,expected){
  if(typeof text!=="string" || Buffer.byteLength(text)>8192)return false;
  const item=JSON.parse(text);
  if(!exact(item,[...FIELDS,"solution_id"])||!uniqueId(item.solution_id))return false;
  const {solution_id,...unsigned}=item;
  return sha256(JSON.stringify(unsigned))===solution_id &&
    JSON.stringify(item)===JSON.stringify(expected);
}
async function readCurrent(root,id){
  if(!uniqueId(id))throw Error("INVALID_SOLUTION_ID");
  const now=makeCanonical();
  const p=paths(root,id);
  // Revocation dominates a bit-identical record.
  if(await existsStrict(p.revoked))return {status:"INVALIDATED"};
  const text=await boundedRead(p.solution);
  if(!validateStored(text,now) || now.solution_id!==id)
    return {status:"STALE"};
  return {status:"CURRENT",record:now,paths:p};
}
/**
 * Deterministic local-only admission, NOT a production trust-root promotion.
 * Caller cannot submit source bytes, Oracle, tool, expiry or authority.
 */
export async function admitScopedSolution({store_dir}={}){
  try{
    const root=await ownerRoot(store_dir);
    const record=makeCanonical();
    if(Date.now()<START || Date.now()>=END)return deny("STALE","SOURCE_VERSION_EXPIRED");
    const p=paths(root,record.solution_id);
    if(await existsStrict(p.revoked))return deny("INVALIDATED","REVOCATION_DOMINATES");
    const write=await publish(root,p.solution,JSON.stringify(record)+"\n");
    if(await existsStrict(p.revoked))return deny("INVALIDATED","REVOCATION_DOMINATES");
    return Object.freeze({schema:"formal-tools/i11-scoped-consumer-result/1",
      status:"QUALIFIED_WITH_SCOPE",solution_id:record.solution_id,
      scope:SCOPE,qualifier:"INDEPENDENT_FINITE_ENUMERATION",
      source_sha256:record.source_sha256,oracle_sha256:record.oracle_sha256,
      record_write:write,qualified_solution:true,
      local_reuse_allowed:true,effect_dispatched:false,external_host_executed:false});
  }catch{return deny("BLOCKED","SOURCE_OR_STORE_PROOF_UNAVAILABLE");}
}
/**
 * Trusted-local JS SDK consumer: a fixed-scope read-only observation.
 * observed pins only RESTRICT; client-supplied fields never grant authority.
 */
export async function consumeScopedSolution({store_dir,request}={}){
  try{
    if(!exact(request,["schema","solution_id","consumer_id","scope","nonce",
        "now_ms","observed","tool_outcome","budget_ms"]) ||
       request.schema!=="formal-tools/i11-scoped-consumption/1" ||
       !uniqueId(request.solution_id) || request.consumer_id!==CONSUMER ||
       request.scope!==SCOPE || !NONCE.test(request.nonce) ||
       !Number.isSafeInteger(request.now_ms) ||
       !Number.isSafeInteger(request.budget_ms) || request.budget_ms<0 ||
       request.budget_ms>10000)
      return deny("BLOCKED","SCOPE_IDENTITY_OR_REQUEST_INVALID");
    if(request.budget_ms===0 || request.tool_outcome==="TIMEOUT")
      return deny("TIMEOUT","BUDGET_EXHAUSTED");
    if(request.tool_outcome==="UNKNOWN")return deny("UNKNOWN","TOOL_RESULT_NOT_PROVEN");
    if(request.tool_outcome==="ERROR")return deny("ERROR","TOOL_RESULT_FAILED");
    if(request.tool_outcome!=="PROVEN")return deny("BLOCKED","UNRECOGNIZED_TOOL_RESULT");
    const observed=request.observed, live=observeLocalScopedEvidence();
    if(!live || !exact(observed,Object.keys(live)) ||
       Object.keys(live).some(k=>observed[k]!==live[k]))
      return deny("STALE","ORIGIN_OR_VERSION_DRIFT");
    const root=await ownerRoot(store_dir);
    const state=await readCurrent(root,request.solution_id);
    if(state.status!=="CURRENT")return deny(state.status,"DURABLE_SOLUTION_NOT_CURRENT");
    const effectiveNow=Math.max(Date.now(),request.now_ms);
    if(effectiveNow<state.record.valid_from_ms ||
       effectiveNow>=state.record.valid_until_ms)
      return deny("STALE","SOLUTION_EXPIRED");
    const noncePath=join(root,"local-qualified-"+request.solution_id+
      ".nonce-"+sha256(request.nonce)+".spent.json");
    const publication=await publish(root,noncePath,JSON.stringify({
      schema:"formal-tools/i11-consumption-marker/1",solution_id:request.solution_id,
      nonce_sha256:sha256(request.nonce)})+"\n");
    if(publication!=="NEW")return deny("REPLAY_REJECTED","NONCE_ALREADY_CONSUMED");
    // A concurrently committed durable tombstone dominates completion.
    if(await existsStrict(state.paths.revoked))return deny("INVALIDATED","REVOKED_DURING_CONSUMPTION");
    return Object.freeze({schema:"formal-tools/i11-scoped-consumer-result/1",
      status:"CONSUMED_READ_ONLY",qualification:"QUALIFIED_WITH_SCOPE",
      distance:state.record.distance,path:[...state.record.path],
      solution_id:request.solution_id,nonce:request.nonce,
      qualified_solution:true,local_reuse_allowed:true,
      scope:SCOPE,effect_dispatched:false,external_host_executed:false});
  }catch{return deny("BLOCKED","DURABLE_CONSUMER_VALIDATION_FAILED");}
}
export async function revokeScopedSolution({store_dir,solution_id}={}){
  try{
    const root=await ownerRoot(store_dir);
    const state=await readCurrent(root,solution_id);
    if(state.status==="INVALIDATED")return deny("INVALIDATED","ALREADY_REVOKED");
    if(state.status!=="CURRENT")return deny(state.status,"NOT_CURRENT_FOR_REVOCATION");
    await publish(root,state.paths.revoked,JSON.stringify({
      schema:"formal-tools/i11-local-revocation/1",solution_id})+"\n");
    return deny("INVALIDATED","DURABLE_REVOCATION");
  }catch{return deny("BLOCKED","REVOCATION_FAILED");}
}
