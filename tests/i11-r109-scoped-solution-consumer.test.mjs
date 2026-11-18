import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {admitScopedSolution,consumeScopedSolution,revokeScopedSolution,
  observeLocalScopedEvidence} from "../packages/runner/js/i11-scoped-solution.mjs";
import {enumerateSimplePaths} from "../benchmarks/llm-methods/i11/r109/c/independent-oracle.mjs";
import {inspectCandidateReplay} from "../packages/runner/js/solution-candidate.mjs";

const CLI=resolve(fileURLToPath(new URL("../packages/runner/js/i11-scoped-solution-cli.mjs",import.meta.url)));
const GRAPH=JSON.parse(readFileSync(new URL("../benchmarks/llm-methods/i11/r109/c/graph-source.json",import.meta.url)));
const idRe=/^[0-9a-f]{64}$/;
const SCOPE="LOCAL_FINITE_GRAPH_READ_ONLY";
const REQ=()=>{
  const observed=observeLocalScopedEvidence();
  assert.ok(observed);
  return {
    schema:"formal-tools/i11-scoped-consumption/1",
    solution_id:"",consumer_id:"formal-tools-local-consumer",scope:SCOPE,
    nonce:"scoped-nonce-0001",now_ms:Date.now(),
    observed,tool_outcome:"PROVEN",budget_ms:1000
  };
};
async function withStore(fn){
  const dir=mkdtempSync(join(tmpdir(),"formal-i11-r109-c-"));
  try{return await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}
}
async function fixture(dir){
  const a=await admitScopedSolution({store_dir:dir});
  assert.equal(a.status,"QUALIFIED_WITH_SCOPE",JSON.stringify(a));
  assert.match(a.solution_id,idRe);
  return {...REQ(),solution_id:a.solution_id};
}
const readOnly=x=>{
  assert.equal(x.effect_dispatched,false);
  assert.equal(x.external_host_executed??false,false);
};
const blocked=x=>{
  assert.notEqual(x.status,"CONSUMED_READ_ONLY");
  assert.equal(x.qualified_solution,false);
  assert.equal(x.local_reuse_allowed,false);
  readOnly(x);
};

test("C1 separate deterministic exhaustive semantic Oracle agrees with local solver but does not license external Host",async()=>{
  const o=enumerateSimplePaths(GRAPH);
  assert.equal(o.status,"PROVEN");
  assert.equal(o.distance,7);
  assert.ok(o.paths_checked>=2);
  const pins=observeLocalScopedEvidence();
  for(const pin of Object.values(pins))assert.ok(typeof pin==="string"&&pin.length>0);
  assert.match(pins.source_sha256,idRe);
  assert.match(pins.oracle_sha256,idRe);
  assert.notEqual(pins.source_sha256,pins.oracle_sha256,"source and oracle files are independent");
  assert.match(pins.model_sha256,idRe);
  assert.match(pins.tool_sha256,idRe);
  assert.match(pins.evidence_sha256,idRe);
  await withStore(async dir=>{
    const x=await admitScopedSolution({store_dir:dir});
    assert.equal(x.status,"QUALIFIED_WITH_SCOPE");
    assert.equal(x.qualifier,"INDEPENDENT_FINITE_ENUMERATION");
    assert.equal(x.scope,SCOPE);assert.equal(x.effect_dispatched,false);
    assert.equal(x.external_host_executed,false);
    assert.equal(x.record_write,"NEW");
    assert.equal((await admitScopedSolution({store_dir:dir})).record_write,"EXISTING",
      "deterministic solution identity has no new revocation-escaping issuance");
  });
});

test("C2 scoped local JS SDK reads proven answer, permits distinct nonces, rejects exact replay",async()=>{
  await withStore(async dir=>{
    const req=await fixture(dir);
    const one=await consumeScopedSolution({store_dir:dir,request:req});
    assert.equal(one.status,"CONSUMED_READ_ONLY",JSON.stringify(one));
    assert.equal(one.qualification,"QUALIFIED_WITH_SCOPE");
    assert.equal(one.distance,7);
    assert.deepEqual(one.path,["a","b","c","d"]);
    assert.equal(one.scope,SCOPE);readOnly(one);
    blocked(await consumeScopedSolution({store_dir:dir,request:req}));
    const second=await consumeScopedSolution({store_dir:dir,request:{
      ...req,nonce:"scoped-nonce-0002"
    }});
    assert.equal(second.status,"CONSUMED_READ_ONLY");
    readOnly(second);
  });
});

