import test from "node:test";
import assert from "node:assert/strict";
import { buildCompatibilityMatrix } from "../packages/runner/js/compatibility-matrix.mjs";

const head="a".repeat(40),old="b".repeat(40);
test("matrix derives all tool identities and operation counts from the live catalog",()=>{
  const r=buildCompatibilityMatrix({targetHead:head});
  assert.equal(r.tool_count,13);
  assert.equal(r.typed_operation_count,53);
  assert.deepEqual(r.counts,{NOT_RUN:13,STALE_SHA:0,REPORTED_UNREVIEWED:0});
  assert.equal(new Set(r.tools.map(x=>x.id)).size,13);
  assert.equal(r.tools.find(x=>x.id==="apache-jena").entrypoints.includes("riot"),true);
});
test("old-SHA evidence is explicitly stale, never treated as runtime PASS",()=>{
  const r=buildCompatibilityMatrix({targetHead:head,observations:[{
    tool_id:"z3",git_head:old,platform:"win32",arch:"x64",
    tool_version:"Z3 4.x",run_status:"EXECUTED",evidence_sha256:"a".repeat(64)
  }]});
  assert.equal(r.counts.STALE_SHA,1);
  assert.equal(r.tools.find(x=>x.id==="z3").observation_status,"STALE_SHA");
  assert.ok(!Object.hasOwn(r.tools.find(x=>x.id==="z3"),"test_verdict"));
});
test("same-SHA source report remains unreviewed rather than verified",()=>{
  const r=buildCompatibilityMatrix({targetHead:head,observations:[{
    tool_id:"z3",git_head:head,platform:"linux",arch:"x64",run_status:"EXECUTED"
  }]});
  assert.equal(r.tools.find(x=>x.id==="z3").observation_status,"REPORTED_UNREVIEWED");
  assert.equal(r.status,"SOURCE_CATALOG_WITH_UNREVIEWED_HOST_OBSERVATIONS");
});
test("invalid SHA, unknown tool, duplicate observation and invalid digest fail closed",()=>{
  assert.throws(()=>buildCompatibilityMatrix({targetHead:"main"}),/40-character/);
  assert.throws(()=>buildCompatibilityMatrix({targetHead:head,observations:[{
    tool_id:"oops",git_head:head,platform:"linux",arch:"x64"
  }]}),/unknown tool/);
  const o={tool_id:"z3",git_head:head,platform:"linux",arch:"x64"};
  assert.throws(()=>buildCompatibilityMatrix({targetHead:head,observations:[o,o]}),/duplicate/);
  assert.throws(()=>buildCompatibilityMatrix({targetHead:head,observations:[{...o,evidence_sha256:"bad"}]}),/digest/);
});
