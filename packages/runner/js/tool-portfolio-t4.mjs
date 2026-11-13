/**
 * Issue #24 T4 gateway: one capability-linked portfolio, never 23 MCP servers.
 *
 * The original 13 native operations retain their existing executable catalog.
 * Candidate tools are discoverable here, but the ONLY currently admitted
 * candidate execution is the portable bundle's committed pos/neg/err fixture.
 * No raw argv, caller-provided script, shell, or arbitrary file input crosses
 * the MCP boundary. T3/T4/T5 qualifications are deliberately independent.
 */
import { readFileSync } from "node:fs";
import { readFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { toolIds } from "./native-catalog.mjs";

const capabilityRegistry=JSON.parse(readFileSync(new URL("../../../registry/PROBLEM_CAPABILITIES.json",import.meta.url),"utf8"));
const dag=JSON.parse(readFileSync(new URL("../../../docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json",import.meta.url),"utf8"));
const oldIds=new Set(toolIds);
const allIds=capabilityRegistry.tools.map(t=>t.id);
const candidateIds=capabilityRegistry.tools.filter(t=>t.origin==="candidate").map(t=>t.id);
const toolById=new Map(capabilityRegistry.tools.map(t=>[t.id,t]));
const versionById=new Map(dag.tools.map(t=>[t.slug,t.version]));
if(allIds.length!==36||new Set(allIds).size!==36||
   candidateIds.length!==23||toolIds.length!==13||
   !toolIds.every(id=>toolById.get(id)?.origin==="native-ref")||
   !candidateIds.every(id=>!oldIds.has(id))||
   !allIds.every(id=>versionById.has(id)))
  throw new Error("portfolio catalog and lifecycle DAG must match 36 unique tools");

const digest=b=>createHash("sha256").update(b).digest("hex");
const maxBytes=1024*1024;
const shaPattern=/^[a-f0-9]{64}$/;
function profile(id){
  const t=toolById.get(id);
  if(!t)throw new RangeError("unknown portfolio tool: "+String(id));
  return t;
}
function candidate(id){
  const t=profile(id);
  if(t.origin!=="candidate")throw new TypeError("Use the existing 13-tool native adapter for "+id);
  return t;
}
export function listPortfolioTools(){
  return capabilityRegistry.tools.map(t=>({
    id:t.id,origin:t.origin,expected_version:versionById.get(t.id),
    capability_ids:[...t.capability_ids],
    execution_adapter:t.origin==="native-ref"?"NATIVE_CATALOG_13":"PORTABLE_FIXTURE_GATE_ONLY",
    t4_status:"NOT_QUALIFIED_NATIVE_REVIEW_REQUIRED",
    t5_status:"NOT_QUALIFIED"
  }));
}
export function describePortfolioTool(id){
  const t=profile(id);
  return {...listPortfolioTools().find(x=>x.id===id),official_url:t.official_url,
    operations:t.origin==="candidate"?["doctor","verify-fixture"]:["EXISTING_NATIVE_CATALOG"],
    raw_argv_allowed:false};
}
function context(){
  const root=process.env.FORMAL_PORTABLE_ROOT;
  const expected=process.env.FORMAL_PORTABLE_RUNNER_SHA256;
  if(process.platform!=="linux"||process.arch!=="x64")
    throw new Error("PORTABLE_HOST_UNSUPPORTED: Debian/Linux x86_64 only");
  if(typeof root!=="string"||!root||!resolve(root).startsWith("/"))
    throw new Error("PORTABLE_ROOT_NOT_CONFIGURED");
  if(typeof expected!=="string"||!shaPattern.test(expected))
    throw new Error("PORTABLE_RUNNER_DIGEST_NOT_PINNED");
  return {root:resolve(root),expected,runner:join(resolve(root),"bin","tool-runner")};
}
async function regular(path,executable=false){
  const s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||(executable&&!(s.mode&0o111)))
    throw new Error("PORTABLE_FILE_NOT_REGULAR_OR_EXECUTABLE");
  return s;
}
async function installed(id){
  candidate(id);
  const ctx=context();
  await regular(ctx.runner,true);
  const b=await readFile(ctx.runner);
  const actual=digest(b);
  if(actual!==ctx.expected)throw new Error("PORTABLE_RUNNER_SHA256_MISMATCH");
  const metaPath=join(ctx.root,"tools",id,"meta.json");
  const shim=join(ctx.root,"tools",id,"run");
  const contract=join(ctx.root,"tests",id,"expect.sh");
  await regular(metaPath);
  await regular(shim,true);
  await regular(contract);
  const meta=JSON.parse(await readFile(metaPath,"utf8"));
  if(meta.id!==undefined&&meta.id!==id)throw new Error("PORTABLE_META_TOOL_ID_MISMATCH");
  if(meta.version!==undefined&&String(meta.version)!==String(versionById.get(id)))
    throw new Error("PORTABLE_VERSION_DRIFT_EXPECTED_"+versionById.get(id));
  return {ctx,meta,meta_sha256:digest(await readFile(metaPath)),
    fixture_contract_sha256:digest(await readFile(contract))};
}
/** Read-only host discovery; a file hit never counts as an execution result. */
export async function inspectPortfolioTool(id){
  const t=profile(id);
  if(t.origin==="native-ref")return {...describePortfolioTool(id),status:"EXISTING_NATIVE_ADAPTER_NOT_PROBED"};
  try{
    const x=await installed(id);
    return {...describePortfolioTool(id),status:"FOUND_PINNED_NOT_EXECUTED",
      runner_sha256:x.ctx.expected,metadata_sha256:x.meta_sha256,
      fixture_contract_sha256:x.fixture_contract_sha256,
      packaged_kind:x.meta.kind??x.meta.tool_kind??"UNKNOWN",
      packaged_version:x.meta.version??"NOT_IN_META"};
  }catch(e){
    return {...describePortfolioTool(id),status:"NOT_AVAILABLE_FAIL_CLOSED",reason:String(e)};
  }
}
export function planPortfolioFixture(id){
  candidate(id);
  return {tool:id,operation:"verify-fixture",entry:"portable/bin/tool-runner",
    args:["verify",id],mode:"typed",scope:"COMMITTED_POS_NEG_ERR_ONLY"};
}
function parseReceipt(id,tsv){
  if(Buffer.byteLength(tsv)>65536)throw new Error("PORTABLE_RECEIPT_TOO_LARGE");
  const rows=tsv.trimEnd().split(/\r?\n/).map(l=>l.split("\t"));
  if(rows[0]?.join("\t")!=="runner_schema\tformal-tools/portable-verify/0.2")
    throw new Error("PORTABLE_RECEIPT_SCHEMA_MISMATCH");
  if(rows.at(-1)?.join("\t")!=="verdict\tPASS")
    throw new Error("PORTABLE_VERDICT_NOT_PASS");
  const cases=rows.slice(1,-1);
  const phases=new Set();
  const evidence=[];
  for(const r of cases){
    if(r.length!==7||r[0]!==id||!["setup","pos","neg","err"].includes(r[1])||
       phases.has(r[1])||!/^-?\d+$/.test(r[2])||!/^\d+$/.test(r[3])||
       r[4]!=="1"||r[5]!=="1"||!r[6])
      throw new Error("PORTABLE_RECEIPT_INVALID_PHASE");
    phases.add(r[1]);
    evidence.push({phase:r[1],exit_code:Number(r[2]),duration_ms:Number(r[3]),
      semantic_pattern_matched:true,exit_contract_matched:true,label:r[6]});
  }
  if(!["pos","neg","err"].every(p=>phases.has(p)))
    throw new Error("PORTABLE_RECEIPT_MISSING_POS_NEG_ERR");
  return evidence;
}
async function capture(argv,env,timeoutS){
  return await new Promise(done=>{
    let outputBytes=0,stdout=[],stderr=[],timedOut=false,overLimit=false,error=null,finished=false;
    const start=Date.now();
    let timer;
    const child=spawn(argv[0],argv.slice(1),{
      shell:false,stdio:["ignore","pipe","pipe"],cwd:env.FORMAL_PORTABLE_ROOT,env,
      detached:process.platform==="linux"
    });
    const kill=()=>{try{if(child.pid&&process.platform==="linux")process.kill(-child.pid,"SIGKILL");
      else child.kill("SIGKILL");}catch{}};
    const push=(parts,b)=>{outputBytes+=b.length;
      if(outputBytes>maxBytes){overLimit=true;kill();}else parts.push(b);};
    child.stdout?.on("data",b=>push(stdout,b));
    child.stderr?.on("data",b=>push(stderr,b));
    const finish=(code,signal)=>{if(finished)return;finished=true;clearTimeout(timer);
      const out=Buffer.concat(stdout),err=Buffer.concat(stderr);
      done({exit_code:code,signal,timed_out:timedOut,output_limit:overLimit,
        elapsed_ms:Date.now()-start,error:error===null?null:String(error),
        stdout:out.toString("utf8"),stderr:err.toString("utf8"),
        stdout_sha256:digest(out),stderr_sha256:digest(err)});};
    child.on("error",e=>{error=e;finish(null,null);});
    child.on("close",finish);
    timer=setTimeout(()=>{timedOut=true;kill();},timeoutS*1000);
  });
}
/** A fixed, versioned portable runner fixture, never arbitrary external input. */
export async function runPortableGate(id,{mode="verify-fixture",timeoutS=120}={}){
  candidate(id);
  if(!["verify-fixture","doctor"].includes(mode))throw new TypeError("unadmitted portable operation");
  if(!Number.isInteger(timeoutS)||timeoutS<1||timeoutS>120)
    throw new TypeError("timeoutS must be integer 1..120");
  let tmp=null;
  try{
    const x=await installed(id);
    tmp=await mkdtemp(join(tmpdir(),"formal-portfolio-t4-"));
    const argv=[x.ctx.runner,mode==="doctor"?"doctor":"verify",id];
    const p=await capture(argv,{...process.env,FORMAL_PORTABLE_ROOT:x.ctx.root,
      FT_EVIDENCE_DIR:tmp},timeoutS);
    let cases=[],error=null;
    if(mode==="verify-fixture"&&!p.timed_out&&!p.output_limit&&p.exit_code===0&&!p.error){
      try{
        const file=join(tmp,"verify-"+id+".tsv");
        await regular(file);
        cases=parseReceipt(id,await readFile(file,"utf8"));
      }catch(e){error=String(e);}
    }
    const complete=mode==="verify-fixture"&&p.exit_code===0&&!p.timed_out&&
      !p.output_limit&&!p.error&&!error&&cases.length>=3;
    return {schema:"formal-tools/portfolio-t4-technical/0.1",tool:id,operation:mode,
      status:mode==="doctor"
        ?(p.exit_code===0&&!p.timed_out&&!p.output_limit&&!p.error?"DOCTOR_EXECUTED_NOT_T3":"DOCTOR_FAILED")
        :(complete?"FIXTURE_TECHNICAL_PASS_UNREVIEWED":"FIXTURE_NOT_QUALIFIED"),
      process:{exit_code:p.exit_code,signal:p.signal,timed_out:p.timed_out,
        output_limit:p.output_limit,elapsed_ms:p.elapsed_ms,error:p.error??error},
      runner_sha256:x.ctx.expected,metadata_sha256:x.meta_sha256,
      fixture_contract_sha256:x.fixture_contract_sha256,
      streams:{stdout:p.stdout,stderr:p.stderr,
        stdout_sha256:p.stdout_sha256,stderr_sha256:p.stderr_sha256},
      cases,scope:"T4_TECHNICAL_ONLY_T3_NATIVE_REVIEW_AND_T5_SEMANTICS_NOT_EVALUATED"};
  }catch(e){
    return {schema:"formal-tools/portfolio-t4-technical/0.1",tool:id,operation:mode,
      status:"NOT_RUN_FAIL_CLOSED",reason:String(e),
      scope:"T3_T4_T5_NOT_QUALIFIED"};
  }finally{if(tmp)await rm(tmp,{recursive:true,force:true});}
}
