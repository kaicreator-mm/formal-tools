import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {planToolProbe,planNative} from "../packages/runner/js/native-catalog.mjs";
import {inspectInstallation} from "../packages/runner/js/tool-manager.mjs";
import {doctor,runFixture,executeNativePlan} from "../packages/runner/js/native.mjs";
import {invokeTool,invokeStagedTool} from "../packages/runner/js/sdk.mjs";

test("Clingo launcher stays Python-compatible unless a trusted absolute binary is pinned",()=>{
  const legacy=planToolProbe("clingo",{FORMAL_CLINGO_PYTHON:"/opt/python3"});
  assert.equal(legacy.launcher,"python-module");
  assert.deepEqual(legacy.argv,["/opt/python3","-m","clingo","--help"]);
  const selected=planToolProbe("clingo",{FORMAL_CLINGO_BIN:"/opt/clingo/bin/clingo"});
  assert.equal(selected.launcher,"clingo-bin");
  assert.deepEqual(selected.argv,["/opt/clingo/bin/clingo","--help"]);
  for(const path of ["clingo","./clingo","../clingo","/opt/x\u0000evil"])
    assert.throws(()=>planToolProbe("clingo",{FORMAL_CLINGO_BIN:path}),/absolute|NUL/);
});

test("Explicit native Clingo drives doctor, fixed fixture, typed CLI and staged SDK without Python module",
  {skip:process.platform==="win32"?"POSIX shebang stub":false},async()=>{
    const root=await mkdtemp(join(tmpdir(),"formal-clingo-native-test-"));
    const bin=join(root,"clingo");
    const source=join(root,"positive.lp");
    const old=process.env.FORMAL_CLINGO_BIN;
    try{
      await writeFile(source,"candidate(a;b).\n1 { choose(X) : candidate(X) } 1.\n#show choose/1.\n");
      await writeFile(bin,[
        "#!/usr/bin/env node",
        'const args=process.argv.slice(2);',
        'if(args.includes("--help")){console.log("clingo version 5.8.3");process.exit(0)}',
        'if(args.some(x=>x.endsWith("positive.lp"))){console.log("Answer: 1\\nchoose(b)\\nAnswer: 2\\nchoose(a)\\nSATISFIABLE");process.exit(30)}',
        'if(args.some(x=>x.endsWith("negative.lp"))){console.log("UNSATISFIABLE");process.exit(20)}',
        'console.error("bad fixture");process.exit(65)'
      ].join("\n")+"\n");
      await chmod(bin,0o755);
      process.env.FORMAL_CLINGO_BIN=bin;
      const install=await inspectInstallation("clingo");
      assert.equal(install.status,"FOUND_NOT_PROBED");
      assert.equal(install.executable,bin);
      const probe=await doctor("clingo",5);
      assert.equal(probe.run_status,"EXECUTED");
      assert.equal(probe.exit_code,0);
      const pos=await runFixture("clingo","positive",5);
      const neg=await runFixture("clingo","negative",5);
      assert.equal(pos.test_verdict,"PASS",JSON.stringify(pos));
      assert.equal(neg.test_verdict,"PASS",JSON.stringify(neg));
      assert.equal(pos.executions[0].exit_code,30);
      assert.equal(neg.executions[0].exit_code,20);
      const plan=planNative("clingo","solve",{input:source,models:0});
      const technical=await executeNativePlan(plan,{cwd:root,timeout:5});
      assert.equal(technical.run_status,"EXECUTED");
      assert.equal(technical.tool_outcome,"SATISFIABLE");
      assert.equal(technical.executions[0].exit_code,30);
      const sdk=await invokeTool({tool:"clingo",operation:"solve",settings:{input:source,models:0}});
      assert.equal(sdk.process.exit_code,30);
      assert.equal(sdk.tool_status,"SATISFIABLE");
      assert.equal(sdk.scope,"UPSTREAM_TOOL_TECHNICAL_RESULT_ONLY");
      const staged=await invokeStagedTool({tool:"clingo",operation:"solve",sourceRoot:root,
        inputs:["positive.lp"],settings:{input:"positive.lp",models:0}});
      assert.equal(staged.tool_status,"SATISFIABLE");
      assert.equal(staged.process.exit_code,30);
      await assert.rejects(invokeStagedTool({tool:"clingo",operation:"solve",sourceRoot:root,
        inputs:["positive.lp"],settings:{input:"../escape.lp"}}),/outside the private workspace/);
    }finally{
      if(old===undefined)delete process.env.FORMAL_CLINGO_BIN;
      else process.env.FORMAL_CLINGO_BIN=old;
      await rm(root,{recursive:true,force:true});
    }
});
