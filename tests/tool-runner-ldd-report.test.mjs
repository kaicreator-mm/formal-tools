import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const source = resolve('portable/packaging/bundle-template/bin/tool-runner');
const isLinux=process.platform==='linux';
function doctorWithLdd(body, expectedStatus, expectedText, mainBin) {
  const root=mkdtempSync(join(tmpdir(),'ft-r14-ldd-contract-'));
  try {
    const bin=join(root,'bin'), tool=join(root,'tools','mock'), mock=join(root,'mockbin');
    mkdirSync(bin,{recursive:true});mkdirSync(join(tool,'bin'),{recursive:true});mkdirSync(mock,{recursive:true});
    copyFileSync(source,join(bin,'tool-runner'));
    chmodSync(join(bin,'tool-runner'),0o755);
    writeFileSync(join(tool,'meta.sh'), 'TOOL_ID=mock\nTOOL_KIND=binary\nTOOL_VERSION=1.0\nTOOL_MAIN_BIN=tools/mock/bin/native\n');
    writeFileSync(join(tool,'bin','native'), mainBin ?? '#!/bin/sh\nexit 0\n');
    chmodSync(join(tool,'bin','native'),0o755);
    writeFileSync(join(mock,'ldd'),'#!/bin/sh\n'+body+'\n');
    chmodSync(join(mock,'ldd'),0o755);
    const p=spawnSync('bash',[join(bin,'tool-runner'),'doctor','mock'],{
      encoding:'utf8',timeout:7000,env:{...process.env,PATH:mock+':'+process.env.PATH,FT_EVIDENCE_DIR:join(root,'receipts')}
    });
    assert.equal(p.status,expectedStatus,p.stderr+'\n'+p.stdout);
    assert.match(p.stdout,expectedText);
    if(expectedStatus!==0)assert.doesNotMatch(p.stdout,/verdict: OK/);
    return p;
  }finally{rmSync(root,{recursive:true,force:true});}
}
const healthy=/ldd: no missing libs OK[\s\S]*verdict: OK/;
const unhealthy=/ldd (?:probe FAILED|missing libs: 1 FAIL)[\s\S]*verdict: FAIL/;

test('ldd real dynamic-loader report with addresses remains healthy',{skip:!isLinux},()=>{
  doctorWithLdd("printf '%s\\n' '  linux-vdso.so.1 (0x00007fff1234)' '  libstdc++.so.6 => /usr/lib/libstdc++.so.6 (0x00007fffbeef)' '  /lib64/ld-linux-x86-64.so.2 (0x00007fffabcd)'",0,healthy);
});
test('unverified ldd static marker on a non-ELF cannot claim a static executable',{skip:!isLinux},()=>{
  doctorWithLdd("echo '  statically linked'; exit 0",1,unhealthy);
});
test('ldd rc0 with malformed diagnostic fails closed',{skip:!isLinux},()=>{
  doctorWithLdd("echo 'ldd: synthetic diagnostic, no dependency table emitted'; exit 0",1,unhealthy);
});
test('ldd valid entry plus diagnostic fails closed',{skip:!isLinux},()=>{
  doctorWithLdd("printf '%s\\n' 'libc.so.6 => /lib/libc.so.6 (0x7f00)' 'ldd: suspicious warning'; exit 0",1,unhealthy);
});
test('ldd rc0 with blank output fails closed',{skip:!isLinux},()=>{
  doctorWithLdd("printf '  \\n'; exit 0",1,unhealthy);
});
test('ldd process errors fail closed even with valid output',{skip:!isLinux},()=>{
  doctorWithLdd("echo 'libc.so.6 => /lib/libc.so.6 (0x7f00)'; exit 42",1,unhealthy);
});
test('ldd truly missing dependency fails closed',{skip:!isLinux},()=>{
  doctorWithLdd("echo 'libmissing.so => not found'; exit 0",1,unhealthy);
});

