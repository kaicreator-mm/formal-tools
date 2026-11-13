import test from "node:test";
import assert from "node:assert/strict";
import { frozenABManifest, scoreFrozenPairedAB } from "../benchmarks/llm-methods/g5/score-ab.mjs";

const encode=JSON.stringify;
function fixture(){
  const manifest=frozenABManifest();
  const config={model_id:"synthetic-test-only",model_version:"0-test",
    prompt_template_sha256:"a".repeat(64),seed:2026,temperature:0,
    max_output_tokens:512};
  const make=(arm)=>({
    schema:"formal-tools/llm-ab-observations/0.1",arm,
    source_sha256:manifest.source_sha256,protocol_id:"frozen-six-synthetic-metrics-test",
    config,
    observations:manifest.cases.map((c,i)=>{
      const tool=arm==="LLM_TOOLS";
      return {case_id:c.id,case_sha256:c.case_sha256,
        prediction:tool?c.expected:(c.expected==="FAIL"?"PASS":"UNKNOWN"),
        raw_trace_sha256:"b".repeat(64),cost_usd:tool?0.004:0.002,
        latency_ms:tool?200:100,input_tokens:30,output_tokens:12,
        ...(tool?{tool_status:c.expected==="PASS"?"SAT":"UNSAT",
          tool_receipt_sha256:"c".repeat(64)}:{})};
    })
  });
  return {baseline:make("LLM_ONLY"),augmented:make("LLM_TOOLS")};
}
const score=({baseline,augmented})=>scoreFrozenPairedAB(encode(baseline),encode(augmented));

test("G5 frozen A/B scorer counts wrong PASS, UNKNOWN, coverage, cost and latency (synthetic only)",()=>{
  const f=fixture(),m=score(f);
  assert.equal(m.status,"SCORED_UNATTESTED");
  assert.equal(m.g5_accepted,false);
  assert.equal(m.baseline.false_pass,4);
  assert.equal(m.baseline.unknown,2);
  assert.equal(m.baseline.coverage,4/6);
  assert.equal(m.augmented.correct,6);
  assert.equal(m.augmented.false_pass,0);
  assert.equal(m.augmented.coverage,1);
  assert.ok(m.augmented.cost_usd>m.baseline.cost_usd);
  assert.ok(m.augmented.latency_ms>m.baseline.latency_ms);
  assert.equal(m.independent_raw_trace_review,"NOT_RUN");
  // An independently unqualified solver may return SAT while the LLM
  // correctly abstains from an original business-semantic verdict.
  const abstaining=fixture();
  abstaining.augmented.observations[0].prediction="UNKNOWN";
  const scoped=score(abstaining);
  assert.equal(scoped.status,"SCORED_UNATTESTED");
  assert.equal(scoped.augmented.unknown,1);
  assert.equal(scoped.augmented.coverage,5/6);
  assert.equal(scoped.g5_accepted,false);
});
test("G5 fake fairness, missing cases, forged evidence and unbounded inputs fail closed",()=>{
  const f=fixture();
  assert.equal(score({...f,augmented:{...f.augmented,
    config:{...f.augmented.config,temperature:0.5}}}).status,"BLOCKED");
  assert.equal(score({...f,augmented:{...f.augmented,
    observations:f.augmented.observations.slice(1)}}).status,"BLOCKED");
  assert.equal(score({...f,baseline:{...f.baseline,
    observations:f.baseline.observations.map((x,i)=>i===0?{...x,tool_status:"SAT"}:x)}}).status,"BLOCKED");
  assert.equal(score({...f,augmented:{...f.augmented,
    observations:f.augmented.observations.map((x,i)=>i===0?
      {...x,tool_status:"ERROR",prediction:"PASS"}:x)}}).status,"BLOCKED");
  assert.equal(score({...f,baseline:{...f.baseline,source_sha256:"f".repeat(64)}}).status,"BLOCKED");
  assert.equal(score({...f,baseline:{...f.baseline,
    observations:f.baseline.observations.map((x,i)=>i===0?
      {...x,case_sha256:"f".repeat(64)}:x)}}).status,"BLOCKED");
  assert.equal(scoreFrozenPairedAB("x".repeat(300000),encode(f.augmented)).status,"BLOCKED");
});
