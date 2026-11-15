import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  persistSolutionCandidate,
  revokeStoredCandidate
} from "../packages/runner/js/solution-store.mjs";

const DIR_FSYNC_UNSUPPORTED=new Set(["EPERM","EINVAL","EOPNOTSUPP","ENOSYS","ENOTTY"]);
const encode=JSON.stringify;
const sha=letter=>letter.repeat(64);

async function directoryFsyncSupported(directory){
  let handle;
  try{
    handle=await open(directory,"r");
    await handle.sync();
    return true;
  }catch(error){
    if(DIR_FSYNC_UNSUPPORTED.has(error?.code))return false;
    throw error;
  }finally{
    await handle?.close();
  }
}

const probe=mkdtempSync(join(tmpdir(),"ft-g4-process-probe-"));
const fsyncSupported=await directoryFsyncSupported(probe);
rmSync(probe,{recursive:true,force:true});
if(!fsyncSupported&&process.env.CI){
  throw new Error("G4 cross-process replay CI requires a directory-fsync-capable POSIX store");
}
const onSupported=fsyncSupported?test:test.skip;

function fixture(){
  const problem={
    schema:"formal-tools/problem-spec/0.1",
    problem_id:"ads.g4.cross_process",
    source_refs:[{id:"requirements",sha256:sha("a"),classification:"PUBLIC",
      purpose:"frozen synthetic process-restart case",consumer:"formal_tools"}],
    requirements:[{id:"r1",source_ref:"requirements",text:"A persisted candidate never becomes reusable by reopening it."}],
    claims:[{id:"claim1",text:"A persisted candidate never becomes reusable by reopening it.",
      kind:"bounded_model",requirement_ids:["r1"],source_refs:["requirements"],
      capability_ids:["logic.smt"]}],
    oracles:[{id:"oracle1",source_ref:"requirements",frozen:true,
      positive_case_ids:["positive_case"],negative_case_ids:["negative_case"],
      review_identity:"independent_reviewer"}],
    capability_ids:["logic.smt"],
    budget:{max_steps:3,max_depth:3,max_cost_units:10,max_total_time_ms:10000,max_retries:0},
    policy:{allowed_tools:["z3"],allowed_operations:{z3:["solve"]},
      destination:"LOCAL",max_input_classification:"PUBLIC",allow_network:false}
  };
  const method={
    schema:"formal-tools/method-proposal/0.1",
    method_id:"g4_cross_process_method",
    problem_id:problem.problem_id,
    goal_claim_ids:["claim1"],
    oracle_ids:["oracle1"],
    semantic_review:"PENDING",
    steps:[{id:"step01",tool_id:"z3",operation:"solve",claim_ids:["claim1"],
      provides:["logic.smt"],depends_on:[],source_refs:["requirements"],
      estimated_cost_units:2,timeout_ms:300,destination:"LOCAL",
      output_classification:"PUBLIC"}]
  };
  const provenance={
    schema:"formal-tools/solution-provenance/0.1",
    source_id:"requirements",source_sha256:sha("a"),
    oracle_id:"oracle1",oracle_sha256:sha("a"),
    model_sha256:sha("b"),tool_id:"z3",tool_version:"5.4.0",
    tool_binary_sha256:sha("c"),platform:"debian13-x86_64",
    evidence_sha256:sha("d"),evidence_gate:"BYTES_BOUND_UNATTESTED"
  };
  return {
    problem_json:encode(problem),
    method_json:encode(method),
    provenance_json:encode(provenance),
    provenance
  };
}

/**
 * Read the persisted record in a new OS process. This deliberately avoids
 * sharing the writer process's module cache or in-memory state.
 */
function inspectInFreshProcess(args){
  const moduleUrl=new URL("../packages/runner/js/solution-store.mjs",import.meta.url).href;
  const source=`import { inspectStoredReplay } from ${JSON.stringify(moduleUrl)};
const result=await inspectStoredReplay(${JSON.stringify(args)});
process.stdout.write(JSON.stringify(result));`;
  const child=spawnSync(process.execPath,["--input-type=module","--eval",source],{
    encoding:"utf8",timeout:10000,maxBuffer:65536
  });
  assert.equal(child.error,undefined,String(child.error||""));
  assert.equal(child.signal,null,child.stderr||"child process was signalled");
  assert.equal(child.status,0,child.stderr||"child process failed");
  assert.ok(child.stdout.length>0,"fresh process must return a replay inspection result");
  return JSON.parse(child.stdout);
}

onSupported("G4 persisted candidate survives process restart but remains blocked, stale-aware and revocable",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"ft-g4-cross-process-"));
  try{
    const f=fixture();
    const stored=await persistSolutionCandidate({store_dir:directory,...f});
    assert.equal(stored.status,"CANDIDATE_PERSISTED",JSON.stringify(stored));
    assert.equal(stored.record_write,"NEW");
    assert.match(stored.candidate_sha256,/^[a-f0-9]{64}$/);

    const request={
      store_dir:directory,
      candidate_sha256:stored.candidate_sha256,
      current_provenance_json:f.provenance_json
    };
    const reopened=inspectInFreshProcess(request);
    assert.equal(reopened.status,"REPLAY_BLOCKED_UNQUALIFIED");
    assert.equal(reopened.fingerprint,stored.candidate_sha256);
    assert.equal(reopened.claim_result,"UNVERIFIED");
    assert.equal(reopened.replay_allowed,false);
    assert.equal(reopened.solution_promotable,false);

    const drift=inspectInFreshProcess({
      ...request,
      current_provenance_json:encode({...f.provenance,tool_version:"5.4.1"})
    });
    assert.equal(drift.status,"STALE");
    assert.deepEqual(drift.changed_fields,["tool_version"]);
    assert.equal(drift.claim_result,"UNVERIFIED");
    assert.equal(drift.replay_allowed,false);
    assert.equal(drift.solution_promotable,false);

    const revoked=await revokeStoredCandidate({
      store_dir:directory,
      candidate_sha256:stored.candidate_sha256,
      reason:"ORACLE_REVOKED"
    });
    assert.equal(revoked.status,"INVALIDATED");

    const afterRestart=inspectInFreshProcess(request);
    assert.equal(afterRestart.status,"INVALIDATED");
    assert.equal(afterRestart.reason,"EXPLICIT_REVOCATION");
    assert.equal(afterRestart.replay_allowed,false);
    assert.equal(afterRestart.solution_promotable,false);

    const resurrection=await persistSolutionCandidate({store_dir:directory,...f});
    assert.equal(resurrection.status,"INVALIDATED",
      "a durable revocation tombstone must dominate a later identical persist");
  }finally{
    rmSync(directory,{recursive:true,force:true});
  }
});
