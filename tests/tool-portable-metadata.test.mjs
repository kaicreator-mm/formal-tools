import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const original = fileURLToPath(new URL('../portable/packaging/bundle-template/bin/tool-runner', import.meta.url));
function withFixture(meta, run) {
  const root = mkdtempSync(join(tmpdir(), 'ft-portal-meta-'));
  try {
    const bin = join(root, 'bin');
    const dir = join(root, 'tools', 'highs');
    mkdirSync(bin, {recursive:true});
    mkdirSync(dir, {recursive:true});
    copyFileSync(original,join(bin,'tool-runner'));
    chmodSync(join(bin,'tool-runner'),0o755);
    writeFileSync(join(dir,'meta.sh'),meta);
    return run((command,extraEnv={}) => spawnSync('bash',[join(bin,'tool-runner'),command,'highs'], {
      encoding:'utf8',timeout:5000,env:{...process.env,FT_EVIDENCE_DIR:join(root,'receipts'),...extraEnv}
    }), root);
  } finally {
    rmSync(root,{recursive:true,force:true});
  }
}
const good = 'TOOL_ID=highs\nTOOL_VERSION=1.15.1\nTOOL_KIND=unprobed\nUNAVAILABLE=0\n';

test('portable metadata: identity/version/doctor pass when correct', () => {
  withFixture(good, exe => {
    const d=exe('doctor');const v=exe('version');
    assert.equal(d.status,0,d.stderr);assert.match(d.stdout,/doctor: highs .*verdict: OK/s);
    assert.equal(v.status,0,v.stderr);assert.match(v.stdout,/tool: highs\nversion: 1\.15\.1/);
  });
});

test('portable metadata: legacy TOOL_TOOL_ID fails closed for doctor, version, and run', () => {
  withFixture(good.replace('TOOL_ID=','TOOL_TOOL_ID='), exe => {
    for (const cmd of ['doctor','version','run']) {
      const p=exe(cmd);
      assert.equal(p.status,2,`${cmd}: ${p.stderr}`);
      assert.match(p.stderr,/invalid tool metadata/);
      assert.doesNotMatch(p.stdout,/verdict: OK/);
    }
  });
});

test('portable metadata: environment TOOL_ID spoof cannot hide missing ID', () => {
  withFixture(good.replace('TOOL_ID=','TOOL_TOOL_ID='), exe => {
    const p=exe('doctor',{TOOL_ID:'highs'});
    assert.equal(p.status,2,p.stderr);
    assert.match(p.stderr,/invalid tool metadata/);
  });
});

test('portable metadata: foreign identity is rejected before version/doctor', () => {
  withFixture(good.replace('TOOL_ID=highs','TOOL_ID=z3'), exe => {
    for(const cmd of ['doctor','version','run']) {
      const p=exe(cmd);assert.equal(p.status,2,p.stderr);
    }
  });
});

test('portable metadata: missing version or kind is rejected', () => {
  for (const m of [good.replace('TOOL_VERSION=1.15.1',''),good.replace('TOOL_KIND=unprobed','')]) {
    withFixture(m, exe => {
      const p=exe('doctor');assert.equal(p.status,2,p.stderr);
      assert.match(p.stderr,/invalid tool metadata/);
    });
  }
});

test('doctor uses bundled native library directory while still failing on truly absent dependency', () => {
  const meta = good + 'TOOL_MAIN_BIN=tools/highs/bin/highs\n';
  withFixture(meta, (exe, root) => {
    const lib = join(root, 'tools', 'highs', 'lib');
    const binary = join(root, 'tools', 'highs', 'bin');
    const mocks = join(root, 'mockbin');
    mkdirSync(lib, {recursive:true});
    mkdirSync(binary, {recursive:true});
    mkdirSync(mocks, {recursive:true});
    writeFileSync(join(binary, 'highs'), 'test-only binary placeholder');
    const ldd = join(mocks, 'ldd');
    writeFileSync(ldd, [
      '#!/bin/sh',
      'case ":${LD_LIBRARY_PATH:-}:" in',
      '  *:"' + lib + '":*) echo "libsolver.so => ' + lib + '/libsolver.so";;',
      '  *) echo "libsolver.so => not found";;',
      'esac',
      ''
    ].join('\n'));
    chmodSync(ldd, 0o755);
    const env = {PATH:mocks + ':' + process.env.PATH};
    const pass = exe('doctor',env);
    assert.equal(pass.status,0, pass.stdout+pass.stderr);
    assert.match(pass.stdout,/ldd: no missing libs OK/);
    rmSync(lib,{recursive:true,force:true});
    const fail = exe('doctor',env);
    assert.equal(fail.status,1,fail.stdout+fail.stderr);
    assert.match(fail.stdout,/ldd missing libs: 1 FAIL/);
  });
});
