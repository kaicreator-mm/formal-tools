/**
 * Issue #11 / G6 real consumption/invalidation propagation driver — POSIX host.
 *
 * A real-bound candidate is persisted, offered to the pinned DIS v0.2.0
 * consumer preflight (which must refuse with the no-authority envelope), then
 * revoked; the store-level INVALIDATED is re-inspected BEFORE the consumer is
 * re-offered the same bytes, proving the refusal happens before any dispatch.
 * g6_accepted stays false; no Host invocation exists on this path.
 *
 * usage: node benchmarks/llm-methods/g6/real-consume-propagation.mjs <store-dir> <out-receipt.json>
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { persistSolutionCandidate, inspectStoredReplay, revokeStoredCandidate }
  from "../../../packages/runner/js/solution-store.mjs";
import { inspectDisV020Consumption, DIS_V020_REFERENCE }
  from "../../../packages/runner/js/dis-v020-consumer-preflight.mjs";
import { buildRealLifecycleCandidate, FIXTURE_SHA256, NAT_PAIR_SHA256,
  ORACLE_CONTENT_SHA256, FAITHFUL_MODEL_SHA256 } from "../g4/real-provenance.mjs";
import { expectPhase, phaseLog } from "../g4/real-store-lifecycle.mjs";

const noAuthority=x=>x.status==="REPLAY_BLOCKED_UNQUALIFIED"&&x.kind==="UNKNOWN"&&
  x.authority==="NONE"&&x.effect_dispatched===false&&x.host_invocations===0&&
  x.g6_accepted===false;
const envelopesOf=(x,out=[])=>{
  if(Array.isArray(x)){for(const v of x)envelopesOf(v,out);return out;}
  if(x&&typeof x==="object"){
    if(x.schema==="formal-tools/dis-v020-preflight/0.1")out.push(x);
    for(const v of Object.values(x))envelopesOf(v,out);
  }
  return out;
};

async function run(store_dir,out_receipt){
  const started_at=new Date().toISOString();
  let candidate_sha256=null,run_status="PASSED_ENGINEERING_ONLY",failure=null,host_context;
  try{
    const logSha=process.env.DIS_REAL_RUN_LOG_SHA256;
    if(logSha!==undefined){
      if(!/^[a-f0-9]{64}$/.test(logSha))throw new Error("DIS_REAL_RUN_LOG_SHA256 must be 64-hex");
      host_context={bounded_demo_log_sha256:logSha,bounded_demo_target:"linux/x64/node",
        source_head:DIS_V020_REFERENCE.source_head,example_blob:DIS_V020_REFERENCE.example_blob,
        kdp_receipt:"engineering-only KDP_RECEIPT authority=KDP admitted, effectExecutionProven=false"};
    }
    const {problem_json,method_json,provenance_json,candidate}=buildRealLifecycleCandidate();
    candidate_sha256=candidate.candidate_sha256;
    const candidate_json=JSON.stringify(candidate);
    const consume=()=>inspectDisV020Consumption({candidate_json,
      current_provenance_json:provenance_json,target_head:DIS_V020_REFERENCE.source_head});

    expectPhase("seal+persist",
      await persistSolutionCandidate({store_dir,problem_json,method_json,provenance_json}),
      x=>x.status==="CANDIDATE_PERSISTED"&&(x.record_write==="NEW"||x.record_write==="EXISTING"));

    expectPhase("consumer-preflight-pre-revoke",consume(),noAuthority);

    expectPhase("revoke",
      await revokeStoredCandidate({store_dir,candidate_sha256,reason:"OPERATOR_REVOKED"}),
      x=>x.status==="INVALIDATED");

    // The store tombstone must be visible to the consumer path BEFORE any
    // dispatch could occur; the envelope must refuse again on the same bytes.
    const store_inspect=await inspectStoredReplay({store_dir,candidate_sha256,
      current_provenance_json:provenance_json});
    expectPhase("consumer-reinspect-post-revoke",
      {store_inspect,consumer_envelope:consume()},
      x=>x.store_inspect.status==="INVALIDATED"&&noAuthority(x.consumer_envelope));

    const envelopes=phaseLog.flatMap(p=>envelopesOf(p.actual));
    if(envelopes.length===0)throw new Error("no consumer envelope recorded");
    if(envelopes.some(e=>e.host_invocations!==0||e.effect_dispatched!==false))
      throw new Error("consumer envelope dispatched an effect or invoked a host");
  }catch(err){run_status="FAILED";failure=String(err?.message??err);}
  const receipt={
    schema:"formal-tools/g6-real-consume-propagation/0.1",issue:11,
    driver:"benchmarks/llm-methods/g6/real-consume-propagation.mjs",
    started_at,finished_at:new Date().toISOString(),
    node:process.version,platform:process.platform+"/"+process.arch,
    store_dir:basename(store_dir),candidate_sha256,
    fixture_sha256:FIXTURE_SHA256,nat_pair_sha256:NAT_PAIR_SHA256,
    oracle_content_sha256:ORACLE_CONTENT_SHA256,model_sha256:FAITHFUL_MODEL_SHA256,
    dis_reference:DIS_V020_REFERENCE,...(host_context?{real_dis_host_context:host_context}:{}),
    g6_accepted:false,claim_result:"UNVERIFIED",
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
    console.error("usage: node benchmarks/llm-methods/g6/real-consume-propagation.mjs <store-dir> <out-receipt.json>");
    process.exitCode=2;
  }else{
    try{process.exitCode=await run(resolve(store_dir),resolve(out_receipt));}
    catch(err){console.error("driver failed before receipt: "+String(err?.message??err));process.exitCode=1;}
  }
}
