import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { artifactDelta,scanArtifactWorkspace,collectGeneratedArtifacts } from "../packages/runner/js/artifact-collector.mjs";

const hash=s=>createHash("sha256").update(s).digest("hex");
async function withWorkspace(run){
  const workspace=await mkdtemp(join(tmpdir(),"formal-artifacts-"));
  try {await run(workspace);}finally{await rm(workspace,{recursive:true,force:true});}
}
test("new and modified files become generated artifacts; unchanged inputs do not",()=>withWorkspace(async workspace=>{
  await writeFile(join(workspace,"model.smt2"),"(check-sat)");
  const before=await scanArtifactWorkspace(workspace);
  await mkdir(join(workspace,"trace"));
  await writeFile(join(workspace,"trace","counterexample.json"),'{"steps":2}');
  await writeFile(join(workspace,"model.smt2"),"(get-model)");
  const result=await collectGeneratedArtifacts(workspace,before);
  assert.equal(result.status,"COMPLETE");
  assert.deepEqual(result.items.map(x=>x.path),["model.smt2","trace/counterexample.json"]);
  assert.equal(result.items[0].sha256,hash("(get-model)"));
  assert.equal(result.items[1].bytes,11);
}));
test("stable SHA and sorted relative paths, no absolute source path leaks",()=>withWorkspace(async workspace=>{
  await writeFile(join(workspace,"z.log"),"end");
  await writeFile(join(workspace,"a.log"),"start");
  const result=await scanArtifactWorkspace(workspace);
  assert.equal(result.status,"COMPLETE");
  assert.deepEqual(result.files.map(x=>x.path),["a.log","z.log"]);
  assert.equal(result.files[0].sha256,hash("start"));
  assert.ok(!JSON.stringify(result).includes(workspace));
}));
test("file-byte limits skip hashing large files and mark result partial",()=>withWorkspace(async workspace=>{
  await writeFile(join(workspace,"small"),"ok");
  await writeFile(join(workspace,"large"),"123456789");
  const result=await scanArtifactWorkspace(workspace,{maxBytes:4});
  assert.equal(result.status,"PARTIAL");
  assert.ok(result.skipped.some(x=>x.path==="large"&&x.reason==="BYTE_LIMIT"));
  assert.ok(result.files.some(x=>x.path==="small"));
}));
test("maxFiles and maxDepth bound enumeration",()=>withWorkspace(async workspace=>{
  await writeFile(join(workspace,"a"),"1");
  await writeFile(join(workspace,"b"),"2");
  await mkdir(join(workspace,"nested"));
  await mkdir(join(workspace,"nested","deep"));
  await writeFile(join(workspace,"nested","deep","x"),"x");
  const result=await scanArtifactWorkspace(workspace,{maxFiles:1,maxDepth:1});
  assert.equal(result.status,"PARTIAL");
  assert.ok(result.skipped.some(x=>x.reason==="FILE_COUNT_LIMIT"));
  assert.ok(result.skipped.some(x=>x.reason==="DEPTH_LIMIT"));
}));
test("directory budget stops thousands of empty-directory work and never returns COMPLETE",()=>withWorkspace(async workspace=>{
  for(let i=0;i<14;i++)await mkdir(join(workspace,"dir-"+String(i).padStart(2,"0")));
  const result=await scanArtifactWorkspace(workspace,{maxDirectories:3});
  assert.equal(result.status,"PARTIAL");
  assert.ok(result.visitedDirectories<=3);
  assert.ok(result.skipped.some(x=>x.reason==="DIRECTORY_LIMIT"));
}));
test("entry budget bounds flat directory iteration without hashing every entry",()=>withWorkspace(async workspace=>{
  for(let i=0;i<14;i++)await writeFile(join(workspace,"f-"+String(i).padStart(2,"0")),"x");
  const result=await scanArtifactWorkspace(workspace,{maxEntries:4});
  assert.equal(result.status,"PARTIAL");
  assert.ok(result.scannedEntries<=4);
  assert.ok(result.files.length<=4);
  assert.ok(result.skipped.some(x=>x.reason==="ENTRY_LIMIT"));
}));
test("skipped-record cap emits a single summary rather than an unbounded list",()=>withWorkspace(async workspace=>{
  for(let i=0;i<6;i++){
    const name="dir-"+i;
    await mkdir(join(workspace,name));
    await mkdir(join(workspace,name,"child"));
  }
  const result=await scanArtifactWorkspace(workspace,{maxDepth:1,maxSkipped:2});
  assert.equal(result.status,"PARTIAL");
  assert.equal(result.skipped.length,2);
  assert.equal(result.skipped.at(-1).reason,"SKIPPED_RECORD_LIMIT");
}));
test("normal scan reports bounded directory and entry counters without changing hashes",()=>withWorkspace(async workspace=>{
  await mkdir(join(workspace,"inner"));
  await writeFile(join(workspace,"inner","x.txt"),"stable");
  const result=await scanArtifactWorkspace(workspace,{maxDirectories:2,maxEntries:2,maxSkipped:2});
  assert.equal(result.status,"COMPLETE");
  assert.equal(result.visitedDirectories,2);
  assert.equal(result.scannedEntries,2);
  assert.equal(result.files[0].sha256,hash("stable"));
}));
test("new scan budgets must be positive and within capped bounds",async()=>{
  await assert.rejects(scanArtifactWorkspace("/tmp",{maxDirectories:0}),/invalid maxDirectories/);
  await assert.rejects(scanArtifactWorkspace("/tmp",{maxEntries:1000001}),/invalid maxEntries/);
  await assert.rejects(scanArtifactWorkspace("/tmp",{maxSkipped:-1}),/invalid maxSkipped/);
});
test("symlink to an outside file is never followed",()=>withWorkspace(async workspace=>{
  const external=await mkdtemp(join(tmpdir(),"formal-external-"));
  try{
    await writeFile(join(external,"secret"),"SECRET");
    try{await symlink(join(external,"secret"),join(workspace,"link"));}
    catch(e){if(["EPERM","EACCES","ENOTSUP"].includes(e.code))return;throw e;}
    const result=await scanArtifactWorkspace(workspace);
    assert.equal(result.status,"PARTIAL");
    assert.ok(result.skipped.some(x=>x.path==="link"&&x.reason==="SYMLINK_SKIPPED"));
    assert.equal(result.files.length,0);
  }finally{await rm(external,{recursive:true,force:true});}
}));
test("directory symlink is not traversed",()=>withWorkspace(async workspace=>{
  const external=await mkdtemp(join(tmpdir(),"formal-external-"));
  try{
    await writeFile(join(external,"outside"),"SECRET");
    try{await symlink(external,join(workspace,"foreign"),"dir");}
    catch(e){if(["EPERM","EACCES","ENOTSUP"].includes(e.code))return;throw e;}
    const result=await scanArtifactWorkspace(workspace);
    assert.ok(result.skipped.some(x=>x.path==="foreign"&&x.reason==="SYMLINK_SKIPPED"));
    assert.equal(result.files.length,0);
  }finally{await rm(external,{recursive:true,force:true});}
}));
test("root symlinks are not accepted as workspace ownership",()=>withWorkspace(async workspace=>{
  const parent=await mkdtemp(join(tmpdir(),"formal-link-"));
  try{
    try{await symlink(workspace,join(parent,"alias"),"dir");}
    catch(e){if(["EPERM","EACCES","ENOTSUP"].includes(e.code))return;throw e;}
    await assert.rejects(scanArtifactWorkspace(join(parent,"alias")),/real directory/);
  }finally{await rm(parent,{recursive:true,force:true});}
}));
test("pure delta rejects malicious paths and incomplete baseline",()=>{
  const good={path:"a.txt",bytes:1,sha256:hash("a")};
  assert.throws(()=>artifactDelta([{...good,path:"../escape"}],[good]),/invalid workspace-relative/);
  assert.throws(()=>artifactDelta([{...good,path:"a\\escape"}],[good]),/invalid workspace-relative/);
  assert.throws(()=>artifactDelta({status:"PARTIAL",files:[good]},[good]),/complete workspace/);
  assert.deepEqual(artifactDelta([good],[good]).items,[]);
});
test("artifact paths reject Windows drive, ADS and reserved-name aliases",()=>{
  const entry={path:"good.json",bytes:1,sha256:hash("a")};
  for(const unsafe of [
    "C:/outside","C:outside","trace:alternate-stream","CON","NUL.txt",
    "nested/COM1","nested/LPT9.log","nested/name.","nested/name ",
    "nested/name?.log"
  ]){
    assert.throws(()=>artifactDelta([{...entry,path:unsafe}],[entry]),
      /invalid workspace-relative artifact path/,unsafe);
  }
  assert.deepEqual(artifactDelta([entry],[entry]).items,[]);
});
test("changing only bytes does not invent proof semantics",()=>{
  const a={path:"out.json",bytes:2,sha256:hash("a")};
  const b={path:"out.json",bytes:3,sha256:hash("changed")};
  const result=artifactDelta([a],[b]);
  assert.equal(result.items.length,1);
  assert.ok(!Object.hasOwn(result,"claim_verdict"));
  assert.ok(!Object.hasOwn(result,"simulation_outcome"));
  assert.equal(result.status,"COMPLETE");
});
test("limits reject NaN, negative and unrealistic scanning budgets",async()=>{
  await assert.rejects(scanArtifactWorkspace("/tmp",{maxBytes:-1}),/invalid maxBytes/);
  await assert.rejects(scanArtifactWorkspace("/tmp",{maxFiles:100000000}),/invalid maxFiles/);
});
