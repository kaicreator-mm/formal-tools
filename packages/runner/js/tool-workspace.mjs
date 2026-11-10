/**
 * Trusted-host, tool-agnostic staging of explicit input files.
 *
 * This is NOT an OS sandbox or a validator for untrusted, concurrently mutable
 * source roots. Only the caller chooses models and how to run any tool.
 *
 * Does not invoke solvers, evaluate proofs, or interpret simulations.
 */
import {lstat,realpath,open,mkdtemp,mkdir,rm} from "node:fs/promises";
import {constants} from "node:fs";
import {resolve,join,relative,sep,isAbsolute,dirname} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";

const LIMITS={maxFiles:256,maxBytes:64*1024*1024,maxDepth:12};
const MAX={maxFiles:10000,maxBytes:1024*1024*1024,maxDepth:32};
const inside=(root,target)=>{
  const rel=relative(root,target);
  return rel===""||(!isAbsolute(rel)&&rel!==".."&&!rel.startsWith(".."+sep));
};
/** Pure path validation; no file system is opened. */
export function validateInputManifest(inputs,{maxFiles=LIMITS.maxFiles,maxDepth=LIMITS.maxDepth}={}){
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>maxFiles)
    throw new TypeError("inputs must be a nonempty bounded list");
  if(!Number.isSafeInteger(maxFiles)||maxFiles<1||maxFiles>MAX.maxFiles||
    !Number.isSafeInteger(maxDepth)||maxDepth<1||maxDepth>MAX.maxDepth)
    throw new RangeError("invalid input limits");
  const files=[];
  const found=new Set();
  const windowsFolded=new Set();
  for(const p of inputs){
    if(typeof p!=="string"||!p||p.includes("\0")||p.includes("\\")||
      p.startsWith("/")||p.includes(":")||
      p.split("/").some(s=>!s||s==="."||s===".."||
        /[\x00-\x1f<>"|?*]/.test(s)||/[. ]$/.test(s)||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(s)))
      throw new TypeError("invalid source-relative input path: "+String(p));
    const parts=p.split("/");
    if(parts.length>maxDepth)throw new RangeError("input path exceeds maxDepth");
    if(found.has(p)||windowsFolded.has(p.toLowerCase()))
      throw new TypeError("duplicate or case-colliding input path: "+p);
    found.add(p);
    windowsFolded.add(p.toLowerCase());
    files.push(p);
  }
  for(const p of files){
    const parts=p.split("/");
    for(let i=1;i<parts.length;i++)
      if(windowsFolded.has(parts.slice(0,i).join("/").toLowerCase()))
        throw new TypeError("input path conflicts with another file: "+p);
  }
  return files.sort();
}
function checkBudgets(opts){
  if(!opts||typeof opts!=="object"||Array.isArray(opts))
    throw new TypeError("options must be an object");
  const result={};
  for(const k of Object.keys(LIMITS)){
    const n=opts[k]??LIMITS[k];
    if(!Number.isSafeInteger(n)||n<1||n>MAX[k])
      throw new RangeError("invalid "+k);
    result[k]=n;
  }
  return result;
}
/**
 * Copy explicit regular source files into a newly owned temporary directory.
 * Directory and leaf symlinks are rejected and file bytes are hashed while
 * copied. Entire created directory is deleted if *any* staging step fails.
 */
export async function prepareToolWorkspace(sourceRoot,inputs,options={}){
  if(typeof sourceRoot!=="string"||!sourceRoot||sourceRoot.includes("\0"))
    throw new TypeError("sourceRoot must be a directory path");
  const caps=checkBudgets(options);
  const names=validateInputManifest(inputs,caps);
  const src=resolve(sourceRoot),rootStat=await lstat(src);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())
    throw new TypeError("source root must be a real directory");
  const canonicalSource=await realpath(src);
  const output=await mkdtemp(join(tmpdir(),"formal-tool-inputs-"));
  let total=0;
  const staged=[];
  try{
    for(const name of names){
      const parts=name.split("/");
      let at=src;
      for(let i=0;i<parts.length-1;i++){
        at=join(at,parts[i]);
        const dir=await lstat(at);
        if(!dir.isDirectory()||dir.isSymbolicLink())
          throw new TypeError("input directory must be real: "+name);
        if(!inside(canonicalSource,await realpath(at)))
          throw new TypeError("input directory escaped root: "+name);
      }
      const sourceFile=join(src,...parts);
      const info=await lstat(sourceFile);
      if(!info.isFile()||info.isSymbolicLink())
        throw new TypeError("input must be regular file: "+name);
      if(!inside(canonicalSource,await realpath(sourceFile)))
        throw new TypeError("input file escaped root: "+name);
      if(info.size>caps.maxBytes-total)
        throw new RangeError("input bytes exceed maxBytes");
      const destination=join(output,...parts);
      await mkdir(dirname(destination),{recursive:true});
      let inputHandle,outputHandle;
      try{
        inputHandle=await open(sourceFile,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
        const before=await inputHandle.stat();
        if(!before.isFile()||before.size!==info.size||
          before.ino!==info.ino||before.dev!==info.dev)
          throw new Error("source file changed while staging: "+name);
        outputHandle=await open(destination,"wx",0o600);
        const hash=createHash("sha256"),buffer=Buffer.allocUnsafe(65536);
        let offset=0;
        while(offset<before.size){
          const want=Math.min(buffer.length,before.size-offset);
          const {bytesRead}=await inputHandle.read(buffer,0,want,offset);
          if(!bytesRead)throw new Error("short source read: "+name);
          const chunk=buffer.subarray(0,bytesRead);
          hash.update(chunk);
          // A partial destination write is not a successful staging result.
          let written=0;
          while(written<bytesRead){
            const {bytesWritten}=await outputHandle.write(chunk,written,bytesRead-written,offset+written);
            if(!bytesWritten)throw new Error("short destination write: "+name);
            written+=bytesWritten;
          }
          offset+=bytesRead;
        }
        const after=await inputHandle.stat();
        if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||
           after.ino!==before.ino||after.dev!==before.dev)
          throw new Error("source changed during staging: "+name);
        total+=offset;
        staged.push({path:name,bytes:offset,sha256:hash.digest("hex")});
      }finally{
        await outputHandle?.close().catch(()=>{});
        await inputHandle?.close().catch(()=>{});
      }
    }
    return {
      schema:"formal-tools/staged-tool-workspace/1",
      root:output, // Trusted local runner needs this absolute path for execution.
      stagedInputs:staged,
      totalBytes:total,
      status:"READY_FOR_TRUSTED_HOST_EXECUTION",
      cleanup:async()=>{await rm(output,{recursive:true,force:true});}
    };
  }catch(error){
    await rm(output,{recursive:true,force:true});
    throw error;
  }
}