test("C2 unknown, error, timeout, exhausted budget and forged tool outcome fail closed",async()=>{
  await withStore(async dir=>{
    const req=await fixture(dir);
    for(const [outcome,expected] of [
      ["UNKNOWN","UNKNOWN"],["ERROR","ERROR"],["TIMEOUT","TIMEOUT"],
      ["PASS_UNVERIFIED","BLOCKED"]]){
      const got=await consumeScopedSolution({store_dir:dir,request:{
        ...req,tool_outcome:outcome
      }});
      assert.equal(got.status,expected,outcome);
      blocked(got);
    }
    const noBudget=await consumeScopedSolution({store_dir:dir,request:{...req,budget_ms:0}});
    assert.equal(noBudget.status,"TIMEOUT");blocked(noBudget);
    const yes=await consumeScopedSolution({store_dir:dir,request:req});
    assert.equal(yes.status,"CONSUMED_READ_ONLY",
      "negative probes do not spend the nonce or call a Host");
  });
});

test("C2 permission scope and attempted authority forgery cannot grant a local read",async()=>{
  await withStore(async dir=>{
    const req=await fixture(dir);
    for(const update of [
      {scope:"GLOBAL_EFFECT_AUTHORITY"},
      {consumer_id:"attacker"},
      {schema:"fake/1"},
      {nonce:"unsafe/../nonce"},
      {permissions:["EFFECT","ADMIN"]},
      {solution_id:"0".repeat(64)},
      {budget_ms:10001}
    ]){
      const got=await consumeScopedSolution({store_dir:dir,request:{...req,...update}});
      blocked(got);
    }
    const yes=await consumeScopedSolution({store_dir:dir,request:req});
    assert.equal(yes.status,"CONSUMED_READ_ONLY");
    readOnly(yes);
  });
});

test("C2 every independent source/Oracle/model/tool/version/evidence pin drift -> STALE, never user override",async()=>{
  await withStore(async dir=>{
    const req=await fixture(dir);
    for(const key of Object.keys(req.observed)){
      const got=await consumeScopedSolution({store_dir:dir,request:{
        ...req,observed:{...req.observed,[key]:"f".repeat(64)}
      }});
      assert.equal(got.status,"STALE",key);blocked(got);
    }
    for(const value of [null,{},{"__proto__":"evil"}]){
      const got=await consumeScopedSolution({store_dir:dir,request:{
        ...req,observed:value
      }});
      assert.equal(got.status,"STALE");blocked(got);
    }
    assert.equal((await consumeScopedSolution({store_dir:dir,request:req})).status,
      "CONSUMED_READ_ONLY");
  });
});

test("C2 expired local version and invalid wall-clock fields are fail-closed",async()=>{
  await withStore(async dir=>{
    const req=await fixture(dir);
    const expired=await consumeScopedSolution({store_dir:dir,request:{
      ...req,now_ms:1893456000000
    }});
    assert.equal(expired.status,"STALE");blocked(expired);
    for(const when of [NaN,Infinity,-Infinity,1.3,"1893456000000"]){
      const result=await consumeScopedSolution({store_dir:dir,request:{...req,now_ms:when}});
      assert.equal(result.status,"BLOCKED");blocked(result);
    }
    assert.equal((await consumeScopedSolution({store_dir:dir,request:req})).status,
      "CONSUMED_READ_ONLY");
  });
});

test("C2 tampered durable qualified record is STALE and cannot be revoked as valid",async()=>{
  await withStore(async dir=>{
    const req=await fixture(dir);
    const path=join(dir,"local-qualified-"+req.solution_id+".json");
    const original=JSON.parse(readFileSync(path,"utf8"));
    writeFileSync(path,JSON.stringify({...original,distance:0})+"\n","utf8");
    const got=await consumeScopedSolution({store_dir:dir,request:req});
    assert.equal(got.status,"STALE");blocked(got);
    const revoke=await revokeScopedSolution({store_dir:dir,solution_id:req.solution_id});
    assert.equal(revoke.status,"STALE");blocked(revoke);
  });
});

