import test from "node:test";
import assert from "node:assert/strict";
import {
  toolIds,describeNativeTool,planNative,planNativeHelp,planRawNative
} from "../packages/runner/js/native-catalog.mjs";

function validOptions(operation){
  const opts={};
  for(const required of operation.required) opts[required]="model.example";
  for(const [k,desc] of Object.entries(operation.options)){
    if(desc.type==="integer") opts[k]=desc.min;
    else if(desc.type==="enum") opts[k]=desc.values[0];
    else if(desc.type==="bool") opts[k]=true;
    else opts[k]="value";
  }
  return opts;
}
test("13 official CLI tool families registered",()=>assert.equal(toolIds.length,13));
test("every named operation has a generated argv without shell",()=>{
  let count=0;
  for(const tool of toolIds){
    const descriptor=describeNativeTool(tool);
    assert.ok(descriptor.documentation.startsWith("https://"));
    assert.ok(descriptor.entries.length>=1);
    for(const [operation,def] of Object.entries(descriptor.operations)){
      const result=planNative(tool,operation,validOptions(def));
      assert.equal(result.mode,"typed");
      assert.ok(descriptor.entries.includes(result.entry));
      assert.ok(result.args.every(x=>typeof x==="string"&&!x.includes("\0")));
      assert.equal(result.runtime,"NOT_RUN");
      count++;
    }
  }
  assert.equal(count,53);
});
test("native help can discover actual version-specific CLI features",()=>{
  for(const tool of toolIds){
    const d=describeNativeTool(tool);
    const help=planNativeHelp(tool);
    assert.equal(help.tool,tool);
    assert.ok(d.entries.includes(help.entry));
    for(const entry of d.entries) assert.equal(planNativeHelp(tool,entry).entry,entry);
  }
});
test("trusted raw pass-through preserves every argument and no shell",()=>{
  for(const tool of toolIds){
    const entry=describeNativeTool(tool).entries[0];
    const raw=["--flag=value","with spaces","-x","--another"];
    assert.deepEqual(planRawNative(tool,entry,raw).args,raw);
  }
});
test("raw never accepts an executable outside declared tool entries",()=>{
  assert.throws(()=>planRawNative("z3","bash",["-c","echo hello"]));
  assert.throws(()=>planRawNative("apache-jena","cmd.exe",["/C","dir"]));
  assert.throws(()=>planRawNative("../../secret","z3",[]));
  assert.throws(()=>planRawNative("z3","z3",["x\0y"]));
});
test("typed plan rejects unrelated injection and malformed settings",()=>{
  assert.throws(()=>planNative("z3","solve",{input:"x.smt2",shell:"bash"}));
  assert.throws(()=>planNative("cvc5","solve",{input:"x.smt2",models:"true"}));
  assert.throws(()=>planNative("clingo","solve",{input:"x.lp",models:-3}));
  assert.throws(()=>planNative("apalache","check",{input:"x.tla",solver:"unverified-solver"}));
  assert.throws(()=>planNative("vampire","prove",{input:"x.p",mode:"evil"}));
  assert.throws(()=>planNative("z3","solve",{input:""}));
  assert.throws(()=>planNative("z3","missing",{input:"x.smt2"}));
});
test("version-locked command vectors match official samples",()=>{
  assert.deepEqual(planNative("z3","solve",{input:"proof.smt2"}).args,["-smt2","proof.smt2"]);
  assert.deepEqual(planNative("tla-tlc","check",{input:"Spec.tla",config:"Spec.cfg"}).args,["-config","Spec.cfg","Spec.tla"]);
  assert.deepEqual(planNative("apalache","check",{input:"Spec.tla",length:3,inv:"Inv"}).args,["check","--length=3","--inv=Inv","Spec.tla"]);
  assert.deepEqual(planNative("clingo","solve-json",{input:"main.lp",models:0}).args,["--outf=2","--models=0","main.lp"]);
  assert.deepEqual(planNative("apache-jena","query",{data:"data.ttl",query:"query.rq"}).args,["--data","data.ttl","--query","query.rq"]);
  assert.deepEqual(planNative("prob","check",{input:"Counter.mch",bounded:10}).args,["Counter.mch","-mc","10"]);
  assert.deepEqual(planNative("prob","check",{input:"Counter.mch"}).args,["Counter.mch","-model_check"]);
  assert.deepEqual(planNative("dafny","format-check",{input:"Example.dfy"}).args,["format","--check","Example.dfy"]);
});
test("named operations retain CLI-only scope (MCP does not execute native raw)",()=>{
  const raw=planRawNative("z3","z3",["-h"]);
  assert.equal(raw.mode,"LOCAL_CLI_ONLY");
  assert.equal(planNativeHelp("z3").mode,"LOCAL_CLI");
  assert.equal(planNative("z3","solve",{input:"a.smt2"}).mode,"typed");
});
