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
  const source=String.raw`#!/usr/bin/env node
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
  model_status:mode==="infeasible"?"kInfeasible":mode==="unbounded"?"kUnbounded":mode==="time-limit"?"kTimeLimit":"kOptimal",
  objective:3,variables:[1,0],solver_api_status:mode==="api-warning"?"kWarning":"kOk"
};
if(result.model_status!=="kOptimal"){result.objective=null;result.variables=[];}
if(mode==="bad-optimal")result.variables=[1];
process.stdout.write(JSON.stringify(result)+"\n");
`;

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
  await assert.rejects(sdk.runPortfolioOperation("highs","solve-lp",model,{get timeoutS(){return assert.fail("option getter must not run");}}),/data property/);
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
    const duplicatePath=join(bundle.root,"duplicate-model.json");
    await writeFile(duplicatePath,JSON.stringify(model).replace('"sense":"max"','"sense":"max","sense":"min"'));
    const duplicateCli=spawnSync(process.execPath,[
      join(repoRoot,"packages/runner/js/cli.mjs"),
      "portfolio","invoke","highs","solve-lp","--model",duplicatePath
    ],{cwd:repoRoot,encoding:"utf8",timeout:15000,env:{...process.env}});
    assert.equal(duplicateCli.status,2);
    assert.match(duplicateCli.stderr,/DUPLICATE_JSON_KEY:sense/);
    const fifoPath=join(bundle.root,"model.fifo");
    const fifoCreate=spawnSync("mkfifo",[fifoPath],{encoding:"utf8"});
    assert.equal(fifoCreate.status,0,fifoCreate.stderr);
    const fifoCli=spawnSync(process.execPath,[
      join(repoRoot,"packages/runner/js/cli.mjs"),
      "portfolio","invoke","highs","solve-lp","--model",fifoPath
    ],{cwd:repoRoot,encoding:"utf8",timeout:2000,env:{...process.env}});
    assert.equal(fifoCli.error,undefined,"FIFO input must not block before fstat");
    assert.equal(fifoCli.status,2,fifoCli.stderr);
    assert.match(fifoCli.stderr,/regular non-symlink/);
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

