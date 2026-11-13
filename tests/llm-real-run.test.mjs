import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scoreFrozenPairedAB } from "../benchmarks/llm-methods/g5/score-ab.mjs";
import { generateAdsMatrix } from "../benchmarks/llm-methods/g3/ads-native-matrix.mjs";
import {
  PROMPT_TEMPLATE,LLM_ONLY_EVIDENCE,TOOL_EXPLANATION,CONFIG,PROTOCOL_ID,MODEL,ENDPOINT,
  renderPrompt,parseVerdict,costUsd,toolEvidence,bindFaithfulObservations,prepareRun,runArms
} from "../benchmarks/llm-methods/g5/real-paired-run.mjs";

const sha256=x=>createHash("sha256").update(x).digest("hex");
const DRIVER=fileURLToPath(new URL("../benchmarks/llm-methods/g5/real-paired-run.mjs",import.meta.url));
const RECEIPT=JSON.parse(readFileSync(new URL("../validation/ads24-native-2026-11-13/NATIVE_PAIR.json",import.meta.url),"utf8"));

test("G5 real run: one frozen template, identical SHA across arms, prompts differ only in the EVIDENCE slot",()=>{
  assert.equal(CONFIG.prompt_template_sha256,sha256(PROMPT_TEMPLATE));
  const plan=prepareRun();
  for(const c of plan.cases){
    const only=renderPrompt(c.scenario,LLM_ONLY_EVIDENCE);
    const tools=renderPrompt(c.scenario,toolEvidence(c.native));
    assert.equal(only.replace(LLM_ONLY_EVIDENCE,"{EVIDENCE}"),renderPrompt(c.scenario,"{EVIDENCE}"));
    assert.equal(tools.replace(toolEvidence(c.native),"{EVIDENCE}"),renderPrompt(c.scenario,"{EVIDENCE}"));
    assert.notEqual(only,tools);
    assert.ok(tools.includes(c.native.smt2));
    assert.ok(tools.includes(TOOL_EXPLANATION.replace("{STATUS}",c.native.tool_status)));
    assert.ok(only.includes(LLM_ONLY_EVIDENCE)&&!only.includes("(set-logic"));
  }
});

test("G5 real run: verdict parser takes the last exact VERDICT line, malformed output stays UNKNOWN",()=>{
  assert.deepEqual(parseVerdict("reasoning steps\nVERDICT: PASS"),{prediction:"PASS",parse:"ok"});
  assert.equal(parseVerdict("VERDICT: PASS\nfurther reasoning\nVERDICT: FAIL").prediction,"FAIL");
  assert.equal(parseVerdict("VERDICT: FAIL\nVERDICT: UNKNOWN").prediction,"UNKNOWN");
  assert.equal(parseVerdict("VERDICT: PASS\r\n").prediction,"PASS");
  assert.equal(parseVerdict("VERDICT: PASS trailing words").prediction,"UNKNOWN");
  assert.equal(parseVerdict("verdict: pass").prediction,"UNKNOWN");
  assert.equal(parseVerdict("the answer is VERDICT: PASS").prediction,"UNKNOWN");
  assert.equal(parseVerdict("VERDICT:PASS").prediction,"UNKNOWN");
  assert.equal(parseVerdict("no verdict at all").parse,"absent");
  assert.equal(parseVerdict("").parse,"no_content");
  assert.equal(parseVerdict(undefined).prediction,"UNKNOWN");
});

test("G5 real run: stubbed API produces arms the frozen scorer accepts unchanged",async()=>{
  const plan=prepareRun();
  const dir=mkdtempSync(join(tmpdir(),"g5real-"));
  const seen=[];
  const fetchImpl=async(url,init)=>{
    assert.equal(url,ENDPOINT);
    assert.equal(init.method,"POST");
    assert.equal(init.headers.authorization,"Bearer test-key");
    const body=JSON.parse(init.body);
    assert.equal(body.model,MODEL);
    assert.equal(body.temperature,0);
    assert.equal(body.max_tokens,4096);
    assert.ok(!("seed" in body),"seed is a declared control, never sent");
    seen.push(body);
    const i=seen.length-1,expected=plan.cases[i%6].expected;
    return {status:200,text:async()=>JSON.stringify({
      id:"chatcmpl-stub-"+i,object:"chat.completion",created:1700000000+i,
      model:"deepseek-flash",
      choices:[{index:0,message:{role:"assistant",
        content:"Step by step reasoning.\nVERDICT: "+expected},finish_reason:"stop"}],
      usage:{prompt_tokens:120+i,completion_tokens:40+i,total_tokens:160+2*i}})};
  };
  const {baseline,augmented,calls}=await runArms(plan,
    {outDir:dir,env:{DEEPSEEK_API_KEY:"test-key"},fetchImpl});
  assert.equal(calls,12);
  assert.equal(baseline.arm,"LLM_ONLY");
  assert.equal(augmented.arm,"LLM_TOOLS");
  assert.equal(baseline.schema,"formal-tools/llm-ab-observations/0.1");
  assert.equal(baseline.protocol_id,PROTOCOL_ID);
  assert.deepEqual(baseline.config,augmented.config);
  const scored=scoreFrozenPairedAB(JSON.stringify(baseline),JSON.stringify(augmented));
  assert.equal(scored.status,"SCORED_UNATTESTED");
  assert.equal(scored.baseline.correct,6);
  assert.equal(scored.augmented.correct,6);
  for(const row of baseline.observations){
    assert.ok(!("tool_status" in row)&&!("tool_receipt_sha256" in row));
    assert.equal(row.prediction,plan.cases.find(c=>c.case_id===row.case_id).expected);
  }
  for(const row of augmented.observations){
    const c=plan.cases.find(x=>x.case_id===row.case_id);
    assert.equal(row.tool_status,c.native.tool_status);
    assert.equal(row.tool_receipt_sha256,c.native.tool_receipt_sha256);
    assert.ok(["SAT","UNSAT"].includes(row.tool_status));
  }
  for(const row of [...baseline.observations,...augmented.observations]){
    assert.equal(row.cost_usd,costUsd(row.input_tokens,row.output_tokens));
    assert.ok(row.cost_usd>0&&row.cost_usd<1);
    assert.ok(Number.isSafeInteger(row.latency_ms)&&row.latency_ms>=1);
    assert.ok(Number.isSafeInteger(row.input_tokens)&&row.input_tokens>0);
    assert.ok(Number.isSafeInteger(row.output_tokens)&&row.output_tokens>0);
    assert.match(row.raw_trace_sha256,/^[a-f0-9]{64}$/);
  }
  assert.equal(readdirSync(join(dir,"traces")).length,12);
  for(const [arm,obj] of [["LLM_ONLY",baseline],["LLM_TOOLS",augmented]])
    for(const row of obj.observations)
      assert.equal(sha256(readFileSync(join(dir,"traces",arm+"__"+row.case_id+".json"))),
        row.raw_trace_sha256);
  const trace=JSON.parse(readFileSync(
    join(dir,"traces","LLM_ONLY__"+baseline.observations[0].case_id+".json"),"utf8"));
  assert.equal(trace.requested_model,MODEL);
  assert.equal(trace.endpoint,ENDPOINT);
  assert.equal(trace.served_model,"deepseek-flash");
  assert.equal(trace.http_status,200);
  assert.equal(trace.verdict_parse.prediction,baseline.observations[0].prediction);
  assert.ok(trace.request.messages[0].content.startsWith("You are judging"));
  assert.ok(typeof trace.response_body==="string"&&trace.response_body.includes("VERDICT"));
});

