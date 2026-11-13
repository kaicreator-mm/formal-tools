/**
 * Issue #11 G5 HARD_R1: on one real owner-provisioned POSIX host, collect
 * 20 source-frozen faithful QF_LIA observations via the ORIGINAL typed native
 * runner. No second runtime and no fake native solver evidence.
 *
 * CLI only (one call/process to avoid process-global FORMAL_TOOLS_BIN_DIR
 * races). The binary SHA must match historical G3 NATIVE_PAIR.json.
 * Output is a self-reported host receipt; NOT a domain Oracle or Product PASS.
 */
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,realpathSync,statSync} from "node:fs";
import {tmpdir,platform,arch,release} from "node:os";
import {join,resolve,basename} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {planNative} from "../../../packages/runner/js/native-catalog.mjs";
import {doctor,executeNativePlan} from "../../../packages/runner/js/native.mjs";
import {classifyAdsNativeObservation} from "../g3/ads-native-replay.mjs";
import {buildHardNativeWorklist} from "./hard-oracle.mjs";

const sha=x=>createHash("sha256").update(x).digest("hex");
const PIN=new URL("../../../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url);
function preflight(tool,binary_dir){
 if(!["z3","cvc5"].includes(tool)||typeof binary_dir!=="string"||!binary_dir)
   throw Error("only pinned z3/cvc5 binary directory is permitted");
 const pins=JSON.parse(readFileSync(PIN,"utf8"));
 if(pins.schema!=="formal-tools/ads24-native-pair/0.1")throw Error("invalid G3 native provenance");
 const sol=pins.solvers.find(s=>s.id===tool);
 if(!sol||!/^([a-f0-9]{64})$/.test(sol.executable_sha256))throw Error("G3 binary SHA not pinned");
 const dir=realpathSync(resolve(binary_dir)),exe=realpathSync(join(dir,tool));
 if(basename(exe)!==tool||!statSync(exe).isFile()||
    statSync(exe).size<=0||statSync(exe).size>160*1024*1024)
    throw Error("invalid pinned executable type");
 const bytes=readFileSync(exe);
 if(sha(bytes)!==sol.executable_sha256)throw Error("binary digest does not match original G3 pin");
 return {dir,exe,pin:sol,archive:sha(readFileSync(PIN))};
}

/** Explicit one-process CLI executor; limited to pinned original G3 identity.
 * @param {{tool?:string,binary_dir?:string,output_dir?:string,timeout_s?:number}} input
 */
export async function executeHardNative(input){
 const {tool,binary_dir,output_dir,timeout_s=10}=input||{};
 if(typeof output_dir!=="string"||!output_dir||
    !Number.isSafeInteger(timeout_s)||timeout_s<1||timeout_s>60)
   throw Error("output dir and bounded timeout required");
 // Allow Windows to inspect/report the plan in tests, but no POSIX-native claim
 // is established without an actual Linux host and original native execution.
 const verified=preflight(tool,binary_dir);
 const list=buildHardNativeWorklist();
 const dir=mkdtempSync(join(tmpdir(),"formal-g5-hard-"));
 const previous=process.env.FORMAL_TOOLS_BIN_DIR;
 const receipts=[];
 let probe;
 try{
   process.env.FORMAL_TOOLS_BIN_DIR=verified.dir;
   probe=await doctor(tool,Math.min(timeout_s,10));
   for(const row of list.entries){
     const file=join(dir,row.id+".smt2");
     if(sha(row.smt2)!==row.input_sha256)throw Error("generated hard query drift");
     writeFileSync(file,row.smt2,{mode:0o600});
     let result;
     try{result=await executeNativePlan(planNative(tool,"solve",{input:file}),
       {cwd:dir,timeout:timeout_s});}
     catch(err){throw Error("typed native execution failed for "+row.id+": "+String(err));}
     const status=classifyAdsNativeObservation(result);
     const proc=result.executions?.[0];
     receipts.push({id:row.id,case_id:row.case_id,
       case_sha256:row.case_sha256,input_sha256:row.input_sha256,
       status,exit_code:Number.isSafeInteger(proc?.exit_code)?proc.exit_code:null,
       stdout_sha256:proc?.stdout_sha256??null,
       stderr_sha256:proc?.stderr_sha256??null,
       elapsed_ms:Number.isSafeInteger(proc?.elapsed_ms)?proc.elapsed_ms:null,
       timed_out:proc?.timed_out===true,output_truncated:proc?.output_truncated===true});
   }
 }finally{
   if(previous===undefined)delete process.env.FORMAL_TOOLS_BIN_DIR;
   else process.env.FORMAL_TOOLS_BIN_DIR=previous;
   rmSync(dir,{recursive:true,force:true});
 }
 if(sha(readFileSync(verified.exe))!==verified.pin.executable_sha256)
   throw Error("binary changed after hard-r1 native run");
 const allDecisive=receipts.length===20&&receipts.every(o=>
   (o.status==="SAT"||o.status==="UNSAT")&&o.exit_code===0&&!o.timed_out&&!o.output_truncated);
 const report={
   schema:"formal-tools/hard-native-observations/0.1",
   suite:"HARD_R1",source_sha256:list.source_sha256,
   model_id:"faithful",tool_id:tool,tool_version:verified.pin.version,
   tool_binary_sha256:verified.pin.executable_sha256,
   original_g3_pair_sha256:verified.archive,
   generated_input_count:list.entries.length,observed_count:receipts.length,
   host:{platform:platform(),arch:arch(),release:release(),node:process.version,
     uid:typeof process.getuid==="function"?process.getuid():null},
   version_probe:{status:probe?.run_status??"NOT_RUN",
     output_sha256:probe?.stdout_sha256??null},
   observations:receipts,
   status:allDecisive?"NATIVE_SELF_REPORTED_COMPLETE":"INCONCLUSIVE",
   independent_host_attestation:false,
   independent_semantic_oracle:false,
   original_claim_result:"UNVERIFIED",g5_accepted:false
 };
 mkdirSync(resolve(output_dir),{recursive:true});
 const target=join(resolve(output_dir),"hard-"+tool+"-observations.json");
 writeFileSync(target,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
 return {file:target,sha256:sha(readFileSync(target)),status:report.status,
   observed:receipts.length,semantic_oracle:"NOT_QUALIFIED"};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==6)throw Error("usage: node hard-native-run.mjs z3|cvc5 BINARY_DIR OUTPUT_DIR TIMEOUT_SECONDS");
 const seconds=Number(process.argv[5]);
 const result=await executeHardNative({tool:process.argv[2],
   binary_dir:process.argv[3],output_dir:process.argv[4],timeout_s:seconds});
 process.stdout.write(JSON.stringify(result)+"\n");
 if(result.status!=="NATIVE_SELF_REPORTED_COMPLETE")process.exitCode=2;
}