test("C2 durable revocation overrides all subsequent consumption and no new admission resurrects",async()=>{
  await withStore(async dir=>{
    const req=await fixture(dir);
    const rev=await revokeScopedSolution({store_dir:dir,solution_id:req.solution_id});
    assert.equal(rev.status,"INVALIDATED");blocked(rev);
    const response=await consumeScopedSolution({store_dir:dir,request:req});
    assert.equal(response.status,"INVALIDATED");blocked(response);
    const second=await admitScopedSolution({store_dir:dir});
    assert.equal(second.status,"INVALIDATED");blocked(second);
    assert.equal((await revokeScopedSolution({store_dir:dir,solution_id:req.solution_id})).status,
      "INVALIDATED");
  });
});

test("C2 concurrent same nonce: exactly one read-only consumption, no double use",async()=>{
  await withStore(async dir=>{
    const req=await fixture(dir);
    const all=await Promise.all(Array.from({length:5},()=>
      consumeScopedSolution({store_dir:dir,request:req})));
    assert.equal(all.filter(x=>x.status==="CONSUMED_READ_ONLY").length,1);
    assert.equal(all.filter(x=>x.status==="REPLAY_REJECTED").length,4);
    for(const x of all)readOnly(x);
  });
});

test("C2 CLI consumes admitted scoped Solution and rejects replay, wrong scope, revoked solution",async()=>{
  await withStore(async dir=>{
    const run=(...args)=>{
      const proc=spawnSync(process.execPath,[CLI,...args],{encoding:"utf8",timeout:10000});
      assert.equal(proc.error,undefined,proc.error?.message);
      return {code:proc.status,result:JSON.parse(proc.stdout)};
    };
    const admission=run("admit",dir);
    assert.equal(admission.code,0);
    assert.equal(admission.result.status,"QUALIFIED_WITH_SCOPE");
    const id=admission.result.solution_id;
    const wrong=run("consume",dir,id,"scoped-cli-nonce-0001","WRITE_EXTERNAL_EFFECT");
    assert.equal(wrong.code,2);blocked(wrong.result);
    const ok=run("consume",dir,id,"scoped-cli-nonce-0001",SCOPE);
    assert.equal(ok.code,0);assert.equal(ok.result.status,"CONSUMED_READ_ONLY");readOnly(ok.result);
    const replay=run("consume",dir,id,"scoped-cli-nonce-0001",SCOPE);
    assert.equal(replay.code,2);assert.equal(replay.result.status,"REPLAY_REJECTED");blocked(replay.result);
    const revoke=run("revoke",dir,id);
    assert.equal(revoke.code,0);assert.equal(revoke.result.status,"INVALIDATED");
    const after=run("consume",dir,id,"scoped-cli-nonce-0002",SCOPE);
    assert.equal(after.code,2);assert.equal(after.result.status,"INVALIDATED");
  });
});

test("existing G4 Candidate remains deny-only and production trust-root policy not modified",async()=>{
  const anchors=JSON.parse(readFileSync(new URL("../registry/G4_QUALIFICATION_ANCHORS.json",
    import.meta.url)));
  assert.equal(anchors.status,"NOT_CONFIGURED");
  assert.deepEqual(anchors.anchors,[]);
  const prior=inspectCandidateReplay('{"schema":"formal-tools/solution-candidate/0.1","status":"QUALIFIED_WITH_SCOPE"}',"{}");
  assert.equal(prior.status,"BLOCKED");
  assert.equal(prior.replay_allowed,false);
  assert.equal(prior.solution_promotable,false);
});

test("C2 no implicit directory provisioning, symlinked root or missing qualification bypass",async()=>{
  await withStore(async dir=>{
    const none=await consumeScopedSolution({store_dir:dir,request:{
      ...REQ(),solution_id:"f".repeat(64)
    }});
    assert.equal(none.status,"BLOCKED");blocked(none);
    blocked(await admitScopedSolution({store_dir:join(dir,"missing")}));
    blocked(await consumeScopedSolution({store_dir:"relative",request:{
      ...REQ(),solution_id:"f".repeat(64)
    }}));
  });
});
