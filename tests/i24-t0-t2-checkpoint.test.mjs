import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const r1Bytes=readFileSync(new URL("../docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json",import.meta.url));
const r1GitBlob=createHash("sha1").update(Buffer.concat([Buffer.from("blob "+r1Bytes.length+"\0"),r1Bytes])).digest("hex");
const r1=JSON.parse(r1Bytes.toString("utf8"));
const r21=JSON.parse(readFileSync(new URL("../docs/tool-portfolio/r21/I24_T0_T6_36_TOOL_CHECKPOINT.json",import.meta.url),"utf8"));

test("R21 preserves each tool's historical R1 T0/T2 source snapshot",()=>{
  assert.equal(r1GitBlob,"250b84ae0638d98115d748a32ae2f2c9357942b0","R1 source bytes must match the pinned Git blob");
  assert.equal(r1.snapshot_date,"2026-11-12");
  assert.equal(r1.tools.length,36);
  assert.equal(r21.tools.length,36);
  const sourceByIssue=new Map(r1.tools.map(row=>[row.issue,row]));
  assert.equal(sourceByIssue.size,36);
  assert.equal(new Set(r21.tools.map(row=>row.issue)).size,36);
  assert.deepEqual([...r21.tools.map(row=>row.issue)].sort((a,b)=>a-b),Array.from({length:36},(_,i)=>25+i));

  const t0={},t2={};
  for(const row of r21.tools){
    const source=sourceByIssue.get(row.issue);
    assert.ok(source,"missing R1 source row for Issue #"+row.issue);
    const snapshot=row.source_snapshot_status;
    assert.ok(snapshot,"missing source_snapshot_status for Issue #"+row.issue);
    assert.equal(snapshot.ledger,"docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json");
    assert.equal(snapshot.snapshot_date,r1.snapshot_date);
    assert.equal(snapshot.source_blob,r1GitBlob);
    assert.equal(snapshot.T0,source.gate_status.T0,"T0 mismatch for Issue #"+row.issue);
    assert.equal(snapshot.T2,source.gate_status.T2,"T2 mismatch for Issue #"+row.issue);
    t0[snapshot.T0]=(t0[snapshot.T0]??0)+1;
    t2[snapshot.T2]=(t2[snapshot.T2]??0)+1;
  }
  assert.deepEqual(t0,{
    ARCHIVE_SHA_MATCH_PUBLISHER_MANIFEST_ONLY:20,
    NOT_QUALIFIED:16
  });
  assert.deepEqual(t2,{
    PASS_SCOPED_R3:16,
    NOT_QUALIFIED:20
  });
});
