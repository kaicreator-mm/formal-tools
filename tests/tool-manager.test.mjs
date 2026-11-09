import test from "node:test";
import assert from "node:assert/strict";
import { toolIds, toolRuntimeProfile, planToolProbe } from "../packages/runner/js/native-catalog.mjs";
import { environmentSearchPlan, inspectInstallation, inspectAllInstallations } from "../packages/runner/js/tool-manager.mjs";

test("one registry defines all 13 native tool IDs, probes and operations",()=>{
  assert.equal(toolIds.length,13);
  assert.equal(new Set(toolIds).size,13);
  assert.equal(toolIds.reduce((a,id)=>a+toolRuntimeProfile(id).operationCount,0),53);
  for(const id of toolIds){
    const p=toolRuntimeProfile(id);
    assert.equal(p.id,id);
    assert.ok(p.runtime.probeArgs.length);
    assert.ok(p.entries.length);
  }
});
test("missing jar and explicit Alloy identity fail closed",async()=>{
  assert.equal((await inspectInstallation("tla-tlc",{env:{PATH:"/usr/bin"},exists:async()=>true})).status,"NEEDS_CONFIGURATION");
  assert.equal((await inspectInstallation("alloy",{env:{PATH:"/usr/bin"},exists:async()=>true})).status,"NEEDS_CONFIGURATION");
  assert.deepEqual(planToolProbe("tla-tlc",{TLA2TOOLS_JAR:"/x/tla.jar"}).argv,
    ["java","-cp","/x/tla.jar","tlc2.TLC","-help"]);
});
test("Linux PATH discovery does not execute or claim runtime proof",async()=>{
  const found=new Set(["/opt/bin/z3"]);
  const output=await inspectInstallation("z3",{env:{PATH:"/opt/bin:/usr/bin"},platform:"linux",exists:async p=>found.has(p)});
  assert.equal(output.status,"FOUND_NOT_PROBED");
  assert.equal(output.executable,"/opt/bin/z3");
  assert.deepEqual(output.argv,["/opt/bin/z3","-version"]);
  assert.equal(output.probe_status,"NOT_RUN");
});
test("honors FORMAL_TOOLS_BIN_DIR and reports missing executable",async()=>{
  const env={PATH:"/usr/bin",FORMAL_TOOLS_BIN_DIR:"/opt/formal"};
  const plan=environmentSearchPlan("z3",{env});
  assert.deepEqual(plan.candidates,["/opt/formal/z3"]);
  const check=await inspectInstallation("z3",{env,exists:async()=>false});
  assert.equal(check.status,"MISSING_EXECUTABLE");
});
test("Windows wrapper is reported unsupported, no automatic shell",async()=>{
  const env={Path:"C:\\tools;C:\\Windows\\system32"};
  const found=new Set(["C:\\tools\\riot.cmd"]);
  const result=await inspectInstallation("apache-jena",{env,platform:"win32",exists:async p=>found.has(p)});
  assert.equal(result.status,"WINDOWS_WRAPPER_UNSUPPORTED");
  assert.equal(result.probe_status,"NOT_RUN");
  assert.equal(result.executable,"C:\\tools\\riot.cmd");
  assert.ok(result.diagnostics.some(s=>s.includes("shell:false")));
});
test("Python modules require real probe after interpreter discovery",async()=>{
  const env={PATH:"/usr/bin",FORMAL_CLINGO_PYTHON:"/opt/venv/bin/python3"};
  const result=await inspectInstallation("clingo",{env,exists:async p=>p==="/opt/venv/bin/python3"});
  assert.equal(result.status,"FOUND_NOT_PROBED");
  assert.deepEqual(result.argv,["/opt/venv/bin/python3","-m","clingo","--help"]);
  assert.ok(result.diagnostics.some(x=>x.includes("Python module")));
});
test("A configured but missing JAR does not yield FOUND",async()=>{
  const env={TLA2TOOLS_JAR:"/missing.jar",PATH:"/usr/bin"};
  const result=await inspectInstallation("tla-tlc",{env,exists:async p=>p==="/usr/bin/java"});
  assert.equal(result.status,"MISSING_DEPENDENCY_FILE");
});
test("All-tool inspection remains static even with all paths mocked present",async()=>{
  const result=await inspectAllInstallations({env:{PATH:"/usr/bin"},exists:async()=>true});
  assert.equal(result.tools,13);
  assert.equal(result.status,"STATIC_ENVIRONMENT_INSPECTION_ONLY");
  assert.equal(result.checks.filter(x=>x.status==="NEEDS_CONFIGURATION").length,2);
});
test("Unknown tool cannot turn into a generic executable",()=>{
  assert.throws(()=>environmentSearchPlan("not-a-tool",{env:{PATH:"/bin"}}));
});
