import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  listPortfolioTools, describePortfolioTool, planPortfolioFixture,
  inspectPortfolioTool, runPortableGate
} from "../packages/runner/js/tool-portfolio-t4.mjs";

const candidate="minizinc";
test("T4: all 36 IDs share the capability registry, but only 13 retain the historical native adapter",()=>{
  const rows=listPortfolioTools();
  assert.equal(rows.length,36);
  assert.equal(new Set(rows.map(x=>x.id)).size,36);
  assert.equal(rows.filter(x=>x.origin==="native-ref").length,13);
  assert.equal(rows.filter(x=>x.origin==="candidate").length,23);
  assert.ok(rows.every(x=>x.t4_status!=="PASS"&&x.t5_status!=="PASS"));
  assert.equal(describePortfolioTool(candidate).raw_argv_allowed,false);
  assert.deepEqual(planPortfolioFixture(candidate).args,["verify",candidate]);
  assert.throws(()=>planPortfolioFixture("z3"),/existing 13-tool/);
  assert.throws(()=>planPortfolioFixture("bash"),/unknown portfolio tool/);
});
test("T4: CLI portfolio list stays read-only, does not promote discovered tools",()=>{
  const p=spawnSync(process.execPath,["packages/runner/js/cli.mjs","portfolio","list"],
    {encoding:"utf8",timeout:10000});
  assert.equal(p.status,0,p.stderr);
  const j=JSON.parse(p.stdout);
  assert.equal(j.tools.length,36);
  assert.equal(j.status,"DISCOVERY_NOT_T4_QUALIFIED");
});
test("T4: unconfigured portable host fails closed with no invented PASS",async()=>{
  const oldRoot=process.env.FORMAL_PORTABLE_ROOT;
  const oldSha=process.env.FORMAL_PORTABLE_RUNNER_SHA256;
  delete process.env.FORMAL_PORTABLE_ROOT;
  delete process.env.FORMAL_PORTABLE_RUNNER_SHA256;
  try{
    const report=await runPortableGate(candidate,{timeoutS:3});
    assert.equal(report.status,"NOT_RUN_FAIL_CLOSED");
    assert.equal((await inspectPortfolioTool(candidate)).status,"NOT_AVAILABLE_FAIL_CLOSED");
  }finally{
    if(oldRoot===undefined)delete process.env.FORMAL_PORTABLE_ROOT;else process.env.FORMAL_PORTABLE_ROOT=oldRoot;
    if(oldSha===undefined)delete process.env.FORMAL_PORTABLE_RUNNER_SHA256;else process.env.FORMAL_PORTABLE_RUNNER_SHA256=oldSha;
  }
});
if(process.platform==="linux"&&process.arch==="x64"){
  test("T4: synthetic runner exercises SHA pin, doctor, 3-case receipt, and tamper fail-closed (NOT an upstream native test)",async()=>{
    const root=await mkdtemp(join(tmpdir(),"ft-t4-contract-mock-"));
    const oldRoot=process.env.FORMAL_PORTABLE_ROOT;
    const oldSha=process.env.FORMAL_PORTABLE_RUNNER_SHA256;
    try{
      await mkdir(join(root,"bin"),{recursive:true});
      await mkdir(join(root,"tools",candidate),{recursive:true});
      await mkdir(join(root,"tests",candidate),{recursive:true});
      await writeFile(join(root,"tools",candidate,"meta.json"),
        JSON.stringify({id:candidate,version:describePortfolioTool(candidate).expected_version}));
      await writeFile(join(root,"tools",candidate,"run"),"#!/bin/sh\nexit 0\n");
      await chmod(join(root,"tools",candidate,"run"),0o755);
      await writeFile(join(root,"tests",candidate,"expect.sh"),"# fake fixed fixture contract\n");
      const runner=join(root,"bin","tool-runner");
      const script=String.raw`#!/bin/sh
if [ "$1" = doctor ]; then echo "mock doctor"; exit 0; fi
if [ "$1" = verify ]; then
  printf 'runner_schema\tformal-tools/portable-verify/0.2\n%s\tpos\t0\t1\t1\t1\tSATISFIED\n%s\tneg\t0\t1\t1\t1\tUNSAT\n%s\terr\t2\t1\t1\t1\tERROR\nverdict\tPASS\n' "$2" "$2" "$2" > "$FT_EVIDENCE_DIR/verify-$2.tsv"
  echo 'mock fixture output (no native tool called)'
  exit 0
fi
exit 2
`;
      await writeFile(runner,script);
      await chmod(runner,0o755);
      process.env.FORMAL_PORTABLE_ROOT=root;
      process.env.FORMAL_PORTABLE_RUNNER_SHA256=createHash("sha256").update(script).digest("hex");
      assert.equal((await inspectPortfolioTool(candidate)).status,"FOUND_PINNED_NOT_EXECUTED");
      assert.equal((await runPortableGate(candidate,{mode:"doctor",timeoutS:3})).status,"DOCTOR_EXECUTED_NOT_T3");
      const v=await runPortableGate(candidate,{timeoutS:3});
      assert.equal(v.status,"FIXTURE_TECHNICAL_PASS_UNREVIEWED",JSON.stringify(v));
      assert.deepEqual(v.cases.map(x=>x.phase),["pos","neg","err"]);
      assert.match(v.scope,/T5_SEMANTICS_NOT_EVALUATED/);
      process.env.FORMAL_PORTABLE_RUNNER_SHA256="0".repeat(64);
      assert.equal((await runPortableGate(candidate,{timeoutS:3})).status,"NOT_RUN_FAIL_CLOSED");
    }finally{
      if(oldRoot===undefined)delete process.env.FORMAL_PORTABLE_ROOT;else process.env.FORMAL_PORTABLE_ROOT=oldRoot;
      if(oldSha===undefined)delete process.env.FORMAL_PORTABLE_RUNNER_SHA256;else process.env.FORMAL_PORTABLE_RUNNER_SHA256=oldSha;
      await rm(root,{recursive:true,force:true});
    }
  });
}
