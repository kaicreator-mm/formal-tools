import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,mkdir,readFile,lstat,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {validateInputManifest,prepareToolWorkspace} from "../packages/runner/js/tool-workspace.mjs";
import {scanArtifactWorkspace,collectGeneratedArtifacts} from "../packages/runner/js/artifact-collector.mjs";

const hash=s=>createHash("sha256").update(s).digest("hex");
const withFiles=async fn=>{
  const src=await mkdtemp(join(tmpdir(),"formal-source-"));
  try{await fn(src);}finally{await rm(src,{recursive:true,force:true});}
};
test("input validation is pure, sorted, and excludes traversal/ambiguous paths",()=>{
  assert.deepEqual(validateInputManifest(["b.smt2","dir/a.smt2"]),["b.smt2","dir/a.smt2"]);
  for(const p of ["../escape","/abs","a\\b","a//b","a/./b","a/../b","C:/bad","a\0b",".",".."])
    assert.throws(()=>validateInputManifest([p]),/invalid source-relative/);
  assert.throws(()=>validateInputManifest(["a","a/b"]),/conflicts/);
  assert.throws(()=>validateInputManifest(["a","a"]),/duplicate/);
  assert.throws(()=>validateInputManifest(["Model.smt2","model.smt2"]),/case-colliding/);
  assert.throws(()=>validateInputManifest(["A","a/sub"]),/conflicts/);
  for(const invalid of ["NUL","CON.txt","COM1","data?.txt","notes. ","a/name."])
    assert.throws(()=>validateInputManifest([invalid]),/invalid source-relative/);
});
test("source file copied with SHA, then generated artifact delta is isolated",()=>withFiles(async src=>{
  await mkdir(join(src,"models"));
  await writeFile(join(src,"models","model.smt2"),"(check-sat)");
  const workspace=await prepareToolWorkspace(src,["models/model.smt2"]);
  try{
    assert.equal(workspace.stagedInputs[0].sha256,hash("(check-sat)"));
    assert.equal(await readFile(join(workspace.root,"models","model.smt2"),"utf8"),"(check-sat)");
    const before=await scanArtifactWorkspace(workspace.root);
    await writeFile(join(workspace.root,"counterexample.trace"),"trace 1");
    const delta=await collectGeneratedArtifacts(workspace.root,before);
    assert.equal(delta.status,"COMPLETE");
    assert.deepEqual(delta.items.map(x=>x.path),["counterexample.trace"]);
    assert.equal(await readFile(join(src,"models","model.smt2"),"utf8"),"(check-sat)");
  }finally{
    await workspace.cleanup();
  }
  await assert.rejects(lstat(workspace.root),{code:"ENOENT"});
}));
test("input source bytes, file count and depth are bounded",()=>withFiles(async src=>{
  await writeFile(join(src,"large"),"more than budget");
  await assert.rejects(prepareToolWorkspace(src,["large"],{maxBytes:4}),/maxBytes/);
  assert.throws(()=>validateInputManifest(["a","b"],{maxFiles:1}),/bounded/);
  assert.throws(()=>validateInputManifest(["a/b/c"],{maxDepth:2}),/maxDepth/);
}));
test("symlink files and directories are never trusted as source inputs",()=>withFiles(async src=>{
  const ext=await mkdtemp(join(tmpdir(),"formal-source-outside-"));
  try{
    await writeFile(join(ext,"outside"),"SECRET");
    try{await symlink(join(ext,"outside"),join(src,"link"));}
    catch(e){if(["EPERM","EACCES","ENOTSUP"].includes(e.code))return;throw e;}
    await assert.rejects(prepareToolWorkspace(src,["link"]),/regular file/);
    try{await symlink(ext,join(src,"external"),"dir");}
    catch(e){if(["EPERM","EACCES","ENOTSUP"].includes(e.code))return;throw e;}
    await assert.rejects(prepareToolWorkspace(src,["external/outside"]),/input directory must be real/);
  }finally{await rm(ext,{recursive:true,force:true});}
}));
test("root symlink cannot be treated as a trusted source root",()=>withFiles(async src=>{
  const outer=await mkdtemp(join(tmpdir(),"formal-source-link-"));
  try{
    await writeFile(join(src,"a"),"x");
    try{await symlink(src,join(outer,"alias"),"dir");}
    catch(e){if(["EPERM","EACCES","ENOTSUP"].includes(e.code))return;throw e;}
    await assert.rejects(prepareToolWorkspace(join(outer,"alias"),["a"]),/real directory/);
  }finally{await rm(outer,{recursive:true,force:true});}
}));
test("missing source and nonregular files fail, without changing source",()=>withFiles(async src=>{
  await assert.rejects(prepareToolWorkspace(src,["not-there"]),{code:"ENOENT"});
  await mkdir(join(src,"directory"));
  await assert.rejects(prepareToolWorkspace(src,["directory"]),/regular file/);
  await assert.rejects(prepareToolWorkspace(src,["directory/missing"]),{code:"ENOENT"});
}));
