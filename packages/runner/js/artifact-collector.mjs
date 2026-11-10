/**
 * Generic, read-only artifact inventory for a trusted, private tool workspace.
 *
 * This module is intentionally NOT coupled to any solver, simulation scenario,
 * user project, MCP executor, or formal proof verdict.
 *
 * Caller responsibilities:
 *  - create and own a private work directory;
 *  - snapshot it BEFORE invoking the upstream tool;
 *  - keep it alive until artifact inventory is finished;
 *  - enforce process isolation and resource budgets separately.
 *
 * Neither this scanner nor a hashed manifest constitutes an OS sandbox.
 */
import { readdir, lstat, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute, sep, join } from "node:path";

const HASH=/^[a-f0-9]{64}$/;
const DEFAULTS=Object.freeze({maxFiles:256,maxBytes:16*1024*1024,maxDepth:8});
const MAX=Object.freeze({maxFiles:10000,maxBytes:256*1024*1024,maxDepth:32});
const sortByPath=(a,b)=>a.path<b.path?-1:a.path>b.path?1:0;
const inside=(root,pathname)=>{
  const rel=relative(root,pathname);
  return rel===""||(!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep));
};
function validatePath(p){
  if(typeof p!=="string"||!p||p.includes("\0")||p.includes("\\")||
    p.startsWith("/")||p.includes(":")||
    p.split("/").some(part=>!part||part==="."||part===".."||
      /[\x00-\x1f<>"|?*]/.test(part)||/[. ]$/.test(part)||
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part)))
    throw new TypeError("invalid workspace-relative artifact path");
  return p;
}
function validateEntries(entries,field){
  if(!Array.isArray(entries))throw new TypeError(field+" must be an array");
  const seen=new Set();
  for(const v of entries){
    if(!v||typeof v!=="object")throw new TypeError("invalid artifact entry");
    validatePath(v.path);
    if(seen.has(v.path))throw new TypeError("duplicate artifact path: "+v.path);
    seen.add(v.path);
    if(!Number.isSafeInteger(v.bytes)||v.bytes<0||!HASH.test(v.sha256))
      throw new TypeError("invalid artifact digest: "+v.path);
  }
}
/**
 * Pure diff over SHA-256 inventories. A modified input is an output; an
 * unchanged input is not. This does NOT interpret what an artifact means.
 */
export function artifactDelta(baseline,after){
  const before=Array.isArray(baseline)?{status:"COMPLETE",files:baseline}:baseline;
  const newer=Array.isArray(after)?{status:"COMPLETE",files:after,skipped:[]}:after;
  if(!before||before.status!=="COMPLETE")
    throw new TypeError("baseline must be a complete workspace snapshot");
  if(!newer||!["COMPLETE","PARTIAL"].includes(newer.status))
    throw new TypeError("invalid post-run artifact inventory");
  validateEntries(before.files,"baseline.files");
  validateEntries(newer.files,"after.files");
  /** @type {Map<string,string>} */
  const previous=new Map();
  for(const entry of before.files)previous.set(entry.path,entry.sha256);
  const addedOrModified=newer.files.filter(e=>previous.get(e.path)!==e.sha256)
    .map(e=>({path:e.path,bytes:e.bytes,sha256:e.sha256}))
    .sort(sortByPath);
  return {
    schema:"formal-tools/generated-artifacts/1",
    status:newer.status,
    items:addedOrModified,
    unchanged:newer.files.length-addedOrModified.length,
    skipped:[...(newer.skipped??[])],
    scannedFiles:newer.scannedFiles??newer.files.length,
    hashedBytes:newer.hashedBytes??newer.files.reduce((sum,e)=>sum+e.bytes,0)
  };
}
function limits(options){
  if(options===null||typeof options!=="object"||Array.isArray(options))
    throw new TypeError("scan options must be a plain object");
  const result={};
  for(const [key,defaultValue] of Object.entries(DEFAULTS)){
    const value=options[key]??defaultValue;
    if(!Number.isSafeInteger(value)||value<1||value>MAX[key])
      throw new RangeError("invalid "+key);
    result[key]=value;
  }
  return result;
}
/**
 * Enumerate regular files under the requested workspace. No symlinks or
 * nonregular files are opened. Files are streamed and never emitted inline.
 * Limit exhaustion and unreadable/changed files produce PARTIAL, never PASS.
 */
