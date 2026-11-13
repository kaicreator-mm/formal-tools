/**
 * #11 G6: actual cross-repository Domain App Business Function invocation.
 *
 * The real source is an exact Git-blob-pinned snapshot from Tally v2.
 * NOT a DIS AOT/SDK/Host execution, business Claim admission or qualified
 * replay. The only authority here is a bounded ENGINEERING observation:
 * unqualified/stale/revoked G4 candidates cannot be upgraded by a Domain App.
 */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {buildRealLifecycleCandidate,FAITHFUL_OBSERVATIONS} from "../g4/real-provenance.mjs";
import {persistSolutionCandidate,inspectStoredReplay,revokeStoredCandidate}
  from "../../../packages/runner/js/solution-store.mjs";
import {inspectDisV020Consumption,DIS_V020_REFERENCE}
  from "../../../packages/runner/js/dis-v020-consumer-preflight.mjs";

const SNAPSHOT=new URL("./snapshots/tally-business.mjs",import.meta.url);
const SHA=/^[a-f0-9]{40}$/;
const gitBlob=bytes=>createHash("sha1").update(Buffer.concat([
  Buffer.from("blob "+bytes.length+"\0"),bytes])).digest("hex");
export const G6_TALLY_SOURCE=Object.freeze({
  repository:"kaicreator-mm/tally",
  commit:"e988321439f65b55936a691c02250b6d62a29409",
  path:"packages/tally-engineering-business/src/index.mjs",
  git_blob:"54015fb63ffb13b4f4e562f660d2172098b5f7f4",
  original_dis_consumer:"kaicreator-mm/domain-harness",
  original_dis_consumer_manifest_blob:"39e14468723c4211d1e55d6a7c3aa1a16204c5a8",
  business_function:"assessTaskEvidence"
});
function assert(condition,message){if(!condition)throw Error(message);}
const denied=x=>x&&x.admitted===false&&x.taskPass===false&&
  (x.state==="UNQUALIFIED_INPUT"||x.state==="OBSERVED_INPUT_ONLY");

/**
 * Execute only bytes that match the original immutable Tally Git Blob.
 * The content-derived ESM URL cannot reopen an attacker-replaced path or
 * resolve a cached, different module under the same filesystem URL.
 * Exported for deterministic adversarial tests; it accepts NO caller pin.
 * @param {Buffer} bytes
 */
export async function loadPinnedTallyBusinessFromBytes(bytes){
 assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=131072,
   "unbounded business source");
 assert(gitBlob(bytes)===G6_TALLY_SOURCE.git_blob,"TALLY_BUSINESS_SOURCE_DRIFT");
 const module=await import("data:text/javascript;base64,"+bytes.toString("base64"));
 assert(typeof module.assessTaskEvidence==="function","TALLY_BUSINESS_EXPORT_MISSING");
 return {invoke:module.assessTaskEvidence,blob:G6_TALLY_SOURCE.git_blob,
   source_sha256:createHash("sha256").update(bytes).digest("hex")};
}

/** Read only the pinned Tally source; the import consumes the verified bytes. */
export async function loadPinnedTallyBusiness(){
 return loadPinnedTallyBusinessFromBytes(readFileSync(SNAPSHOT));
}

/**
 * Real Tally Business Function called across four evidence states.
 * No false Claim authority or professional Oracle is manufactured.
 * The owner-provisioned directory is expected to be fresh, absolute and
 * supported by POSIX directory fsync; candidate-store validates it.
 * @param {{store_dir?:string,formal_head?:string,consumer_execution_head?:string|null}} [args]
 */
