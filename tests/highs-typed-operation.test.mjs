import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { describePortfolioTool, planPortfolioOperation, runPortfolioOperation } from "../packages/runner/js/tool-portfolio-t4.mjs";
import * as sdk from "../packages/runner/js/sdk.mjs";

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
/** @type {import("../packages/runner/js/sdk.mjs").HighsLinearProgram} */
const model={
  sense:"max",objective:[3,2],
  variables:[{lower:0,upper:null},{lower:0,upper:null}],
  constraints:[{lower:null,upper:1,coefficients:[1,1]}]
};
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");

async function fixtureBundle(){
  const root=await mkdtemp(join(tmpdir(),"ft-highs-typed-test-"));
  await mkdir(join(root,"bin"),{recursive:true});
  await mkdir(join(root,"tools","highs"),{recursive:true});
  await mkdir(join(root,"tests","highs"),{recursive:true});
  await writeFile(join(root,"tools","highs","meta.json"),JSON.stringify({
    tool_id:"highs",version:"1.15.1",kind:"python-lib",unavailable:false
  })+"\n");
  await writeFile(join(root,"tools","highs","run"),"#!/bin/sh\nexit 0\n");
  await chmod(join(root,"tools","highs","run"),0o755);
  await copyFile(join(repoRoot,"portable/verification/cases/highs/expect.sh"),join(root,"tests","highs","expect.sh"));
  await copyFile(join(repoRoot,"portable/verification/cases/highs/solve-lp.py"),join(root,"tests","highs","solve-lp.py"));
  const runner=join(root,"bin","tool-runner");
  const source=String.raw\`#!/usr/bin/env node
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const root=path.resolve(__dirname,"..");
const [command,id,script,input]=process.argv.slice(2);
if(command!=="run"||id!=="highs"||script!==path.join(root,"tests","highs","solve-lp.py")||process.argv.length!==6)process.exit(2);
if(!process.env.FORMAL_TOOLS_HIGHS_TIME_LIMIT_S)process.exit(3);
const mode=process.env.FORMAL_TEST_HIGHS_MODE??"optimal";
if(mode==="timeout"){setInterval(()=>{},1000);}
if(mode==="overflow"){process.stdout.write("x".repeat(1048577));}
if(mode==="missing-dependency"){process.stderr.write("DEPENDENCY_IMPORT_FAILED:ModuleNotFoundError");process.exit(3);}
if(mode==="api-error"){process.stderr.write("HIGHS_API_ERROR_RUN:kWarning");process.exit(3);}
if(mode==="malformed"){process.stdout.write("{malformed");process.exit(0);}
const raw=fs.readFileSync(input);
const input_sha256=crypto.createHash("sha256").update(raw).digest("hex");
const result={
  schema:"formal-tools/highs-solve-lp/1.0",tool:"highs",highspy_version:"1.15.1",
  numpy_version:mode==="numpy-drift"?"1.26.4":"2.2.4",
  python_version:mode==="python-drift"?"3.13.6":"3.13.5",input_sha256,
  model_status:mode==="infeasible"?"kInfeasible":mode==="unbounded"?"kUnbounded":"kOptimal",
  objective:3,variables:[1,0],solver_api_status:mode==="api-warning"?"kWarning":"kOk"
};
if(result.model_status!=="kOptimal"){result.objective=null;result.variables=[];}
if(mode==="bad-optimal")result.variables=[1];
process.stdout.write(JSON.stringify(result)+"\\n");
\`;

  await writeFile(runner,source);
  await chmod(runner,0o755);
  const runnerBytes=await readFile(runner);
  return {root,runnerSha:sha(runnerBytes),cleanup:()=>rm(root,{recursive:true,force:true})};
}

test("Highs candidate exposes one bounded typed Python Library operation, never raw argv",async()=>{
  const description=describePortfolioTool("highs");
  assert.ok(description.operations.includes("solve-lp"));
  assert.equal(description.raw_argv_allowed,false);
  const plan=planPortfolioOperation("highs","solve-lp",model);
  assert.equal(plan.schema,"formal-tools/highs-solve-lp/1.0");
  assert.equal(plan.raw_argv_allowed,false);
  assert.equal(plan.budget.max_variables,64);
  assert.equal(plan.budget.max_constraints,128);
  assert.match(plan.input_sha256,/^[a-f0-9]{64}$/);
  assert.throws(()=>planPortfolioOperation("highs","raw",model),/unadmitted/);
  assert.throws(()=>planPortfolioOperation("nuXmv","solve-lp",model),/unadmitted/);
  assert.throws(()=>planPortfolioOperation("highs","solve-lp",{...model,argv:["sh"]}),/HIGHS_MODEL_SCHEMA_INVALID/);
  assert.throws(()=>planPortfolioOperation("highs","solve-lp",{...model,constraints:[{lower:null,upper:1,coefficients:[1]}]}),/HIGHS_CONSTRAINT_INVALID/);
  const sparseObjective=new Array(2);sparseObjective[1]=2;
  assert.throws(()=>planPortfolioOperation("highs","solve-lp",{...model,objective:sparseObjective}),/HIGHS_OBJECTIVE_INVALID/);
  const hiddenExtra={...model};Object.defineProperty(hiddenExtra,"argv",{value:["sh"],enumerable:false});
  assert.throws(()=>planPortfolioOperation("highs","solve-lp",hiddenExtra),/HIGHS_MODEL_SCHEMA_INVALID/);
  const accessor={...model};Object.defineProperty(accessor,"sense",{enumerable:true,get(){throw new Error("getter must not execute");}});
  assert.throws(()=>planPortfolioOperation("highs","solve-lp",accessor),/HIGHS_MODEL_SCHEMA_INVALID/);
  const hostileProxy=new Proxy(model,{ownKeys(){throw new Error("proxy trap must not run");}});
  assert.throws(()=>planPortfolioOperation("highs","solve-lp",hostileProxy),/HIGHS_MODEL_SCHEMA_INVALID/);
  const proxyArray=new Proxy(model.objective,{getPrototypeOf(){throw new Error("array proxy trap must not run");}});
  assert.throws(()=>planPortfolioOperation("highs","solve-lp",{...model,objective:proxyArray}),/HIGHS_OBJECTIVE_INVALID/);
  const proxyOptions=new Proxy({timeoutS:10},{get(){throw new Error("option proxy trap must not run");}});
  await assert.rejects(sdk.runPortfolioOperation("highs","solve-lp",model,proxyOptions),/plain data object/);
  await assert.rejects(sdk.runPortfolioOperation("highs","solve-lp",model,{get timeoutS(){throw new Error("option getter must not run");}}),/data property/);
});

test("SDK and CLI use the same pinned typed operation; CLI opens model with O_NOFOLLOW",{skip:process.platform!=="linux"||process.arch!=="x64"},async()=>{
  assert.equal(typeof sdk.planPortfolioOperation,"function");
  assert.equal(typeof sdk.runPortfolioOperation,"function");
  const bundle=await fixtureBundle();
  const oldRoot=process.env.FORMAL_PORTABLE_ROOT,oldPin=process.env.FORMAL_PORTABLE_RUNNER_SHA256;
  const modelPath=join(bundle.root,"model.json");
  await writeFile(modelPath,JSON.stringify(model));
  try{
    process.env.FORMAL_PORTABLE_ROOT=bundle.root;
    process.env.FORMAL_PORTABLE_RUNNER_SHA256=bundle.runnerSha;
    const receipt=await runPortfolioOperation("highs","solve-lp",model,{timeoutS:10});
    assert.equal(receipt.status,"T4_OPERATION_EXECUTED_UNREVIEWED");
    assert.equal(receipt.qualification,"NOT_T4_ACCEPTED_INDEPENDENT_REVIEW_PENDING");
    assert.equal(receipt.solver.highspy_version,"1.15.1");
    assert.equal(receipt.solver.model_status,"kOptimal");
    assert.equal(receipt.solver.objective,3);
    assert.deepEqual(receipt.solver.variables,[1,0]);
    assert.equal(receipt.process.exit_code,0);
    assert.match(receipt.operation_script_sha256,/^[a-f0-9]{64}$/);
    assert.equal(receipt.input_sha256,receipt.solver.input_sha256);
    const metaPath=join(bundle.root,"tools","highs","meta.json");
    const originalMeta=await readFile(metaPath,"utf8");
    await writeFile(metaPath,JSON.stringify({tool_id:"highs",version:"1.15.1",kind:"binary",unavailable:false}));
    const wrongKind=await runPortfolioOperation("highs","solve-lp",model,{timeoutS:10});
    assert.equal(wrongKind.status,"NOT_RUN_FAIL_CLOSED");
    assert.match(wrongKind.reason,/HIGHS_ADAPTER_KIND_MISMATCH/);
    await writeFile(metaPath,originalMeta);
    const sdkReceipt=await sdk.runPortfolioOperation("highs","solve-lp",model,{timeoutS:10});
    assert.equal(sdkReceipt.status,"T4_OPERATION_EXECUTED_UNREVIEWED");
    assert.equal(sdkReceipt.solver?.objective,3);
    const cli=spawnSync(process.execPath,[
      join(repoRoot,"packages/runner/js/cli.mjs"),
      "portfolio","invoke","highs","solve-lp","--model",modelPath,"--timeout","10"
    ],{cwd:repoRoot,encoding:"utf8",timeout:15000,env:{...process.env}});
    assert.equal(cli.status,0,cli.stderr);
    const cliReceipt=JSON.parse(cli.stdout);
    assert.equal(cliReceipt.status,"T4_OPERATION_EXECUTED_UNREVIEWED");
    assert.equal(cliReceipt.solver.model_status,"kOptimal");
    const symlinkPath=join(bundle.root,"model-link.json");
    await symlink(modelPath,symlinkPath);
    const symlinkCli=spawnSync(process.execPath,[
      join(repoRoot,"packages/runner/js/cli.mjs"),
      "portfolio","invoke","highs","solve-lp","--model",symlinkPath
    ],{cwd:repoRoot,encoding:"utf8",timeout:15000,env:{...process.env}});
    assert.equal(symlinkCli.status,2);
    assert.match(symlinkCli.stderr,/ELOOP|too many symbolic links/i);
    const oversizedPath=join(bundle.root,"oversized.json");
    await writeFile(oversizedPath," ".repeat(65537));
    const oversizedCli=spawnSync(process.execPath,[
      join(repoRoot,"packages/runner/js/cli.mjs"),
      "portfolio","invoke","highs","solve-lp","--model",oversizedPath
    ],{cwd:repoRoot,encoding:"utf8",timeout:15000,env:{...process.env}});
    assert.equal(oversizedCli.status,2);
    assert.match(oversizedCli.stderr,/64KiB/);
  }finally{
    if(oldRoot===undefined)delete process.env.FORMAL_PORTABLE_ROOT;else process.env.FORMAL_PORTABLE_ROOT=oldRoot;
    if(oldPin===undefined)delete process.env.FORMAL_PORTABLE_RUNNER_SHA256;else process.env.FORMAL_PORTABLE_RUNNER_SHA256=oldPin;
    await bundle.cleanup();
  }
});

async function mcpRequests(env,requests){
  const child=spawn(process.execPath,[join(repoRoot,"packages/runner/js/mcp.mjs")],{
    cwd:repoRoot,env,stdio:["pipe","pipe","pipe"]
  });
  const pending=new Map();
  let nextId=1,buffer="",stderr="";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data",chunk=>{stderr+=chunk;});
  child.stdout.on("data",chunk=>{
    buffer+=chunk;
    let index;
    while((index=buffer.indexOf("\n"))>=0){
      const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
      if(!line)continue;
      let message;try{message=JSON.parse(line);}catch{continue;}
      if(message.id!==undefined&&pending.has(message.id)){
        const resolve=pending.get(message.id);pending.delete(message.id);resolve(message);
      }
    }
  });
  const request=(method,params)=>{
    const id=nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error("MCP timeout "+method+" stderr="+stderr));},10000);
      pending.set(id,message=>{clearTimeout(timer);resolve(message);});
      child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
    });
  };
  try{
    const initialized=await request("initialize",{
      protocolVersion:"2025-06-18",capabilities:{},
      clientInfo:{name:"highs-typed-operation-test",version:"1.0.0"}
    });
    assert.equal(initialized.error,undefined,JSON.stringify(initialized));
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized",params:{}})+"\n");
    const results=[];
    for(const [method,params] of requests)results.push(await request(method,params));
    return results;
  }finally{
    child.stdin.end();
    if(child.exitCode===null&&child.signalCode===null){
      child.kill("SIGTERM");
      await new Promise(resolve=>{
        if(child.exitCode!==null||child.signalCode!==null)return resolve();
        child.once("exit",resolve);
      });
    }
  }
}

test("MCP stdio invokes the same typed Highs operation and rejects arbitrary fields",{skip:process.platform!=="linux"||process.arch!=="x64"},async()=>{
  const bundle=await fixtureBundle();
  const env={...process.env,FORMAL_PORTABLE_ROOT:bundle.root,FORMAL_PORTABLE_RUNNER_SHA256:bundle.runnerSha};
  try{
    const [listed,executed,rejected]=await mcpRequests(env,[
      ["tools/list",{}],
      ["tools/call",{name:"run_portfolio_operation",arguments:{tool:"highs",operation:"solve-lp",model,timeout_s:10}}],
      ["tools/call",{name:"run_portfolio_operation",arguments:{tool:"highs",operation:"solve-lp",model,timeout_s:10,argv:["sh"]}}]
    ]);
    const names=(listed.result?.tools??[]).map(tool=>tool.name);
    assert.ok(names.includes("run_portfolio_operation"));
    assert.ok(names.includes("list_portfolio_tools"));
    const receipt=JSON.parse(executed.result.content[0].text);
    assert.equal(receipt.status,"T4_OPERATION_EXECUTED_UNREVIEWED");
    assert.equal(receipt.solver.highspy_version,"1.15.1");
    assert.equal(receipt.solver.objective,3);
    assert.notEqual(executed.result?.isError,true);
    assert.ok(rejected.error||rejected.result?.isError===true,"unknown argv field must be rejected");
  }finally{await bundle.cleanup();}
});
