import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {toolIds} from "../packages/runner/js/native-catalog.mjs";
import {buildCompatibilityMatrix} from "../packages/runner/js/compatibility-matrix.mjs";

const path=new URL("../validation/r1/windows-host-observations.json",import.meta.url);
test("D11: historic real Windows tool inventory preserves exact source-SHA provenance",async()=>{
 const record=JSON.parse(await readFile(path,"utf8"));
 assert.equal(record.schema,"formal-tools/host-observations/1");
 assert.match(record.provenance.run_code_exact_sha,/^[0-9a-f]{40}$/);
 assert.match(record.provenance.source_blob_sha,/^[0-9a-f]{40}$/);
 assert.equal(record.provenance.tool_versions_verified,0);
 assert.equal(record.provenance.fixture_conclusive,0);
 assert.equal(record.observations.length,13);
 assert.deepEqual(new Set(record.observations.map(x=>x.tool_id)),new Set(toolIds));
 assert.equal(record.observations.filter(x=>x.run_status==="NOT_RUN").length,11);
 assert.equal(record.observations.filter(x=>x.run_status==="EXECUTED").length,2);
 assert.ok(record.observations.every(x=>x.git_head===record.provenance.run_code_exact_sha));
});
test("D11: historical unavailable engines remain stale or unreviewed rather than certified",async()=>{
 const record=JSON.parse(await readFile(path,"utf8"));
 const current="3".repeat(40),older=record.provenance.run_code_exact_sha;
 const matrix=buildCompatibilityMatrix({targetHead:current,observations:record.observations});
 assert.equal(matrix.tool_count,13);
 assert.equal(matrix.counts.STALE_SHA,13);
 assert.equal(matrix.counts.REPORTED_UNREVIEWED,0);
 assert.ok(matrix.tools.every(x=>x.observation_status==="STALE_SHA"));
 const historical=buildCompatibilityMatrix({targetHead:older,observations:record.observations});
 assert.equal(historical.counts.REPORTED_UNREVIEWED,13);
 assert.ok(historical.tools.every(x=>x.observation_status==="REPORTED_UNREVIEWED"));
 assert.ok(!Object.hasOwn(matrix,"claim_verdict"));
});