// Structurally real minimal ELF64-LE image: ELF header + program header table
// only (no sections, no code). doctor never executes MAIN_BIN; it only probes
// dependency metadata, so the header structure is what the gate must judge.
const PT_LOAD=1, PT_INTERP=3, PT_NOTE=4;
function elf64Image(phdrs,{type=2,entry=0x400080,machine=0x3e,loadFlags=5}={}) {
  const eh=Buffer.alloc(64), ph=Buffer.alloc(56*phdrs.length);
  const fileBytes=BigInt(64+56*phdrs.length);
  eh.set([0x7f,0x45,0x4c,0x46, 2, 1, 1, 0]); // magic, ELF64, little-endian, v1
  eh.writeUInt16LE(type, 16); // e_type (ET_REL=1, ET_EXEC=2, ET_DYN=3)
  eh.writeUInt16LE(machine, 18); // e_machine
  eh.writeUInt32LE(1, 20);    // e_version
  eh.writeBigUInt64LE(BigInt(entry), 24); // e_entry
  eh.writeBigUInt64LE(64n, 32); // e_phoff
  eh.writeUInt16LE(64, 52);   // e_ehsize
  eh.writeUInt16LE(56, 54);   // e_phentsize
  eh.writeUInt16LE(phdrs.length, 56); // e_phnum
  eh.writeUInt16LE(64, 58);   // e_shentsize
  phdrs.forEach((t,i)=>{
    ph.writeUInt32LE(t,i*56);
    if(t===PT_LOAD){
      ph.writeUInt32LE(loadFlags,i*56+4); // p_flags
      ph.writeBigUInt64LE(0n,i*56+8); // p_offset
      ph.writeBigUInt64LE(0x400000n,i*56+16); // p_vaddr
      ph.writeBigUInt64LE(fileBytes,i*56+32); // p_filesz
      ph.writeBigUInt64LE(fileBytes,i*56+40); // p_memsz
    }
  });
  return Buffer.concat([eh, ph]);
}
const staticElf=elf64Image([PT_LOAD,PT_NOTE]);
const dynamicElf=elf64Image([PT_LOAD, PT_INTERP, PT_NOTE]);
const relocatableElf=elf64Image([PT_LOAD,PT_NOTE],{type:1,entry:0});
const foreignMachineElf=elf64Image([PT_LOAD,PT_NOTE],{machine:183});
const nonExecutableElf=elf64Image([PT_LOAD,PT_NOTE],{loadFlags:4}); // PF_R without PF_X
const entryOutsideElf=elf64Image([PT_LOAD,PT_NOTE],{entry:0x500000});
// Real GNU ldd behavior on a static ELF (Debian 13 probe 2026-11-14, uid 65534
// identical to root): rc 1, empty stdout, "\tnot a dynamic executable" on stderr.
const gnuLddOnStatic="printf '\\tnot a dynamic executable' >&2; exit 1";
// BusyBox-style/musl trace probe on a static ELF: the env var is ignored and
// the binary just executes (empty output, program's exit code).
const busyboxLddOnStatic='"$@"';

