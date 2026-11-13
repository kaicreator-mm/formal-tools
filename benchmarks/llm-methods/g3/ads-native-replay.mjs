/**
 * Issue #11 / G3: execute source-frozen ADS 24 SMT inputs through the existing
 * typed Native Runner, then score observed statuses against frozen fixtures.
 *
 * Never a trusted host/process attestation, independent semantic Oracle or
 * authorization to promote a Solution. Local-only; not an MCP endpoint.
 */
import { readFileSync, realpathSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, platform, arch, release } from "node:os";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { planNative } from "../../../packages/runner/js/native-catalog.mjs";
import { executeNativePlan, doctor } from "../../../packages/runner/js/native.mjs";
import { generateAdsMatrix, scoreAdsMatrix } from "./ads-native-matrix.mjs";

const digest=x=>createHash("sha256").update(x).digest("hex");
const isSha=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const MAX_BINARY=160*1024*1024;
const WHOLE_STATUS=/^(sat|unsat|unknown)\r?\n?$/i;

/** @param {any} observation - one actual executor receipt, or a synthetic negative fixture. */
export function classifyAdsNativeObservation(observation) {
  const step=observation?.executions?.[0];
  if(observation?.run_status!=="EXECUTED"||!step)return "NOT_RUN";
  if(step.timed_out||observation.process_outcome==="TIMEOUT")return "TIMEOUT";
  if(step.error||step.output_truncated||step.exit_code!==0||observation.process_outcome!=="EXIT_ZERO")
    return "ERROR";
  // Native parser's last-token heuristic is deliberately NOT sufficient for
  // a G3 evidence decision. No extra output, multiple conflicting answers,
  // or "sat" printed on stderr can turn into SAT.
  if(typeof step.stdout!=="string"||typeof step.stderr!=="string"||
     step.stderr.trim().length!==0)return "ERROR";
  const match=step.stdout.match(WHOLE_STATUS);
  return match ? match[1].toUpperCase() : "ERROR";
}

/**
 * @param {{tool:"z3"|"cvc5",binary_dir:string,expected_binary_sha256:string,
 *     output_dir:string,timeout_s?:number}} args
 */
export async function executeAds24(args) {
  if(!args||!["z3","cvc5"].includes(args.tool)||!isSha(args.expected_binary_sha256)||
     typeof args.binary_dir!=="string"||!args.binary_dir||
     typeof args.output_dir!=="string"||!args.output_dir||
     !Number.isSafeInteger(args.timeout_s??10)||(args.timeout_s??10)<1||
     (args.timeout_s??10)>120)
    throw new TypeError("explicit tool, binary-dir, expected SHA, output-dir and bounded timeout required");
  // Do not accept caller-supplied scripts or arbitrary executable names.
  const dir=realpathSync(resolve(args.binary_dir));
  const exe=realpathSync(join(dir,args.tool));
  if(basename(exe)!==args.tool)throw new Error("native binary must be the exact catalog executable");
  const st=statSync(exe);
  if(!st.isFile()||st.size<=0||st.size>MAX_BINARY)throw new Error("invalid native binary size/type");
  const binarySha=digest(readFileSync(exe));
  if(binarySha!==args.expected_binary_sha256)throw new Error("native binary SHA mismatch");
  const matrix=generateAdsMatrix();
  if(matrix.entries.length!==24)throw new Error("source-frozen ADS case count drift");
  const sandbox=mkdtempSync(join(tmpdir(),"ft-ads24-"));
  const old=process.env.FORMAL_TOOLS_BIN_DIR;
  const outcomes=Object.create(null),receipts=[];
  let before,after,probe;
  try {
    process.env.FORMAL_TOOLS_BIN_DIR=dir;
    probe=await doctor(args.tool,Math.min(10,args.timeout_s??10));
    for(const entry of matrix.entries){
      const input=join(sandbox,entry.id+".smt2");
      // Only the deterministic frozen generator can author this input.
      if(digest(entry.smt2)!==entry.input_sha256)throw new Error("matrix input SHA drift");
      writeFileSync(input,entry.smt2,{mode:0o600});
      const plan=planNative(args.tool,"solve",{input});
      const result=await executeNativePlan(plan,{cwd:sandbox,timeout:args.timeout_s??10});
      const status=classifyAdsNativeObservation(result);
      outcomes[entry.id]=status;
      const step=result.executions?.[0];
      receipts.push({id:entry.id,case_id:entry.case_id,model_id:entry.model_id,
        input_sha256:entry.input_sha256,tool:args.tool,operation:"solve",
        status,exit_code:Number.isSafeInteger(step?.exit_code)?step.exit_code:null,
        timed_out:step?.timed_out===true,output_truncated:step?.output_truncated===true,
        elapsed_ms:Number.isSafeInteger(step?.elapsed_ms)?step.elapsed_ms:null,
        stdout_sha256:step?.stdout_sha256??null,stderr_sha256:step?.stderr_sha256??null,
        stdout_text:typeof step?.stdout==="string"?step.stdout:null,
        stderr_text:typeof step?.stderr==="string"?step.stderr:null});
    }
  } finally {
    if(old===undefined)delete process.env.FORMAL_TOOLS_BIN_DIR;
    else process.env.FORMAL_TOOLS_BIN_DIR=old;
    rmSync(sandbox,{recursive:true,force:true});
  }
  // Verify on-disk executable did not change while executing. This is a
  // host-self-reported identity check, NOT process image / supply-chain proof.
  after=digest(readFileSync(exe));
  if(after!==binarySha)throw new Error("native binary changed during ADS24 run");
  const scored=scoreAdsMatrix(matrix,outcomes);
  const document={
    schema:"formal-tools/ads24-native-self-reported/0.1",
    source_case_sha256:matrix.source_case_sha256,
    matrix_generator_sha256:digest(readFileSync(new URL("./ads-native-matrix.mjs",import.meta.url))),
    native_runner_sha256:digest(readFileSync(new URL("../../../packages/runner/js/native.mjs",import.meta.url))),
    tool:args.tool,tool_binary_sha256:binarySha,
    version_probe:{run_status:probe?.run_status??"NOT_RUN",
      stdout_sha256:probe?.stdout_sha256??null,stderr_sha256:probe?.stderr_sha256??null,
      output:probe?.stdout?.slice(0,250)??null},
    host:{platform:platform(),arch:arch(),release:release(),node:process.version},
    receipts,scored,original_claim_verdict:"UNVERIFIED",
    host_process_attested:false,independent_oracle_review:"NOT_RUN",
    solution_promotable:false
  };
  const output=resolve(args.output_dir);
  mkdirSync(output,{recursive:true});
  const receiptFile=join(output,"ads24-native-"+args.tool+".json");
  writeFileSync(receiptFile,JSON.stringify(document,null,2)+"\n",{flag:"w",mode:0o600});
  return {file:receiptFile,sha256:digest(readFileSync(receiptFile)),
    observed:receipts.filter(x=>["SAT","UNSAT"].includes(x.status)).length,
    summary:scored.summaries,claim_verdict:"UNVERIFIED",
    host_process_attested:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==6)
    throw new Error("Usage: node ads-native-replay.mjs z3|cvc5 BINARY_DIR EXPECTED_BINARY_SHA256 OUTPUT_DIR");
  const result=await executeAds24({tool:process.argv[2],binary_dir:process.argv[3],
    expected_binary_sha256:process.argv[4],output_dir:process.argv[5]});
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
