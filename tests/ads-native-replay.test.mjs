import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyAdsNativeObservation, executeAds24 } from "../benchmarks/llm-methods/g3/ads-native-replay.mjs";
import { doctor, executeNativePlan } from "../packages/runner/js/native.mjs";
import { executeAds24Isolated } from "../benchmarks/llm-methods/g3/ads-native-isolated.mjs";
import { planNative } from "../packages/runner/js/native-catalog.mjs";

const sha=b=>createHash("sha256").update(b).digest("hex");
const observed=(stdout,opts={})=>({run_status:"EXECUTED",process_outcome:"EXIT_ZERO",
  executions:[{stdout,stderr:"",exit_code:0,timed_out:false,output_truncated:false,
    ...opts}]});

test("G3 native status parser refuses extra or conflicting stdout and injected stderr",()=>{
 for(const expected of ["sat\n","unsat\n","unknown\n"])
   assert.equal(classifyAdsNativeObservation(observed(expected)),expected.trim().toUpperCase());
 for(const text of ["", "sat\nunsat\n", "unsat\nsat\n", "sat\n(error bad)", "sat arbitrary",
   "prefix sat", "error: SAT"])
   assert.equal(classifyAdsNativeObservation(observed(text)),"ERROR",text);
 assert.equal(classifyAdsNativeObservation(observed("sat\n",{stderr:"warning"})),"ERROR");
 assert.equal(classifyAdsNativeObservation(observed("sat\n",{exit_code:1})),"ERROR");
 assert.equal(classifyAdsNativeObservation(observed("sat\n",{output_truncated:true})),"ERROR");
 assert.equal(classifyAdsNativeObservation(observed("sat\n",{timed_out:true})),"TIMEOUT");
 assert.equal(classifyAdsNativeObservation({run_status:"NOT_RUN"}),"NOT_RUN");
});
test("G3 native replay requires exact pinned binary identity",async()=>{
 await assert.rejects(()=>executeAds24({tool:"z3",binary_dir:"/",expected_binary_sha256:"wrong",
   output_dir:"/tmp/unused"}),/explicit tool/);
});
test("G3 24 actual subprocess observations are NOT semantic Oracle or supply-chain proof",{
  skip:process.platform!=="linux"
},async()=>{
 const root=mkdtempSync(join(tmpdir(),"ft-ads24-native-test-"));
 try{
   const dir=join(root,"bin"),out=join(root,"out");
   mkdirSync(dir);
   // Deliberately fake tool: exercises actual typed runner process path but can
   // never be cited as a Z3 or cvc5 native solver measurement.
   const exe=join(dir,"z3");
   const fake="#!/bin/sh\nif [ \"$1\" = \"-version\" ]; then echo mock-not-z3; exit 0; fi\necho sat; exit 0\n";
   writeFileSync(exe,fake);chmodSync(exe,0o755);
   await assert.rejects(()=>executeAds24({tool:"z3",binary_dir:dir,
      expected_binary_sha256:"0".repeat(64),output_dir:out}),/SHA mismatch/);
   const previousBinDir=process.env.FORMAL_TOOLS_BIN_DIR;
   const result=await executeAds24({tool:"z3",binary_dir:dir,
      expected_binary_sha256:sha(readFileSync(exe)),output_dir:out,timeout_s:5});
   assert.equal(process.env.FORMAL_TOOLS_BIN_DIR,previousBinDir,
     "executeAds24 must restore the process-global tool configuration");
   const receipt=JSON.parse(readFileSync(result.file,"utf8"));
   assert.equal(result.observed,24);
   assert.equal(receipt.receipts.length,24);
   assert.equal(receipt.host_process_attested,false);
   assert.equal(receipt.independent_oracle_review,"NOT_RUN");
   assert.equal(receipt.solution_promotable,false);
   assert.equal(receipt.original_claim_verdict,"UNVERIFIED");
   assert.equal(receipt.scored.status,"SCORED_UNATTESTED");
   assert.ok(receipt.scored.summaries.some(s=>s.diagnostic_classification==="REJECT_WEAK"));
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Shared POSIX fake-tool script template for the per-execution and worker
// isolation tests below, defined once at module scope. R32 CI #1002/#1003
// failed because the worker variant re-typed this template with double
// escapes ("\\n" and \\"), which was simultaneously a file-level JavaScript
// SyntaxError and, had it parsed, a single-line sh comment emitting nothing.
// The fake-tool-scripts regression test at the end of this file pins the
// exact byte shape so a re-escaped variant cannot reach CI again.
const fakeToolScript=(label,status)=>
 "#!/bin/sh\n"+
 "if [ \"$1\" = \"-version\" ]; then echo \""+label+"\"; sleep 0.03; exit 0; fi\n"+
 "sleep 0.003\n"+
 "echo "+status+"\n"+
 "exit 0\n";

// The per-execution environment isolation lives in the typed Native Runner
// (doctor/executeNativePlan accept {env} and resolve executables from that
// environment). The frozen ADS24 replay source is provenance-pinned by the
// recorded receipt and must not be edited to carry behavior, so the isolation
// contract is tested directly against the runner layer here.
test("G3 runner binds concurrent native executions to their own environments",{
  skip:process.platform!=="linux"
},async()=>{
 const root=mkdtempSync(join(tmpdir(),"ft-ads24-concurrent-env-"));
 try{
  const makeTool=(name,status)=>{
   const dir=join(root,name);mkdirSync(dir);
   const exe=join(dir,"z3");
   const script=fakeToolScript("isolated-"+name,status);
   writeFileSync(exe,script);chmodSync(exe,0o755);
   return {dir,sha256:sha(readFileSync(exe))};
  };
  const a=makeTool("arm-a","sat"),b=makeTool("arm-b","unsat");
  const previousBinDir=process.env.FORMAL_TOOLS_BIN_DIR;
  const envA={...process.env,FORMAL_TOOLS_BIN_DIR:a.dir};
  const envB={...process.env,FORMAL_TOOLS_BIN_DIR:b.dir};
  const [da,db]=await Promise.all([
    doctor("z3",5,{env:envA}),
    doctor("z3",5,{env:envB}),
  ]);
  assert.equal(process.env.FORMAL_TOOLS_BIN_DIR,previousBinDir,
    "passing an execution environment must not mutate process-global state");
  assert.match(da.stdout,/isolated-arm-a/);
  assert.match(db.stdout,/isolated-arm-b/);
  const input=join(root,"case.smt2");
  writeFileSync(input,"(set-logic QF_LIA)\n(check-sat)\n");
  const plan=planNative("z3","solve",{input});
  const [sa,sb]=await Promise.all([
    executeNativePlan(plan,{cwd:root,timeout:5,env:envA}),
    executeNativePlan(plan,{cwd:root,timeout:5,env:envB}),
  ]);
  assert.equal(classifyAdsNativeObservation(sa),"SAT");
  assert.equal(classifyAdsNativeObservation(sb),"UNSAT");
 }finally{
  rmSync(root,{recursive:true,force:true});
 }
});

// R31 regression: CI #973/#976/#977/#978 failed here because editing the frozen
// replay source without re-recording the native receipt broke the recorded
// provenance binding. The receipt pins this file's Git blob; any byte change
// must fail closed until a real native re-verification re-records it.
test("G3 frozen ADS24 replay source stays byte-identical to its recorded receipt provenance",()=>{
 const receipt=JSON.parse(readFileSync(
   new URL("../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url),"utf8"));
 const bytes=readFileSync(
   new URL("../benchmarks/llm-methods/g3/ads-native-replay.mjs",import.meta.url))
   .toString("utf8").replace(/\r\n/g,"\n");
 const blob=createHash("sha1").update(Buffer.concat([
   Buffer.from("blob "+Buffer.byteLength(bytes)+"\0"),Buffer.from(bytes,"utf8")])).digest("hex");
 assert.equal(blob,receipt.original_js_runner_replay.source_git_blob);
});

test("G3 concurrent frozen ADS24 orchestrations isolate each worker's native environment",{
  skip:process.platform!=="linux"
},async()=>{
 const root=mkdtempSync(join(tmpdir(),"ft-ads24-worker-env-"));
 try{
  const makeTool=(name,status)=>{
   const dir=join(root,name);mkdirSync(dir);
   const exe=join(dir,"z3");
   const script=fakeToolScript("worker-"+name,status);
   writeFileSync(exe,script);chmodSync(exe,0o755);
   return {dir,sha256:sha(readFileSync(exe))};
  };
  const a=makeTool("arm-a","sat"),b=makeTool("arm-b","unsat");
  const previousBinDir=process.env.FORMAL_TOOLS_BIN_DIR;
  const [ra,rb]=await Promise.all([
   executeAds24Isolated({tool:"z3",binary_dir:a.dir,
     expected_binary_sha256:a.sha256,output_dir:join(root,"out-a"),timeout_s:5}),
   executeAds24Isolated({tool:"z3",binary_dir:b.dir,
     expected_binary_sha256:b.sha256,output_dir:join(root,"out-b"),timeout_s:5})
  ]);
  assert.equal(process.env.FORMAL_TOOLS_BIN_DIR,previousBinDir,
    "isolated worker execution must not mutate the parent process environment");
  const ar=JSON.parse(readFileSync(ra.file,"utf8"));
  const br=JSON.parse(readFileSync(rb.file,"utf8"));
  assert.match(ar.version_probe.output,/worker-arm-a/);
  assert.match(br.version_probe.output,/worker-arm-b/);
  assert.equal(ar.receipts.length,24);
  assert.equal(br.receipts.length,24);
  assert.ok(ar.receipts.every(x=>x.status==="SAT"));
  assert.ok(br.receipts.every(x=>x.status==="UNSAT"));
 }finally{
  rmSync(root,{recursive:true,force:true});
 }
});

// R32 regression: CI #1002/#1003 failed the whole file at module load because
// the worker test's tool script template was re-typed with double escapes
// ("\\" + "\\n"), producing a JavaScript SyntaxError before any test could
// register. The generated scripts must stay one-command-per-line POSIX shell;
// any literal backslash-n or escaped-quote sequence means the template was
// double-escaped again (invalid JS, or a single sh comment line whose empty
// probe output can never satisfy the isolation assertions above).
test("G3 fake native tool scripts remain valid one-command-per-line POSIX templates",()=>{
 const scripts=[fakeToolScript("isolated-arm-a","sat"),
                fakeToolScript("worker-arm-b","unsat")];
 for(const script of scripts){
  const lines=script.split("\n");
  assert.equal(lines[0],"#!/bin/sh","shebang must terminate on a real newline");
  assert.equal(lines[lines.length-1],"","script must end with a newline");
  assert.ok(lines.length>=6,"every statement must sit on its own line");
  assert.ok(!script.includes("\\n")&&!script.includes('\\"'),
    "template must not contain literal backslash-n or escaped-quote sequences");
 }
 assert.match(scripts[0],/^#!\/bin\/sh\nif \[ "\$1" = "-version" \]; then echo "isolated-arm-a";/);
 assert.match(scripts[1],/^#!\/bin\/sh\nif \[ "\$1" = "-version" \]; then echo "worker-arm-b";/);
});
