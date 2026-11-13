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
    }));
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