export async function scanArtifactWorkspace(workspace,options={}){
  if(typeof workspace!=="string"||!workspace||workspace.includes("\0"))
    throw new TypeError("a workspace directory is required");
  const cap=limits(options),root=resolve(workspace);
  const rootInfo=await lstat(root);
  if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())
    throw new TypeError("workspace root must be a real directory");
  const canonicalRoot=await realpath(root);
  const files=[],skipped=[];
  let scannedFiles=0,hashedBytes=0;
  const skip=(p,reason)=>skipped.push({path:p,reason});
  async function visit(directory,parts,depth){
    const abs=await realpath(directory).catch(()=>null);
    if(abs===null||!inside(canonicalRoot,abs)){
      skip(parts.join("/")||".","DIRECTORY_OUTSIDE_WORKSPACE");return;
    }
    let entries;
    try{entries=await readdir(directory,{withFileTypes:true});}
    catch{skip(parts.join("/")||".","UNREADABLE_DIRECTORY");return;}
    entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    for(const entry of entries){
      const relParts=[...parts,entry.name];
      const relativeName=relParts.join("/");
      const target=join(directory,entry.name);
      if(!entry.name||entry.name==="."||entry.name===".."||
        entry.name.includes("/")||entry.name.includes("\\")||entry.name.includes("\0")){
        skip(relativeName,"INVALID_NAME");continue;
      }
      let meta;
      try{meta=await lstat(target);}catch{skip(relativeName,"UNREADABLE_ENTRY");continue;}
      if(meta.isSymbolicLink()){skip(relativeName,"SYMLINK_SKIPPED");continue;}
      if(meta.isDirectory()){
        if(depth>=cap.maxDepth){skip(relativeName,"DEPTH_LIMIT");continue;}
        await visit(target,relParts,depth+1);
        continue;
      }
      if(!meta.isFile()){skip(relativeName,"NON_REGULAR_ENTRY");continue;}
      scannedFiles++;
      if(scannedFiles>cap.maxFiles){skip(relativeName,"FILE_COUNT_LIMIT");continue;}
      if(meta.size>cap.maxBytes-hashedBytes){skip(relativeName,"BYTE_LIMIT");continue;}
      const canonicalFile=await realpath(target).catch(()=>null);
      if(canonicalFile===null||!inside(canonicalRoot,canonicalFile)){
        skip(relativeName,"FILE_OUTSIDE_WORKSPACE");continue;
      }
      let handle;
      try{
        handle=await open(target,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
        const verified=await handle.stat();
        if(!verified.isFile()||verified.size!==meta.size){
          skip(relativeName,"FILE_CHANGED_DURING_SCAN");continue;
        }
        const hash=createHash("sha256"),buf=Buffer.allocUnsafe(65536);
        let pos=0;
        while(pos<verified.size){
          const n=Math.min(buf.length,verified.size-pos);
          const readResult=await handle.read(buf,0,n,pos);
          if(!readResult.bytesRead)throw new Error("short read");
          hash.update(buf.subarray(0,readResult.bytesRead));
          pos+=readResult.bytesRead;
        }
        const finalStat=await handle.stat();
        if(finalStat.size!==verified.size||finalStat.mtimeMs!==verified.mtimeMs){
          skip(relativeName,"FILE_CHANGED_DURING_SCAN");continue;
        }
        files.push({path:relativeName,bytes:verified.size,sha256:hash.digest("hex")});
        hashedBytes+=verified.size;
      }catch{
        skip(relativeName,"UNREADABLE_OR_CHANGED_FILE");
      }finally{await handle?.close().catch(()=>{});}
    }
  }
  await visit(root,[],0);
  files.sort(sortByPath);
  return {schema:"formal-tools/workspace-artifact-scan/1",
    status:skipped.length?"PARTIAL":"COMPLETE",
    files,skipped,scannedFiles,hashedBytes,limits:cap};
}
/** No subprocess is launched and no workspace files are changed. */
export async function collectGeneratedArtifacts(workspace,baseline,options={}){
  return artifactDelta(baseline,await scanArtifactWorkspace(workspace,options));
}
