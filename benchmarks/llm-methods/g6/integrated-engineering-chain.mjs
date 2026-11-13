/**
 * Issue #11 G3→G6: ONE bounded runtime chain reusing real historical native
 * receipts; no duplicate Z3/cvc5 calls and no substitute DIS Host.
 * Technical-only: independent finite semantics is a distinct ALGORITHM,
 * not an independently credentialed domain/Source/Oracle/Host authority.
 */
import {resolve} from "node:path";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {readCapabilityRegistry} from "../../../packages/runner/js/problem-capabilities.mjs";
import {assessMethod} from "../../../packages/runner/js/method-planner.mjs";
import {buildRealLifecycleCandidate} from "../g4/real-provenance.mjs";
import {verifyHistoricalAds24} from "../g3/independent-finite-verifier.mjs";
import {runRealTallyBusinessConsumption} from "./real-tally-business-consumer.mjs";

const SHA=/^[a-f0-9]{40}$/;
const gitBlob=b=>createHash("sha1").update(Buffer.concat([
 Buffer.from("blob "+b.length+"\0"),b])).digest("hex");
const scriptGitBlob=url=>gitBlob(Buffer.from(readFileSync(url).toString("utf8").replace(/\r\n/g,"\n"),"utf8"));
const assert=(ok,message)=>{if(!ok)throw Error(message);};
/**
 * @param {{store_dir?:string,formal_head?:string}} [args]
 */
export async function runIntegratedEngineeringChain({store_dir,formal_head}={}){
 assert(typeof store_dir==="string"&&store_dir.startsWith("/")&&
   typeof formal_head==="string"&&SHA.test(formal_head),
   "must provide a POSIX absolute store and an exact Git HEAD");
 // Capability discovery is not a claimed installation or native invocation.
 const capabilities=readCapabilityRegistry();
 const cap=capabilities.capabilities.find(c=>c.id==="logic.smt");
 const z3=capabilities.tools.find(t=>t.id==="z3");
 const cvc5=capabilities.tools.find(t=>t.id==="cvc5");
 assert(cap&&z3?.capability_ids.includes(cap.id)&&cvc5?.capability_ids.includes(cap.id),
   "G2 capability registry no longer provides pinned SMT capabilities");
 const source=buildRealLifecycleCandidate();
 const method=assessMethod(JSON.parse(source.problem_json),JSON.parse(source.method_json));
 assert(method.status==="STRUCTURALLY_VALID"&&
   source.candidate.status==="CANDIDATE"&&
   source.candidate.claim_result==="UNVERIFIED",
   "Method or Solution candidate changed outside its qualified scope");
 // A DIFFERENT algorithm from the SMT emitter interprets R1/R2/R3 and
 // compares both historical solver outcomes to every semantic result.
 const verification=verifyHistoricalAds24();
 assert(verification.status==="SCORED_INDEPENDENT_ALGORITHM_UNATTESTED"&&
   verification.technical_source_check===true&&
   verification.cases_checked===6&&verification.model_queries_checked===24&&
   verification.historically_executed_native_observations===48&&
   verification.independent_professional_oracle===false,
   "independent-algorithm technical verification failed");
 // This executes REAL original Tally Domain App Business Function through
 // the existing durable G4 store on a POSIX owner-provisioned directory.
 const consumer=await runRealTallyBusinessConsumption({store_dir,formal_head});
 assert(consumer.status==="PASSED_ENGINEERING_ONLY"&&consumer.function_calls===4&&
   consumer.candidate_sha256===source.candidate.candidate_sha256&&
   consumer.phases.every(p=>p.tally_result.admitted===false&&p.tally_result.taskPass===false)&&
   consumer.consumer_preflight.kind==="UNKNOWN"&&consumer.host_invocations===0&&
   consumer.did_invoke_dis_aot_sdk_host===false&&consumer.g6_accepted===false,
   "unqualified candidate escaped the real Business/Replay boundary");
 return Object.freeze({
   schema:"formal-tools/i11-integrated-engineering-chain/0.1",
   source_head:formal_head,
   technical_execution:Object.freeze({
     driver_git_blob:scriptGitBlob(new URL(import.meta.url)),
     finite_verifier_git_blob:scriptGitBlob(new URL("../g3/independent-finite-verifier.mjs",import.meta.url)),
     source_commit_independently_attested:false,
     host_independently_attested:false
   }),
   stages:Object.freeze({
     capability_registry:"DISCOVERED_ONLY",
     method:"STRUCTURALLY_VALID",
     solve:"HISTORICAL_REAL_Z3_CVC5_24_EACH_REUSED",
     independent_verify:"DISTINCT_FINITE_ALGORITHM_UNATTESTED",
     solution:"CONTENT_ADDRESSED_UNQUALIFIED_CANDIDATE_PERSISTED",
     replay:"DENIED_STALE_AND_REVOKED",
     domain_business_function:"REAL_TALLY_4_DENYING_CALLS",
     dis_sdk_kdp_host:"NOT_EXECUTED"
   }),
   capability:{id:cap.id,z3_tool_registered:true,cvc5_tool_registered:true,
     registry_status:capabilities.status},
   method:{status:method.status,problem_sha256:method.problem_sha256,
     method_sha256:method.method_sha256},
   solver_observations_historically_executed:48,
   solver_observations_newly_executed:0,
   technical_verification:verification,
   solution_candidate_sha256:source.candidate.candidate_sha256,
   consumer,
   original_claim:"UNVERIFIED",
   independent_professional_oracle:false,
   qualified_solution:false,qualified_replay:false,
   dis_host_invocations:0,dis_effects:0,
   g6_full_qualified:false,
   status:"PASSED_ENGINEERING_ONLY"
 });
}
async function main(args){
 assert(args.length===2,"usage: node integrated-engineering-chain.mjs STORE_DIR FORMAL_HEAD");
 const result=await runIntegratedEngineeringChain({store_dir:args[0],formal_head:args[1]});
 process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main(process.argv.slice(2)).catch(e=>{
  console.error("INTEGRATED_ENGINEERING_CHAIN_BLOCKED: "+String(e?.message??e));
  process.exitCode=1;
 });