test('header-proven static ELF passes without consulting ldd despite real GNU static report',{skip:!isLinux},()=>{
  const p=doctorWithLdd(gnuLddOnStatic,0,/ldd: static ELF OK[\s\S]*verdict: OK/,staticElf);
  assert.doesNotMatch(p.stdout,/no missing libs/);
});
test('busybox-style trace probe (binary executes) on static ELF still passes',{skip:!isLinux},()=>{
  const p=doctorWithLdd(busyboxLddOnStatic,0,/ldd: static ELF OK[\s\S]*verdict: OK/,staticElf);
  assert.doesNotMatch(p.stdout,/no missing libs/);
});
test('crafted dynamic ELF (PT_INTERP) with real GNU dependency table passes',{skip:!isLinux},()=>{
  doctorWithLdd("printf '%s\\n' '  linux-vdso.so.1 (0x00007fff1234)' '  libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x000076476317d000)' '  /lib64/ld-linux-x86-64.so.2 (0x0000764763383000)'",0,healthy,dynamicElf);
});
test('crafted dynamic ELF with real musl dependency table passes',{skip:!isLinux},()=>{
  doctorWithLdd("printf '%s\\n' '  /lib/ld-musl-x86_64.so.1 (0x757eefc63000)' '  libstdc++.so.6 => /usr/lib/libstdc++.so.6 (0x757ee8c68000)' '  libc.musl-x86_64.so.1 => /lib/ld-musl-x86_64.so.1 (0x7e835bc0c000)'",0,healthy,dynamicElf);
});
test('crafted dynamic ELF with missing dependency fails closed',{skip:!isLinux},()=>{
  doctorWithLdd("printf '%s\\n' '  libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x000076476317d000)' '  libmissing.so.1 => not found'",1,unhealthy,dynamicElf);
});

const hasGcc=isLinux&&spawnSync('gcc',['--version'],{encoding:'utf8'}).status===0;
const hasReadelf=isLinux&&spawnSync('readelf',['--version'],{encoding:'utf8'}).status===0;
test('ET_REL ELF is not a static executable and must use the fail-closed ldd path',{skip:!isLinux},()=>{
  const p=doctorWithLdd("echo 'not a dynamic executable' >&2; exit 1",1,unhealthy,relocatableElf);
  assert.match(p.stdout,/ldd probe FAILED/);
});

test('foreign-machine ET_EXEC cannot use the x86_64 static shortcut',{skip:!isLinux},()=>{
  doctorWithLdd("echo 'not a dynamic executable' >&2; exit 1",1,unhealthy,foreignMachineElf);
});
test('ET_EXEC without an executable PF_X load cannot use the static shortcut',{skip:!isLinux},()=>{
  doctorWithLdd("echo 'not a dynamic executable' >&2; exit 1",1,unhealthy,nonExecutableElf);
});
test('ET_EXEC entry outside every executable file-backed PT_LOAD cannot use the static shortcut',{skip:!isLinux},()=>{
  doctorWithLdd("echo 'not a dynamic executable' >&2; exit 1",1,unhealthy,entryOutsideElf);
});

