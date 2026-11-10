import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,chmod,access,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {invokeStagedTool} from "../packages/runner/js/sdk.mjs";

const hash=s=>createHash("sha256").update(s).digest("hex");
const withSource=async callback=>{
  const root=await mkdtemp(join(tmpdir(),"formal-staged-source-"));
  try{await callback(root);}finally{await rm(root,{recursive:true,force:true});}
};
test("staged SDK rejects nonstaged or unsafe input names before launching",()=>withSource(async root=>{
  await writeFile(join(root,"model.smt2"),"(check-sat)");
  const common={tool:"z3",operation:"solve",sourceRoot:root,inputs:["model.smt2"]};
  await assert.rejects(invokeStagedTool({...common,settings:{input:"../escape"}}),/may not access paths outside the private workspace/);
  await assert.rejects(invokeStagedTool({...common,inputs:["../escape"],settings:{input:"../escape"}}),/invalid/);
  await assert.rejects(invokeStagedTool({...common,settings:{input:"absent.smt2"}}),/explicitly staged/);
  await assert.rejects(invokeStagedTool({...common,settings:{}}),/must be nonempty|required/);
  await assert.rejects(invokeStagedTool({...common,operation:"unknown",settings:{input:"model.smt2"}}),/unknown operation/);
  await assert.rejects(invokeStagedTool({...common,operation:"help",settings:{input:"model.smt2"}}),/unknown operation/);
}));
test("unavailable native tool does not claim output collection or modify original input",()=>withSource(async root=>{
  await writeFile(join(root,"model.smt2"),"(check-sat)");
  const old=process.env.FORMAL_TOOLS_BIN_DIR;
  process.env.FORMAL_TOOLS_BIN_DIR=join(root,"not-installed-tool-directory");
  try{
    const receipt=await invokeStagedTool({
      tool:"z3",operation:"solve",sourceRoot:root,
      inputs:["model.smt2"],settings:{input:"model.smt2"}
    });
    assert.equal(receipt.process.status,"NOT_STARTED");
    assert.equal(receipt.artifacts.status,"NOT_COLLECTED");
    assert.equal(receipt.staging.inputs[0].sha256,hash("(check-sat)"));
    assert.equal(await readFile(join(root,"model.smt2"),"utf8"),"(check-sat)");
  }finally{
    if(old===undefined)delete process.env.FORMAL_TOOLS_BIN_DIR;
    else process.env.FORMAL_TOOLS_BIN_DIR=old;
  }
}));
test("fake POSIX solver writes generated artifacts only within private workspace",
{skip:process.platform==="win32"?"POSIX executable stub":false},
()=>withSource(async root=>{
  const bin=await mkdtemp(join(tmpdir(),"formal-staged-fake-bin-"));
  const old=process.env.FORMAL_TOOLS_BIN_DIR;
  try{
    await mkdir(join(root,"models"));
    await writeFile(join(root,"models","model.smt2"),"(check-sat)");
    const source=[
      "#!/usr/bin/env node",
      'const fs=require("node:fs");',
      'const path=require("node:path");',
      "const file=process.argv.at(-1);",
      'fs.writeFileSync(path.join(path.dirname(file),"trace.txt"),"staged trace");',
      'fs.writeFileSync(file,"changed in stage only");',
      'process.stdout.write("sat\\n");'
    ].join("\n")+"\n";
    await writeFile(join(bin,"z3"),source);
    await chmod(join(bin,"z3"),0o755);
    process.env.FORMAL_TOOLS_BIN_DIR=bin;
    const result=await invokeStagedTool({
      tool:"z3",operation:"solve",sourceRoot:root,
      inputs:["models/model.smt2"],settings:{input:"models/model.smt2"}
    });
    assert.equal(result.process.status,"EXIT_ZERO",JSON.stringify(result));
    assert.equal(result.tool_status,"SAT");
    assert.equal(result.artifacts.status,"COMPLETE",JSON.stringify(result.artifacts));
    assert.deepEqual(result.artifacts.items.map(x=>x.path),
      ["models/model.smt2","models/trace.txt"]);
    assert.equal(await readFile(join(root,"models","model.smt2"),"utf8"),"(check-sat)");
    assert.equal(result.staging.inputs[0].sha256,hash("(check-sat)"));
    assert.equal(result.artifacts.items.find(x=>x.path==="models/trace.txt").sha256,hash("staged trace"));
    await assert.rejects(access(join(root,"models","trace.txt")),{code:"ENOENT"});
    assert.ok(!JSON.stringify(result).includes("formal-tool-inputs-"));
  }finally{
    if(old===undefined)delete process.env.FORMAL_TOOLS_BIN_DIR;
    else process.env.FORMAL_TOOLS_BIN_DIR=old;
    await rm(bin,{recursive:true,force:true});
  }
}));

test("staged SDK refuses optional input files that were not staged",()=>withSource(async root=>{
  await writeFile(join(root,"model.tla"),"---- MODULE model ----");
  const base={tool:"tla-tlc",operation:"check",sourceRoot:root,inputs:["model.tla"]};
  await assert.rejects(invokeStagedTool({
    ...base,settings:{input:"model.tla",config:"config.cfg"}
  }),/file option config.*explicitly staged/);
  await assert.rejects(invokeStagedTool({
    tool:"rdf-shacl",operation:"validate",sourceRoot:root,inputs:["data.ttl"],
    settings:{input:"data.ttl",shapes:"shapes.ttl"}
  }),/file option shapes.*explicitly staged/);
}));
test("staged SDK rejects absolute and traversal paths from optional output settings",()=>withSource(async root=>{
  const base={tool:"apalache",operation:"check",sourceRoot:root,inputs:["model.tla"]};
  for(const unsafe of ["../../escape","/tmp/external","C:/external","..\\external","\\\\server\\share\\bad"]){
    await assert.rejects(invokeStagedTool({
      ...base,settings:{input:"model.tla",output:unsafe}
    }),/staged option output.*outside/);
  }
  await assert.rejects(invokeStagedTool({
    tool:"souffle",operation:"run",sourceRoot:root,inputs:["rules.dl"],
    settings:{input:"rules.dl",output:"../outside"}
  }),/staged option output.*outside/);
}));

test("staged SDK treats Apalache positional state names as symbols, not input files",()=>withSource(async root=>{
  await writeFile(join(root,"model.tla"),"---- MODULE model ----");
  const old=process.env.FORMAL_TOOLS_BIN_DIR;
  process.env.FORMAL_TOOLS_BIN_DIR=join(root,"missing-native-binaries");
  const base={
    tool:"apalache",operation:"test",sourceRoot:root,inputs:["model.tla"],
    settings:{input:"model.tla",before:"Init",action:"Next",assertion:"Invariant"}
  };
  try{
    const result=await invokeStagedTool(base);
    assert.equal(result.process.status,"NOT_STARTED");
    assert.equal(result.artifacts.status,"NOT_COLLECTED");
    assert.deepEqual(result.invocation.args,["test","model.tla","Init","Next","Invariant"]);
    assert.deepEqual(result.staging.inputs.map(x=>x.path),["model.tla"]);
    await assert.rejects(invokeStagedTool({...base,settings:{...base.settings,input:"unstaged.tla"}}),/explicitly staged/);
    await assert.rejects(invokeStagedTool({...base,settings:{...base.settings,before:"../outside"}}),/outside/);
  }finally{
    if(old===undefined)delete process.env.FORMAL_TOOLS_BIN_DIR;
    else process.env.FORMAL_TOOLS_BIN_DIR=old;
  }
}));
