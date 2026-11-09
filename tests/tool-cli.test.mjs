import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const cli=join(repo,"packages","runner","js","cli.mjs");
function command(args,env={}) {
  const proc=spawnSync(process.execPath,[cli,...args],{
    cwd:repo,env:{...process.env,...env},encoding:"utf8",timeout:15000
  });
  assert.equal(proc.error,undefined,JSON.stringify({args,error:proc.error?.message}));
  return {exitCode:proc.status,json:JSON.parse(proc.stdout),stderr:proc.stderr};
}
test("CLI info is read-only registry introspection",()=>{
  const p=command(["info","z3"]);
  assert.equal(p.exitCode,0,p.stderr);
  assert.equal(p.json.id,"z3");
  assert.deepEqual(p.json.runtime.probeArgs,["-version"]);
});
test("CLI where reports missing binaries with explicit override",()=>{
  const missing=join(repo,"__formal_tools_nonexistent_bin_directory__");
  const p=command(["where","z3"],{FORMAL_TOOLS_BIN_DIR:missing});
  assert.equal(p.exitCode,2,p.stderr);
  assert.equal(p.json.status,"MISSING_EXECUTABLE");
  assert.equal(p.json.probe_status,"NOT_RUN");
});
test("CLI doctor-all is only static inspection unless --probe used",()=>{
  const p=command(["doctor-all"],{FORMAL_TOOLS_BIN_DIR:join(repo,"__formal_tools_no_binaries__")});
  assert.ok([0,2].includes(p.exitCode),p.stderr);
  assert.equal(p.json.status,"STATIC_ENVIRONMENT_INSPECTION_ONLY");
  assert.equal(p.json.tools,13);
  assert.ok(p.json.checks.every(x=>x.probe_status==="NOT_RUN"));
});
test("CLI preserves existing catalog and rejects unknown tool",()=>{
  const ok=command(["catalog","z3"]);
  assert.equal(ok.exitCode,0,ok.stderr);
  assert.equal(ok.json.id,"z3");
  const bad=spawnSync(process.execPath,[cli,"info","not-a-tool"],{cwd:repo,encoding:"utf8"});
  assert.equal(bad.status,2);
  assert.match(bad.stderr,/unknown tool/);
});
