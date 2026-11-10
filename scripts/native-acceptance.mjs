import { knownTools, doctor, runFixture, executeNativePlan } from "../packages/runner/js/native.mjs";
import { planNative } from "../packages/runner/js/native-catalog.mjs";
import { inspectInstallation } from "../packages/runner/js/tool-manager.mjs";
import { mkdir, writeFile, readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import os from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * One-shot local native acceptance. Does NOT install/download tools or modify CI.
 * Writes receipts to a user-chosen directory (never directly to tracked main).
 * Missing tools and parser gaps are recorded; no invented PASS statuses.
 *
 * v1.1 additions (receipt-scope P1 fixes, additive to /1):
 * - host_identity: the receipt is scoped to one host (platform/arch/node/cpu).
 * - installation + binary_identity: resolved executable path and file SHA-256 so
 *   "same tool" claims are pinned to an exact binary, not a bare name.
 * - extra_cases for SMT2 solvers: invalid-input (ERROR semantics) and a
 *   deliberately solver-hard UNKNOWN instance, so UNKNOWN/ERROR are visibly
 *   distinct from PASS. Expectations are recorded; neither yields an acceptance verdict.
 *
 * v1.2 privacy rules (receipts are published in a public repository):
 * - the local hostname is never recorded verbatim; host scoping relies on
 *   platform/release/arch/node/cpu, and the field is written as "REDACTED".
 * - local absolute paths in metadata (argv, tool dirs, executables, missing/
 *   diagnostics lists, error messages) are collapsed to their last 3 segments.
 * - stdout/stderr stay verbatim: they are hash-anchored evidence and must not be
 *   rewritten (their SHA-256 is computed over raw bytes).
 * - fail-closed: the receipt is only written when no absolute local path
 *   survives anywhere in the JSON; a leak aborts the run instead of publishing.
 */
const WIN_PATH=/(^|[^A-Za-z0-9.+-])([A-Za-z]:[\\/][^\s"'`]*)/g;
// Also cover Linux/WSL/macOS absolute paths; "https://" URLs do not match.
const POSIX_PATH=/(^|[^A-Za-z0-9_.\/-])\/(?!\/)[^\s"'`<>]+/g;

export function redactPath(p,keep=3){
  const original=String(p);
  const isAbsolute=/^[A-Za-z]:[\\/]/.test(original)||original.startsWith("/");
  if(!isAbsolute)return p;
  const parts=original.split(/[\\/]/).filter(Boolean);
  if(/^[A-Za-z]:$/.test(parts[0]??""))parts.shift();
  const sep=original.includes("\\")?"\\":"/";
  return "…"+sep+parts.slice(-keep).join(sep);
}
export function redactString(s){
  return String(s)
    .replace(WIN_PATH,(text,prefix)=>prefix+redactPath(text.slice(prefix.length)))
    .replace(POSIX_PATH,(text,prefix)=>prefix+redactPath(text.slice(prefix.length)));
}
const REDACTED_KEYS=new Set(["hostname"]);
const STRING_PATH_KEYS=new Set(["tool_bin_dir","executable","path","error","cwd"]);
const LIST_PATH_KEYS=new Set(["argv","missing","diagnostics"]);
function scrubNode(node,key){
  if(node===null||typeof node!=="object")return node;
  if(Array.isArray(node))return node.map(x=>scrubNode(x,key));
  const out={};
  for(const [k,v] of Object.entries(node)){
    if(REDACTED_KEYS.has(k)&&typeof v==="string")out[k]="REDACTED";
    else if(LIST_PATH_KEYS.has(k)&&Array.isArray(v))out[k]=v.map(x=>typeof x==="string"?redactString(x):scrubNode(x,k));
    else if(typeof v==="string")out[k]=STRING_PATH_KEYS.has(k)?redactString(v):v;
    else out[k]=scrubNode(v,k);
  }
  return out;
}
export function redactReceipt(summary){
  const safe=scrubNode(summary,null);
  const violations=[];
  (function scan(node,p=""){
    if(node===null||typeof node!=="object")return;
    for(const [k,v] of Object.entries(node)){
      if(typeof v==="string"&&(v.match(WIN_PATH)||v.match(POSIX_PATH)))violations.push(p?`${p}.${k}`:k);
      else scan(v,p?`${p}.${k}`:k);
    }
  })(safe);
  if(violations.length)throw new Error("receipt privacy invariant violated, absolute local path survived redaction: "+violations.join(", "));
  return safe;
}

// Inputs are generated at runtime (never committed as acceptance fixtures):
// - error_input: unterminated term -> parser ERROR path (must not look like a solver verdict)
// - unknown_scope: nonlinear transcendental constraint that SMT solvers do not decide
const EXTRA_INPUTS={
  error_input:{expectation:"ERROR/UNPARSED, never a sat/unsat verdict",text:"(assert (assert\n"},
  unknown_scope:{expectation:"tool_outcome UNKNOWN (solver scope limit), exit 0 or bounded timeout",text:"(declare-const x Real)\n(assert (> (sin x) 0.9))\n(check-sat)\n"}
};
const SMT2_SOLVERS=new Set(["z3","cvc5"]);
const sha=input=>createHash("sha256").update(input).digest("hex");
async function binaryIdentity(path){
  const info=await stat(path);
  return {path,sha256:sha(await readFile(path)),bytes:info.size,
    mtime:info.mtime.toISOString(),
    provenance:"binary inherited from local host; supply-chain audit NOT performed by this script"};
}
async function extraCases(tool){
  const dir=await mkdtemp(join(tmpdir(),"formal-accept-extra-"));
  try{
    const cases={};
    for(const [name,spec] of Object.entries(EXTRA_INPUTS)){
      const inputPath=join(dir,name+".smt2");
      await writeFile(inputPath,spec.text);
      const plan=planNative(tool,"solve",{input:inputPath});
      const execution=await executeNativePlan(plan,{cwd:dir,timeout:20});
      cases[name]={case:name,expectation:spec.expectation,input_sha256:sha(spec.text),
        input_text:spec.text,...execution};
    }
    return cases;
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function buildAcceptanceReceipt(tools,env=process.env){
  const records=[];
  for(const tool of tools){
    const version=await doctor(tool,20);
    const installation=await inspectInstallation(tool,{env,platform:process.platform});
    const binary_identity=installation.status==="FOUND_NOT_PROBED"&&installation.launcher==="binary"
      ?await binaryIdentity(installation.executable).catch(e=>({error:String(e)}))
      :null;
    const positive=await runFixture(tool,"positive",45);
    const negative=await runFixture(tool,"negative",45);
    const extra_cases=version.run_status==="EXECUTED"&&SMT2_SOLVERS.has(tool)
      ?await extraCases(tool):"NOT_RUN";
    records.push({tool,version,installation,binary_identity,positive,negative,extra_cases,
      acceptance:(positive.test_verdict==="PASS"&&negative.test_verdict==="PASS")?"CANDIDATE_FOR_REVIEW":"BLOCK_OR_REPAIR"});
  }
  return {
    schema:"formal-native-local-acceptance/1.2",written_at:new Date().toISOString(),
    host_identity:{hostname:os.hostname(),platform:process.platform,release:os.release(),
      arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model??"unknown",
      tool_bin_dir:env.FORMAL_TOOLS_BIN_DIR??"(unset; PATH search)"},
    tool_runtime:"ACTUAL_HOST_ATTEMPT",tool_count:records.length,
    candidate:records.filter(x=>x.acceptance==="CANDIDATE_FOR_REVIEW").length,
    blocked:records.filter(x=>x.acceptance!=="CANDIDATE_FOR_REVIEW").length,
    evidence:records,
    warning:"CANDIDATE_FOR_REVIEW requires exact SHA/version and independent CLI semantics review; this script does not claim project-level proof."
  };
}
export async function runNativeAcceptance({out,tools,env=process.env}){
  const receipt=await buildAcceptanceReceipt(tools,env);
  const safe=redactReceipt(receipt);
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,"native-acceptance.json"),JSON.stringify(safe,null,2)+"\n");
  process.stdout.write(JSON.stringify({output:resolve(out,"native-acceptance.json"),
    tool_count:safe.tool_count,candidate:safe.candidate,blocked:safe.blocked})+"\n");
  return {summary:safe,exitCode:safe.blocked?2:0};
}
async function main(){
  const chosen=process.argv.slice(3);
  if(chosen.some(x=>!knownTools().includes(x)))throw new TypeError("unknown tool in local acceptance list");
  const out=resolve(process.argv[2]||"validation/local-runtime-receipts");
  const {exitCode}=await runNativeAcceptance({out,tools:chosen.length?chosen:knownTools()});
  process.exitCode=exitCode;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