function compileGcc(outName, flags) {
  const dir=mkdtempSync(join(tmpdir(),'ft-r15-gcc-'));
  try {
    const c=join(dir,'s.c'), out=join(dir,outName);
    writeFileSync(c,'int main(void){return 0;}\n');
    const p=spawnSync('gcc',[...flags,'-o',out,c],{encoding:'utf8',timeout:30000});
    assert.equal(p.status,0,p.stderr);
    return {dir,out};
  } catch(e){ rmSync(dir,{recursive:true,force:true}); throw e; }
}
function compileSharedWithMissingDependency() {
  const dir=mkdtempSync(join(tmpdir(),'ft-r17-missing-needed-'));
  try {
    const dependencySource=join(dir,'missing.c');
    const consumerSource=join(dir,'consumer.c');
    const dependency=join(dir,'libft-missing-dependency.so');
    const out=join(dir,'libconsumer.so');
    writeFileSync(dependencySource,'int ft_missing_dependency(void){return 7;}\n');
    writeFileSync(consumerSource,'extern int ft_missing_dependency(void); int ft_consumer(void){return ft_missing_dependency();}\n');
    const dep=spawnSync('gcc',['-shared','-fPIC','-o',dependency,dependencySource],{encoding:'utf8',timeout:30000});
    assert.equal(dep.status,0,dep.stderr);
    const built=spawnSync('gcc',['-shared','-fPIC','-Wl,--no-as-needed','-L',dir,
      '-Wl,-rpath,$ORIGIN','-o',out,consumerSource,'-lft-missing-dependency'],
      {encoding:'utf8',timeout:30000});
    assert.equal(built.status,0,built.stderr);
    return {dir,out,dependency};
  } catch(e) {
    rmSync(dir,{recursive:true,force:true});
    throw e;
  }
}
function doctorWithRealBin(binPath, expectedStatus, expectedText) {
  const root=mkdtempSync(join(tmpdir(),'ft-r15-real-elf-'));
  try {
    const bin=join(root,'bin'), tool=join(root,'tools','mock');
    mkdirSync(bin,{recursive:true});mkdirSync(join(tool,'bin'),{recursive:true});
    copyFileSync(source,join(bin,'tool-runner'));
    chmodSync(join(bin,'tool-runner'),0o755);
    writeFileSync(join(tool,'meta.sh'),'TOOL_ID=mock\nTOOL_KIND=binary\nTOOL_VERSION=1.0\nTOOL_MAIN_BIN=tools/mock/bin/native\n');
    copyFileSync(binPath,join(tool,'bin','native'));
    chmodSync(join(tool,'bin','native'),0o755);
    // no PATH mock: the host's real ldd is consulted
    const p=spawnSync('bash',[join(bin,'tool-runner'),'doctor','mock'],{
      encoding:'utf8',timeout:7000,env:{...process.env,FT_EVIDENCE_DIR:join(root,'receipts')}
    });
    assert.equal(p.status,expectedStatus,p.stderr+'\n'+p.stdout);
    assert.match(p.stdout,expectedText);
    return p;
  } finally { rmSync(root,{recursive:true,force:true}); }
}
test('real gcc -static ELF passes doctor via header detection (host ldd never trusted for static)',{skip:!hasGcc},()=>{
  const {dir,out}=compileGcc('static', ['-static']);
  try {
    const p=doctorWithRealBin(out,0,/ldd: static ELF OK[\s\S]*verdict: OK/);
    assert.doesNotMatch(p.stdout,/probe FAILED|missing libs/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('real gcc dynamic ELF passes doctor via real system ldd dependency table',{skip:!hasGcc},()=>{
  const {dir,out}=compileGcc('dyn', []);
  try {
    doctorWithRealBin(out,0,/ldd: no missing libs OK[\s\S]*verdict: OK/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('real ET_DYN without PT_INTERP but with DT_NEEDED missing library fails doctor',{skip:!hasGcc||!hasReadelf},()=>{
  const {dir,out,dependency}=compileSharedWithMissingDependency();
  try {
    const header=spawnSync('readelf',['-h',out],{encoding:'utf8'});
    assert.equal(header.status,0,header.stderr);
    assert.match(header.stdout,/Type:\s+DYN/);
    const programHeaders=spawnSync('readelf',['-l',out],{encoding:'utf8'});
    assert.equal(programHeaders.status,0,programHeaders.stderr);
    assert.match(programHeaders.stdout,/DYNAMIC/);
    assert.doesNotMatch(programHeaders.stdout,/\bINTERP\b/);
    const dynamic=spawnSync('readelf',['-d',out],{encoding:'utf8'});
    assert.equal(dynamic.status,0,dynamic.stderr);
    assert.match(dynamic.stdout,/NEEDED.*libft-missing-dependency\.so/);
    // Remove the library after linking: the ET_DYN object retains DT_NEEDED,
    // has no PT_INTERP, and the real host ldd must report the missing library.
    rmSync(dependency);
    const p=doctorWithRealBin(out,1,/ldd missing libs: 1 FAIL[\s\S]*verdict: FAIL/);
    assert.doesNotMatch(p.stdout,/static ELF OK/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

// A lone virtual DSO address never proves the presence of the real loader or libraries.
test('vDSO-only ldd success cannot pass doctor',{skip:!isLinux},()=>{
  doctorWithLdd("echo 'linux-vdso.so.1 (0x00007fff1234)'; exit 0",1,unhealthy);
});
