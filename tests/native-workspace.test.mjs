import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runFixture } from "../packages/runner/js/native.mjs";

const repo=resolve(dirname(fileURLToPath(import.meta.url)),"..");
test("native tool writes only beside temporary copies, never into Git fixtures",
  {skip:process.platform==="win32"?"POSIX shebang executable stub":false},async()=>{
    const bin=await mkdtemp(join(tmpdir(),"formal-fakebin-"));
    const prev=process.env.FORMAL_TOOLS_BIN_DIR;
    const marker=".formal-workspace-guard-r4.txt";
    const examples=join(repo,"skills","z3","examples");
    const fake=join(bin,"z3");
    try{
      const source=[
        "#!/usr/bin/env node",
        'const fs=require("node:fs");',
        'const path=require("node:path");',
        'const input=process.argv.at(-1);',
        'fs.writeFileSync(path.join(path.dirname(input),".formal-workspace-guard-r4.txt"),"temporary output");',
        'fs.mkdirSync(path.join(path.dirname(input),"states"),{recursive:true});',
        'fs.writeFileSync(path.join(path.dirname(input),"states","trace"),"temporary output");',
        'process.stdout.write("unsat\\n");'
      ].join("\n")+"\n";
      await writeFile(fake,source);
      await chmod(fake,0o755);
      process.env.FORMAL_TOOLS_BIN_DIR=bin;
      await assert.rejects(access(join(examples,marker)),{code:"ENOENT"});
      const receipt=await runFixture("z3","positive",15);
      assert.equal(receipt.run_status,"EXECUTED",JSON.stringify(receipt));
      assert.equal(receipt.test_verdict,"PASS",JSON.stringify(receipt));
      await assert.rejects(access(join(examples,marker)),{code:"ENOENT"});
    }finally{
      if(prev===undefined)delete process.env.FORMAL_TOOLS_BIN_DIR;
      else process.env.FORMAL_TOOLS_BIN_DIR=prev;
      await rm(bin,{recursive:true,force:true});
    }
  }
);