test("typed Highs operation rejects invalid statuses, runtime drift, process failures and pin mismatches",async()=>{
  const bundle=await fixtureBundle();
  const oldRoot=process.env.FORMAL_PORTABLE_ROOT;
  const oldPin=process.env.FORMAL_PORTABLE_RUNNER_SHA256;
  const oldMode=process.env.FORMAL_TEST_HIGHS_MODE;
  process.env.FORMAL_PORTABLE_ROOT=bundle.root;
  process.env.FORMAL_PORTABLE_RUNNER_SHA256=bundle.runnerSha;
  const invoke=async(mode,timeoutS=3)=>{
    if(mode===undefined)delete process.env.FORMAL_TEST_HIGHS_MODE;
    else process.env.FORMAL_TEST_HIGHS_MODE=mode;
    return await runPortfolioOperation("highs","solve-lp",model,{timeoutS});
  };
  try{
    for(const status of ["infeasible","unbounded"]){
      const receipt=await invoke(status);
      assert.equal(receipt.status,"T4_OPERATION_EXECUTED_UNREVIEWED",status);
      assert.equal(receipt.solver.model_status,status==="infeasible"?"kInfeasible":"kUnbounded");
      assert.equal(receipt.solver.objective,null);
      assert.deepEqual(receipt.solver.variables,[]);
    }
    const timeLimit=await invoke("time-limit");
    assert.equal(timeLimit.status,"T4_OPERATION_EXECUTED_UNREVIEWED");
    for(const mode of ["malformed","python-drift","numpy-drift","api-warning","bad-optimal","missing-dependency","api-error"]){
      const receipt=await invoke(mode);
      assert.equal(receipt.status,"PORTFOLIO_OPERATION_FAILED",mode);
    }
    const timed=await invoke("timeout",1);
    assert.equal(timed.status,"PORTFOLIO_OPERATION_FAILED");
    assert.equal(timed.process.timed_out,true);
    const overflow=await invoke("overflow",5);
    assert.equal(overflow.status,"PORTFOLIO_OPERATION_FAILED");
    assert.equal(overflow.process.output_limit,true);

    process.env.FORMAL_PORTABLE_RUNNER_SHA256="0".repeat(64);
    const runnerMismatch=await invoke("optimal");
    assert.equal(runnerMismatch.status,"NOT_RUN_FAIL_CLOSED");
    assert.match(runnerMismatch.reason,/PORTABLE_RUNNER_SHA256_MISMATCH/);
    process.env.FORMAL_PORTABLE_RUNNER_SHA256=bundle.runnerSha;

    const scriptPath=join(bundle.root,"tests","highs","solve-lp.py");
    const originalScript=await readFile(scriptPath);
    await writeFile(scriptPath,Buffer.concat([originalScript,Buffer.from("\\n# changed script\\n")]));
    try{
      const scriptMismatch=await invoke("optimal");
      assert.equal(scriptMismatch.status,"NOT_RUN_FAIL_CLOSED");
      assert.match(scriptMismatch.reason,/HIGHS_OPERATION_SCRIPT_SHA256_MISMATCH/);
    }finally{await writeFile(scriptPath,originalScript);}

    const pythonSource=await readFile(join(repoRoot,"portable/verification/cases/highs/solve-lp.py"),"utf8");
    assert.ok(pythonSource.includes('actual_python_version != "3.13.5"'));
    assert.ok(pythonSource.includes("status != highspy.HighsStatus.kOk"));
    const valueValidity=pythonSource.indexOf('if not bool(getattr(solution, "value_valid", False))');
    const valueConsumption=pythonSource.indexOf("values = list(solution.col_value)");
    assert.ok(valueValidity>=0&&valueValidity<valueConsumption,"value_valid must be checked before col_value");
  }finally{
    if(oldRoot===undefined)delete process.env.FORMAL_PORTABLE_ROOT;else process.env.FORMAL_PORTABLE_ROOT=oldRoot;
    if(oldPin===undefined)delete process.env.FORMAL_PORTABLE_RUNNER_SHA256;else process.env.FORMAL_PORTABLE_RUNNER_SHA256=oldPin;
    if(oldMode===undefined)delete process.env.FORMAL_TEST_HIGHS_MODE;else process.env.FORMAL_TEST_HIGHS_MODE=oldMode;
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

function isCiExecution(){
  return Boolean(process.env.CI&&process.env.CI!=="false")||
    process.env.CI_PIPELINE_NUMBER!==undefined||
    process.env.CI_PIPELINE_EVENT!==undefined;
}

function requireCanonicalPython3135(t,probe,ci){
  if(probe.status===0&&probe.stdout.trim()==="3.13.5")return true;
  const detail=(probe.stderr||probe.stdout||probe.error?.message||"python3 unavailable").trim();
  if(ci)throw new Error("CI requires Python 3.13.5 for the value_valid=false regression; "+detail);
  t.skip("local-only skip: canonical Python 3.13.5 unavailable; "+detail);
  return false;
}

test("missing canonical Python fails in CI and is an explicit local-only skip",()=>{
  const wrongVersion={status:0,stdout:"3.13.4",stderr:""};
  assert.throws(
    ()=>requireCanonicalPython3135({skip:()=>assert.fail("CI must not skip")},wrongVersion,true),
    /CI requires Python 3\.13\.5/
  );
  let skipReason="";
  assert.equal(requireCanonicalPython3135({skip:reason=>{skipReason=reason;}},wrongVersion,false),false);
  assert.match(skipReason,/local-only skip/);
});

test("Python Highs operation rejects value_valid=false before reading solution values",async t=>{
  const python=process.env.PYTHON??"python3";
  const probe=spawnSync(python,["-c","import platform; print(platform.python_version())"],{encoding:"utf8",timeout:5000});
  if(!requireCanonicalPython3135(t,probe,isCiExecution()))return;
  const root=await mkdtemp(join(tmpdir(),"ft-highs-invalid-solution-"));
  const fake=join(root,"fake-modules");
  await mkdir(fake,{recursive:true});
  try{
    await writeFile(join(fake,"numpy.py"),[
      '__version__ = "2.5.4"',
      'int32 = "int32"',
      'float64 = "float64"',
      'def arange(size, dtype=None): return list(range(size))',
      'def asarray(values, dtype=None): return list(values)',
      ''
    ].join("\n"));
    await writeFile(join(fake,"highspy.py"),[
      'class _Status:',
      '    def __init__(self, name): self.name = name',
      'class HighsStatus:',
      '    kOk = _Status("kOk")',
      'class HighsModelStatus:',
      '    kOptimal = _Status("kOptimal")',
      '    kInfeasible = _Status("kInfeasible")',
      '    kUnbounded = _Status("kUnbounded")',
      '    kUnboundedOrInfeasible = _Status("kUnboundedOrInfeasible")',
      '    kTimeLimit = _Status("kTimeLimit")',
      'class ObjSense:',
      '    kMaximize = _Status("kMaximize")',
      '    kMinimize = _Status("kMinimize")',
      'kHighsInf = 1e30',
      'class _InvalidSolution:',
      '    value_valid = False',
      '    @property',
      '    def col_value(self):',
      '        raise AssertionError("INVALID_SOLUTION_VECTOR_WAS_READ")',
      'class Highs:',
      '    def version(self): return "1.15.1"',
      '    def setOptionValue(self, *args): return HighsStatus.kOk',
      '    def addVar(self, *args): return HighsStatus.kOk',
      '    def changeColCost(self, *args): return HighsStatus.kOk',
      '    def addRow(self, *args): return HighsStatus.kOk',
      '    def changeObjectiveSense(self, *args): return HighsStatus.kOk',
      '    def run(self): return HighsStatus.kOk',
      '    def getModelStatus(self): return HighsModelStatus.kOptimal',
      '    def getSolution(self): return _InvalidSolution()',
      '    def getObjectiveValue(self): raise AssertionError("INVALID_OBJECTIVE_WAS_READ")',
      ''
    ].join("\n"));
    const request=join(root,"request.json");
    await writeFile(request,JSON.stringify(model));
    const script=join(repoRoot,"portable/verification/cases/highs/solve-lp.py");
    const result=spawnSync(python,[script,request],{
      cwd:root,encoding:"utf8",timeout:10000,
      env:{...process.env,TMPDIR:root,PYTHONPATH:fake}
    });
    assert.equal(result.error,undefined,result.error?.message);
    assert.equal(result.status,3,result.stderr);
    assert.match(result.stderr,/OPTIMAL_SOLUTION_VALUE_INVALID/);
    assert.doesNotMatch(result.stderr,/INVALID_SOLUTION_VECTOR_WAS_READ|INVALID_OBJECTIVE_WAS_READ/);
    assert.equal(result.stdout.trim(),"");
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});
