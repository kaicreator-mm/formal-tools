import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const libPath=fileURLToPath(new URL("../portable/builders/lib.sh",import.meta.url));
const buildToolPath=fileURLToPath(new URL("../portable/builders/build-tool.sh",import.meta.url));
const nuxmvPath=fileURLToPath(new URL("../portable/builders/tools/nuxmv.sh",import.meta.url));
const envFor=root=>({
  ...process.env,
  FT_OUT:join(root,"out"),
  FT_TOOL_ID:"builder-metadata-test",
  FT_CACHE:join(root,"cache"),
  FT_LOG:join(root,"build.log")
});
function withLib(run){
  const root=mkdtempSync(join(tmpdir(),"ft-builder-meta-"));
  try{return run(root,envFor(root));}
  finally{rmSync(root,{recursive:true,force:true});}
}
function bash(source,args,env,cwd){
  return spawnSync("bash",["-c",source,"_",...args],{encoding:"utf8",timeout:10000,env,...(cwd?{cwd}:{})});
}

test("builder ELF Machine values normalize to stable architecture identifiers",()=>{
  withLib((root,env)=>{
    const cases=[
      ["Advanced Micro Devices X86-64","x86_64"],
      ["AArch64","aarch64"],
      ["Intel 80386","i386"],
      ["PowerPC64 LE","ppc64le"],
      ["PowerPC64","ppc64"],
      ["RISC-V","riscv"],
      ["ARM","arm"],
      ["Unknown Processor Model","Unknown Processor Model"]
    ];
    for(const [machine,expected] of cases){
      const p=bash('source "$1"; ft::elf_arch "$2"',[libPath,machine],env);
      assert.equal(p.status,0,p.stderr);
      assert.equal(p.stdout.trim(),expected,`Machine=${machine}`);
    }
  });
});

test("builder version probe runs from tool dir with private libraries before inherited paths",()=>{
  withLib((root,env)=>{
    const toolDir=join(root,"tools","nuxmv");
    const libDir=join(toolDir,"lib");
    mkdirSync(libDir,{recursive:true});
    const probe=join(toolDir,"probe");
    writeFileSync(probe,[
      "#!/bin/sh",
      'printf "PWD=%s\\n" "$PWD"',
      'printf "LD_LIBRARY_PATH=%s\\n" "$LD_LIBRARY_PATH"',
      'printf "nuXmv probe marker\\n" >&2',
      "exit 7",
      ""
    ].join("\n"));
    chmodSync(probe,0o755);
    env.LD_LIBRARY_PATH="/existing/private/lib";
    const p=bash('source "$1"; ft::probe_version "$2" "$3"',[libPath,toolDir,"probe"],env);
    assert.equal(p.status,0,p.stderr);
    assert.match(p.stdout,new RegExp("PWD="+toolDir.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
    assert.match(p.stdout,new RegExp("LD_LIBRARY_PATH="+libDir.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+":/existing/private/lib"));
    assert.match(p.stdout,/nuXmv probe marker/);
  });
});

test("builder version probe preserves caller-relative and empty LD_LIBRARY_PATH components after changing cwd",()=>{
  withLib((root,env)=>{
    const callerDir=join(root,"caller");
    const relativeLib=join(callerDir,"relative","lib");
    const toolDir=join(root,"tools","nuxmv");
    const privateLib=join(toolDir,"lib");
    mkdirSync(relativeLib,{recursive:true});
    mkdirSync(privateLib,{recursive:true});
    const probe=join(toolDir,"probe");
    writeFileSync(probe,[
      "#!/bin/sh",
      'printf "PWD=%s\\n" "$PWD"',
      'printf "LD_LIBRARY_PATH=%s\\n" "$LD_LIBRARY_PATH"',
      'printf "relative-path probe marker\\n" >&2',
      "exit 7",
      ""
    ].join("\n"));
    chmodSync(probe,0o755);
    env.LD_LIBRARY_PATH="relative/lib::/existing/absolute";
    const p=bash('source "$1"; ft::probe_version "$2" "$3"',[libPath,toolDir,"probe"],env,callerDir);
    assert.equal(p.status,0,p.stderr);
    assert.ok(p.stdout.includes("PWD="+toolDir),p.stdout);
    const expected=[privateLib,relativeLib,callerDir,"/existing/absolute"].join(":");
    assert.ok(p.stdout.includes("LD_LIBRARY_PATH="+expected),p.stdout);
    assert.match(p.stdout,/relative-path probe marker/);
  });
});

test("shared build driver uses normalized ELF helper and private-library probe helper",()=>{
  const source=readFileSync(buildToolPath,"utf8");
  assert.match(source,/ver_out=\$\(ft::probe_version "\$FT_TOOL_DIR" "\$\{FT_PROBE\[@\]\}"\)/);
  assert.match(readFileSync(libPath,"utf8"),/ft::absolutize_path_list/);
  assert.match(source,/elf_machine=\$\(readelf -h/);
  assert.match(source,/elf_arch=\$\(ft::elf_arch "\$elf_machine"\)/);
  assert.doesNotMatch(source,/awk '\/Machine:\/\{print \$2\}'/);
});

test("nuXmv version metadata probe uses the relocation-aware run shim",()=>{
  const source=readFileSync(nuxmvPath,"utf8");
  assert.match(source,/^FT_PROBE=\(run -h\)$/m);
});
