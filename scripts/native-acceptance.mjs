import { knownTools, doctor, runFixture } from "../packages/runner/js/native.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * One-shot local native acceptance. Does NOT install/download tools or modify CI.
 * Writes receipts to a user-chosen directory (never directly to tracked main).
 * Missing tools and parser gaps are recorded; no invented PASS statuses.
 */
const out=resolve(process.argv[2]||"validation/local-runtime-receipts");
const chosen=process.argv.slice(3);
if(chosen.some(x=>!knownTools().includes(x)))throw new TypeError("unknown tool in local acceptance list");
const tools=chosen.length?chosen:knownTools();
const records=[];
for(const tool of tools){
  const version=await doctor(tool,20);
  const positive=await runFixture(tool,"positive",45);
  const negative=await runFixture(tool,"negative",45);
  records.push({tool,version,positive,negative,
    acceptance:(positive.test_verdict==="PASS"&&negative.test_verdict==="PASS")?"CANDIDATE_FOR_REVIEW":"BLOCK_OR_REPAIR"});
}
const summary={
  schema:"formal-native-local-acceptance/1",written_at:new Date().toISOString(),
  tool_runtime:"ACTUAL_HOST_ATTEMPT",tool_count:records.length,
  candidate:records.filter(x=>x.acceptance==="CANDIDATE_FOR_REVIEW").length,
  blocked:records.filter(x=>x.acceptance!=="CANDIDATE_FOR_REVIEW").length,
  evidence:records,
  warning:"CANDIDATE_FOR_REVIEW requires exact SHA/version and independent CLI semantics review; this script does not claim project-level proof."
};
await mkdir(out,{recursive:true});
await writeFile(resolve(out,"native-acceptance.json"),JSON.stringify(summary,null,2)+"\n");
process.stdout.write(JSON.stringify({output:resolve(out,"native-acceptance.json"),
  tool_count:summary.tool_count,candidate:summary.candidate,blocked:summary.blocked})+"\n");
process.exitCode=summary.blocked?2:0;
