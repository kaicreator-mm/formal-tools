/**
 * Issue #11 / G4 real store lifecycle driver — run on a POSIX host.
 *
 * Phases: persist, re-persist, inspect, drift, revoke, inspect-after-revoke,
 * no-resurrection — each recorded with a UTC timestamp into the JSON receipt.
 * Engineering receipt only: g4_reusable stays false. On hosts without
 * directory fsync (win32/NTFS) the store fails closed with zero writes and
 * this driver reports FAILED honestly instead of fabricating a lifecycle.
 *
 * usage: node benchmarks/llm-methods/g4/real-store-lifecycle.mjs <store-dir> <out-receipt.json>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { persistSolutionCandidate, inspectStoredReplay, revokeStoredCandidate }
  from "../../../packages/runner/js/solution-store.mjs";
import { buildRealLifecycleCandidate, FIXTURE_SHA256, NAT_PAIR_SHA256,
  ORACLE_CONTENT_SHA256, FAITHFUL_MODEL_SHA256 } from "./real-provenance.mjs";

const sha=/^[a-f0-9]{64}$/;
const sha256=x=>createHash("sha256").update(x).digest("hex");
const tryParse=t=>{try{return JSON.parse(t);}catch{return null;}};

export const phaseLog=[];
/** Record one phase outcome; throw naming the phase when the expectation misses. */
export function expectPhase(phase,actual,predicate){
  let ok=false;
  try{ok=predicate(actual)===true;}catch{ok=false;}
  const entry={phase,at:new Date().toISOString(),ok,actual};
  phaseLog.push(entry);
  if(!ok)throw new Error("expectPhase "+phase+" failed");
  return entry;
}

async function run(store_dir,out_receipt){
  const started_at=new Date().toISOString();
  let candidate_sha256=null,run_status="PASSED_ENGINEERING_ONLY",failure=null;
  try{
    const {problem_json,method_json,provenance_json,provenance,candidate}=buildRealLifecycleCandidate();
    candidate_sha256=candidate.candidate_sha256;
    const storedPath=resolve(store_dir,"candidate-"+candidate_sha256+".json");
    const request=()=>({store_dir,candidate_sha256,current_provenance_json:provenance_json});

    const persisted=await persistSolutionCandidate({store_dir,problem_json,method_json,provenance_json});
    const bytes=await readFile(storedPath).catch(()=>null);
    expectPhase("persist",{response:persisted,
        stored_file_sha256:bytes?sha256(bytes):null,
        stored_candidate_sha256:bytes?(tryParse(bytes.toString("utf8"))?.candidate_sha256??null):null},
      x=>x.response.status==="CANDIDATE_PERSISTED"&&x.response.record_write==="NEW"&&
        x.stored_candidate_sha256===candidate_sha256&&sha.test(x.stored_file_sha256??""));

    expectPhase("re-persist",
      await persistSolutionCandidate({store_dir,problem_json,method_json,provenance_json}),
      x=>x.status==="CANDIDATE_PERSISTED"&&x.record_write==="EXISTING");

    expectPhase("inspect",await inspectStoredReplay(request()),
      x=>x.status==="REPLAY_BLOCKED_UNQUALIFIED"&&x.replay_allowed===false&&
        x.solution_promotable===false);

    const drifted=JSON.stringify({...provenance,tool_version:"5.4.1"});
    expectPhase("drift",
      await inspectStoredReplay({store_dir,candidate_sha256,current_provenance_json:drifted}),
      x=>x.status==="STALE"&&Array.isArray(x.changed_fields)&&x.changed_fields.includes("tool_version"));

    expectPhase("revoke",
      await revokeStoredCandidate({store_dir,candidate_sha256,reason:"OPERATOR_REVOKED"}),
      x=>x.status==="INVALIDATED");

    expectPhase("inspect-after-revoke",await inspectStoredReplay(request()),
      x=>x.status==="INVALIDATED");

    expectPhase("no-resurrection",
      await persistSolutionCandidate({store_dir,problem_json,method_json,provenance_json}),
      x=>x.status==="INVALIDATED");
  }catch(err){run_status="FAILED";failure=String(err?.message??err);}
  const receipt={
    schema:"formal-tools/g4-real-store-lifecycle/0.1",issue:11,
    driver:"benchmarks/llm-methods/g4/real-store-lifecycle.mjs",
    started_at,finished_at:new Date().toISOString(),
    node:process.version,platform:process.platform+"/"+process.arch,
    store_dir:basename(store_dir),candidate_sha256,
    fixture_sha256:FIXTURE_SHA256,nat_pair_sha256:NAT_PAIR_SHA256,
    oracle_content_sha256:ORACLE_CONTENT_SHA256,model_sha256:FAITHFUL_MODEL_SHA256,
    g4_reusable:false,claim_result:"UNVERIFIED",
    phases:phaseLog.slice(),run_status,...(failure?{failure}:{})
  };
  await mkdir(dirname(out_receipt),{recursive:true});
  await writeFile(out_receipt,JSON.stringify(receipt,null,2)+"\n","utf8");
  return run_status==="PASSED_ENGINEERING_ONLY"?0:1;
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(invoked){
  const [store_dir,out_receipt]=process.argv.slice(2);
  if(!store_dir||!out_receipt){
    console.error("usage: node benchmarks/llm-methods/g4/real-store-lifecycle.mjs <store-dir> <out-receipt.json>");
    process.exitCode=2;
  }else{
    try{process.exitCode=await run(resolve(store_dir),resolve(out_receipt));}
    catch(err){console.error("driver failed before receipt: "+String(err?.message??err));process.exitCode=1;}
  }
}