export async function runRealTallyBusinessConsumption({store_dir,formal_head,consumer_execution_head=null}={}){
 assert(typeof store_dir==="string"&&store_dir.startsWith("/")&&
   typeof formal_head==="string"&&SHA.test(formal_head),
   "explicit POSIX store and exact formal-tools source HEAD required");
 assert(consumer_execution_head===null||SHA.test(consumer_execution_head),
   "consumer_execution_head must be an exact lowercase source commit SHA");
 const tally=await loadPinnedTallyBusiness();
 const source=buildRealLifecycleCandidate();
 const native=FAITHFUL_OBSERVATIONS();
 assert(native.length===6&&native.every(x=>x.exit_code===0&&
   ["SAT","UNSAT"].includes(x.status)),"original G3 observations unavailable");
 const {problem_json,method_json,provenance_json,candidate,provenance}=source;
 const candidate_sha256=candidate.candidate_sha256;
 const persist=await persistSolutionCandidate({store_dir,problem_json,method_json,provenance_json});
 assert(persist.status==="CANDIDATE_PERSISTED","cannot persist sealed source-bound G4 candidate");
 const inspect=async current=>inspectStoredReplay({store_dir,candidate_sha256,
   current_provenance_json:current});
 const phase=[];
 const run=async(label,gate,dependency_override)=>{
   // Only a formally authorized replay can ever report dependencies complete.
   // This candidate never reaches that gate; even a malicious true caller
   // assertion must not persuade the pinned Tally Business source to admit it.
   const dependenciesComplete=dependency_override??(gate.status==="QUALIFIED_REPLAY"&&
     gate.replay_allowed===true&&gate.solution_promotable===true&&
     gate.claim_result==="VERIFIED");
   const input={issueRef:"https://github.com/kaicreator-mm/formal-tools/issues/11",
     issueNumber:11,sourceSha:formal_head,
     claimRef:"formal-tools:g4-candidate:"+candidate_sha256,
     dependenciesComplete};
   const output=await tally.invoke(input); // ACTUAL Tally v2 Business Function
   assert(denied(output),"Tally business function gave unqualified input authority");
   phase.push({phase:label,store_status:gate.status,dependenciesComplete,
     tally_result:output,actual_business_function_called:true});
 };
 const pre=await inspect(provenance_json);
 assert(pre.status==="REPLAY_BLOCKED_UNQUALIFIED"&&pre.replay_allowed===false,
   "G4 store unexpectedly promoted an unqualified candidate");
 await run("unqualified-candidate",pre);
 const preflight=inspectDisV020Consumption({candidate_json:JSON.stringify(candidate),
   current_provenance_json:provenance_json,target_head:DIS_V020_REFERENCE.source_head});
 assert(preflight.kind==="UNKNOWN"&&preflight.authority==="NONE"&&
   preflight.effect_dispatched===false&&preflight.host_invocations===0,
   "DIS preflight was improperly promoted");
 const drift=await inspect(JSON.stringify({...provenance,tool_version:"5.4.1"}));
 assert(drift.status==="STALE","tool drift failed to invalidate store observation");
 await run("tool-version-stale",drift);
 await run("forged-dependencies-complete",pre,true);
 assert(phase.at(-1).tally_result.state==="OBSERVED_INPUT_ONLY"&&
   phase.at(-1).tally_result.reason==="REQUIRES_NATIVE_CLAIM_AND_KERNEL_ADMISSION",
   "Tally admitted a forged dependenciesComplete boolean");
 const revoke=await revokeStoredCandidate({store_dir,candidate_sha256,reason:"OPERATOR_REVOKED"});
 assert(revoke.status==="INVALIDATED","candidate revocation not persisted");
 const invalidated=await inspect(provenance_json);
 assert(invalidated.status==="INVALIDATED","tombstone failed to dominate persisted candidate");
 await run("post-revocation",invalidated);
 assert(phase.length===4&&phase.every(x=>denied(x.tally_result)),
   "one or more Domain App observations were not denied");
 return Object.freeze({
   schema:"formal-tools/g6-real-tally-business-consumer/0.1",
   source_head:formal_head,candidate_sha256,
   consumer_execution:Object.freeze({
     source_commit:consumer_execution_head, // caller-reported; reviewer must verify against GitHub
     source_commit_independently_attested:false,
     driver_git_blob:gitBlob(readFileSync(fileURLToPath(import.meta.url))),
     test_git_blob:gitBlob(readFileSync(new URL("../../../tests/llm-g6-real-tally-business.test.mjs",import.meta.url))),
     source_bytes_executed_pinned:true
   }),
   host:Object.freeze({platform:process.platform,arch:process.arch,node:process.version,
     uid:typeof process.getuid==="function"?process.getuid():null,
     gid:typeof process.getgid==="function"?process.getgid():null,
     independently_attested:false}),
   source:G6_TALLY_SOURCE,tally_source_sha256:tally.source_sha256,
   native_original_faithful_cases:6,
   original_claim:"UNVERIFIED",
   function_calls:4,host_invocations:0,effect_dispatched:false,
   did_invoke_actual_domain_business_function:true,
   did_invoke_dis_aot_sdk_host:false,
   independent_professional_oracle:false,
   solution_promotable:false,replay_allowed:false,g6_accepted:false,
   consumer_preflight:preflight,phases:phase,
   status:"PASSED_ENGINEERING_ONLY"
 });
}
async function main(args){
 assert((args.length===2||args.length===3),"usage: node real-tally-business-consumer.mjs STORE_DIR FORMAL_HEAD [CONSUMER_EXECUTION_HEAD]");
 const [store_dir,formal_head,consumer_execution_head]=args;
 const r=await runRealTallyBusinessConsumption({store_dir,formal_head,
   consumer_execution_head:consumer_execution_head??null});
 process.stdout.write(JSON.stringify(r,null,2)+"\n");
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 main(process.argv.slice(2)).catch(e=>{
  console.error("G6_REAL_TALLY_BUSINESS_CONSUMPTION_BLOCKED: "+String(e?.message??e));
  process.exitCode=1;
 });
}