test("G5 real run: missing DEEPSEEK_API_KEY aborts non-zero before any call or output",()=>{
  const env={...process.env};
  delete env.DEEPSEEK_API_KEY;
  const r=spawnSync(process.execPath,[DRIVER],{env,encoding:"utf8",timeout:3000});
  assert.ok(!r.error,"driver must exit on its own well inside the 3s bound");
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/DEEPSEEK_API_KEY is not set/);
  assert.ok(!r.stdout.includes("complete"));
});

test("G5 real run: faithful native receipts bind by input hash and forgery aborts",()=>{
  const matrix=generateAdsMatrix();
  const bound=bindFaithfulObservations(matrix,RECEIPT);
  assert.equal(bound.length,6);
  for(const b of bound){
    const obs=RECEIPT.observations.find(o=>o.id===b.id);
    assert.equal(b.input_sha256,obs.input_sha256);
    assert.equal(b.tool_status,obs.status);
    assert.equal(b.tool_receipt_sha256,sha256(JSON.stringify(obs)));
    assert.match(b.tool_receipt_sha256,/^[a-f0-9]{64}$/);
  }
  const forged=JSON.parse(JSON.stringify(RECEIPT));
  forged.observations.find(o=>o.id==="faithful__negative-cycle").input_sha256="0".repeat(64);
  assert.throws(()=>bindFaithfulObservations(matrix,forged),/does not match/);
  const inconclusive=JSON.parse(JSON.stringify(RECEIPT));
  inconclusive.observations.find(o=>o.id==="faithful__negative-cycle").status="UNKNOWN";
  assert.throws(()=>bindFaithfulObservations(matrix,inconclusive),/inconclusive/);
});

test("G5 real run: committed real v2 evidence verifies on any checkout",()=>{
  const evidence=new URL("../validation/llm-ab-real-2026-11-13/",import.meta.url);
  // Identity is the git-object (LF) byte form: EOL-only normalization keeps
  // verification checkout-agnostic while real content edits still mismatch.
  const lfSha256=p=>sha256(Buffer.from(readFileSync(p).toString("utf8").replace(/\r\n/g,"\n"),"utf8"));
  const arms=JSON.parse(readFileSync(new URL("arms.json",evidence),"utf8"));
  assert.equal(arms.protocol_id,"g5-real-paired-deepseek-flash-2026-11-13-v2");
  const fixtureSha=lfSha256(new URL("../benchmarks/llm-methods/r0/spec-fidelity-cases.json",import.meta.url));
  assert.equal(arms.baseline.source_sha256,fixtureSha);
  assert.equal(arms.augmented.source_sha256,fixtureSha);
  let traced=0;
  for(const [arm,obj] of [["LLM_ONLY",arms.baseline],["LLM_TOOLS",arms.augmented]])
    for(const row of obj.observations){
      assert.equal(lfSha256(new URL("traces/"+arm+"__"+row.case_id+".json",evidence)),
        row.raw_trace_sha256);
      traced++;
    }
  assert.equal(traced,12);
  const scored=scoreFrozenPairedAB(JSON.stringify(arms.baseline),JSON.stringify(arms.augmented));
  assert.equal(scored.status,"SCORED_UNATTESTED");
  assert.equal(scored.source_sha256,fixtureSha);
  assert.equal(scored.baseline.correct,6);
  assert.equal(scored.baseline.cases,6);
  assert.equal(scored.augmented.correct,6);
  assert.equal(scored.augmented.cases,6);
  assert.equal(scored.baseline.false_pass,0);
  assert.equal(scored.augmented.false_pass,0);
  assert.equal(scored.deltas.accuracy_all_cases,0);
  assert.ok(Math.abs(scored.deltas.cost_usd-0.000962)<1e-6);
});
