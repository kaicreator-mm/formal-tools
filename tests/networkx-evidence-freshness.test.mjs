import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  assess, validateBaseline, FIELDS, SOURCE_PIN_FIELDS, DEPENDENCIES,
  BASELINE_SCHEMA, OBSERVATION_SCHEMA
} from '../scripts/tool-portfolio/networkx-evidence-freshness.mjs';

const baselinePath = fileURLToPath(new URL('../docs/tool-portfolio/r126/NETWORKX_T6_EVIDENCE_FRESHNESS.json', import.meta.url));
const assessorPath = fileURLToPath(new URL('../scripts/tool-portfolio/networkx-evidence-freshness.mjs', import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const clone = o => structuredClone(o);
function observed() {
  return { schema: OBSERVATION_SCHEMA, toolId: 'networkx', identity: clone(baseline.identity), sourcePins: clone(baseline.sourcePins) };
}
const replaceSha = s => (s[0] === 'a' ? 'b' : 'a') + s.slice(1);

// All tests operate on simulated observations; they do not grant real native qualifications.
test('exact baseline pins and lifecycle exclusion are well-formed', () => {
  assert.equal(BASELINE_SCHEMA, baseline.schema);
  assert.doesNotThrow(() => validateBaseline(baseline));
  assert.equal(Object.keys(SOURCE_PIN_FIELDS).length, 12);
  assert.equal(FIELDS.length, Object.keys(baseline.identity).length);
  assert.deepEqual(Object.keys(DEPENDENCIES), ['T0','T1','T2','T3','T4','T5','T6']);
  assert.deepEqual(baseline.qualification, Object.fromEntries(Object.keys(DEPENDENCIES).map(k => [k,false])));
  assert.equal(baseline.identity.sourceArchivePublisherSha256, null);
  assert.equal(baseline.identity.pythonRuntimeSha256, null);
  assert.equal(baseline.identity.t5OracleBlob, null);
});

test('exact observation is FRESH_UNQUALIFIED, never a T6 PASS', () => {
  const result = assess(baseline, observed());
  assert.equal(result.status, 'FRESH_UNQUALIFIED');
  assert.equal(result.externalSourceVerification, 'UNVERIFIED_EXTERNAL_GIT_READBACK');
  assert.match(result.limitations, /not authenticated against the current Git tree/);
  assert.equal(result.qualificationGranted, false);
  assert.ok(Object.values(result.qualification).every(x => x === false));
  assert.ok(result.unknownFields.includes('pythonRuntimeSha256'));
  assert.equal(result.reverifyRequired, false);
});

test('upstream source version drift propagates to dependent gates, never grants a gate', () => {
  const o = observed(); o.identity.version = '3.8';
  const r = assess(baseline,o);
  assert.equal(r.status, 'STALE_REVERIFY_REQUIRED');
  assert.deepEqual(r.reverifyGates, ['T0','T1','T3','T4','T5','T6']);
  assert.deepEqual(r.changedFields, ['version']);
  assert.equal(r.qualification.T6, false);
});

test('archive SHA drift invalidates T0 through T6, including reproducible T1', () => {
  const o=observed(); o.identity.archiveSha256=replaceSha(o.identity.archiveSha256);
  const r=assess(baseline,o);
  assert.deepEqual(r.reverifyGates,['T0','T1','T2','T3','T4','T5','T6']);
  assert.equal(r.status,'STALE_REVERIFY_REQUIRED');
});

test('NEW archive SHA provenance forces source, build, install, native, integration and semantic review', () => {
  const b=clone(baseline); b.identity.archiveSha256=null;
  const o=observed();
  const r=assess(b,o);
  assert.equal(r.status,'NEW_EVIDENCE_REVIEW_REQUIRED');
  assert.deepEqual(r.newEvidenceFields,['archiveSha256']);
  assert.deepEqual(r.reverifyGates,['T0','T1','T2','T3','T4','T5','T6']);
  assert.ok(Object.values(r.qualification).every(x => x === false));
});

test('null archive SHA is incomplete and triggers T1 rather than inheriting old build result', () => {
  const o=observed(); o.identity.archiveSha256=null;
  const r=assess(baseline,o);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.ok(r.incompleteFields.includes('archiveSha256'));
  assert.deepEqual(r.reverifyGates,['T0','T1','T2','T3','T4','T5','T6']);
  assert.equal(r.qualification.T1,false);
});

test('missing archive SHA does not silently reuse a prior reproducible build', () => {
  const o=observed(); delete o.identity.archiveSha256;
  const r=assess(baseline,o);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.ok(r.incompleteFields.includes('archiveSha256'));
  assert.deepEqual(r.reverifyGates,['T0','T1','T2','T3','T4','T5','T6']);
  assert.equal(r.qualificationGranted,false);
});

test('changed git source Blob, with identity/pin both updated, invalidates affected gates', () => {
  const o=observed(), path='portable/verification/cases/networkx/pos.py';
  o.sourcePins[path]=replaceSha(o.sourcePins[path]);
  o.identity.posBlob=o.sourcePins[path];
  const r=assess(baseline,o);
  assert.deepEqual(r.changedFields,['posBlob']);
  assert.deepEqual(r.reverifyGates,['T3','T4','T5','T6']);
});

test('installed executable package drift invalidates native, integration, and semantic consumers', () => {
  const base=clone(baseline); base.identity.installedPackageTreeSha256='a'.repeat(64);
  const o={schema:OBSERVATION_SCHEMA, toolId:'networkx', identity:clone(base.identity), sourcePins:clone(base.sourcePins)};
  o.identity.installedPackageTreeSha256='b'.repeat(64);
  const r=assess(base,o);
  assert.equal(r.status,'STALE_REVERIFY_REQUIRED');
  assert.deepEqual(r.changedFields,['installedPackageTreeSha256']);
  assert.deepEqual(r.reverifyGates,['T2','T3','T4','T5','T6']);
  assert.equal(r.qualificationGranted,false);
});

test('new, null and missing installed-package SHA remain fail-closed', () => {
  const o=observed(); o.identity.installedPackageTreeSha256='c'.repeat(64);
  let r=assess(baseline,o);
  assert.equal(r.status,'NEW_EVIDENCE_REVIEW_REQUIRED');
  assert.deepEqual(r.reverifyGates,['T2','T3','T4','T5','T6']);
  assert.equal(r.qualification.T5,false);

  const base=clone(baseline); base.identity.installedPackageTreeSha256='a'.repeat(64);
  const nul={schema:OBSERVATION_SCHEMA, toolId:'networkx', identity:clone(base.identity), sourcePins:clone(base.sourcePins)};
  nul.identity.installedPackageTreeSha256=null;
  r=assess(base,nul);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.ok(r.incompleteFields.includes('installedPackageTreeSha256'));
  assert.deepEqual(r.reverifyGates,['T2','T3','T4','T5','T6']);

  const missing=observed(); delete missing.identity.installedPackageTreeSha256;
  r=assess(baseline,missing);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.ok(r.incompleteFields.includes('installedPackageTreeSha256'));
  assert.deepEqual(r.reverifyGates,['T2','T3','T4','T5','T6']);
});

test('reproducible build-artifact identity changes invalidate install and all consumers', () => {
  const base=clone(baseline); base.identity.reproduciblePackageTreeSha256='a'.repeat(64);
  const o={schema:OBSERVATION_SCHEMA, toolId:'networkx', identity:clone(base.identity), sourcePins:clone(base.sourcePins)};
  o.identity.reproduciblePackageTreeSha256='b'.repeat(64);
  const stale=assess(base,o);
  assert.equal(stale.status,'STALE_REVERIFY_REQUIRED');
  assert.deepEqual(stale.reverifyGates,['T1','T2','T3','T4','T5','T6']);
  const newly=observed(); newly.identity.reproduciblePackageTreeSha256='c'.repeat(64);
  const r=assess(baseline,newly);
  assert.equal(r.status,'NEW_EVIDENCE_REVIEW_REQUIRED');
  assert.deepEqual(r.reverifyGates,['T1','T2','T3','T4','T5','T6']);
  assert.ok(Object.values(r.qualification).every(v=>v===false));
});

test('co-mutating caller-supplied baseline and observation never claims external Git readback', () => {
  const forged=clone(baseline);
  const path='portable/builders/tools/networkx.sh', sha='b'.repeat(40);
  forged.sourcePins[path]=sha; forged.identity.builderBlob=sha;
  const o={schema:OBSERVATION_SCHEMA,toolId:'networkx',identity:clone(forged.identity),sourcePins:clone(forged.sourcePins)};
  const r=assess(forged,o);
  assert.equal(r.status,'FRESH_UNQUALIFIED');
  assert.equal(r.externalSourceVerification,'UNVERIFIED_EXTERNAL_GIT_READBACK');
  assert.equal(r.qualificationGranted,false);
});

test('source-audit Blob mutation makes T0 and T6 stale', () => {
  const o=observed(), path='docs/tool-portfolio/r22/NETWORKX_T0_SOURCE_AUDIT.json';
  o.identity.sourceAuditEvidenceBlob=o.sourcePins[path]=replaceSha(o.sourcePins[path]);
  assert.deepEqual(assess(baseline,o).reverifyGates,['T0','T6']);
});

test('changed runner Git Blob invalidates T3/T4/T6 even with unchanged version', () => {
  const o=observed(), path='portable/packaging/bundle-template/bin/tool-runner';
  o.identity.runnerBlob=o.sourcePins[path]=replaceSha(o.sourcePins[path]);
  const r=assess(baseline,o);
  assert.deepEqual(r.reverifyGates,['T3','T4','T6']);
});

test('missing known identity never inherits baseline PASS', () => {
  const o=observed(); delete o.identity.archiveSha256;
  const r=assess(baseline,o);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.ok(r.incompleteFields.includes('archiveSha256'));
  assert.equal(r.qualificationGranted,false);
});

test('known source pin cannot silently become null', () => {
  const o=observed(); o.identity.version=null;
  const r=assess(baseline,o);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.ok(r.incompleteFields.includes('version'));
});

test('omitted sourcePin causes INCOMPLETE and dependent gate replay', () => {
  const o=observed(); delete o.sourcePins['portable/verification/cases/networkx/err.py'];
  const r=assess(baseline,o);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.ok(r.incompleteFields.some(s => s.includes('err.py')));
  assert.deepEqual(r.reverifyGates,['T3','T4','T5','T6']);
});

test('new runtime SHA is review-required evidence, not a full T1/T4 qualification', () => {
  const o=observed(); o.identity.pythonRuntimeSha256='c'.repeat(64);
  const r=assess(baseline,o);
  assert.equal(r.status,'NEW_EVIDENCE_REVIEW_REQUIRED');
  assert.ok(r.newEvidenceFields.includes('pythonRuntimeSha256'));
  assert.deepEqual(r.reverifyGates,['T1','T2','T3','T4','T5','T6']);
  assert.ok(Object.values(r.qualification).every(v => v === false));
});

test('new Oracle blob requires separate T5/T6 verification; unknown existing remains UNKNOWN', () => {
  const o=observed(); o.identity.t5OracleBlob='d'.repeat(40);
  const r=assess(baseline,o);
  assert.deepEqual(r.reverifyGates,['T5','T6']);
  assert.ok(r.unknownFields.includes('t5OracleAuthority'));
  assert.equal(r.qualification.T5,false);
});

test('source pin/identity inconsistency is rejected, not silently marked FRESH', () => {
  const o=observed(); o.sourcePins['portable/builders/tools/networkx.sh']=replaceSha(o.sourcePins['portable/builders/tools/networkx.sh']);
  assert.throws(()=>assess(baseline,o),/does not match identity/);
});

test('unknown extra keys, incorrect identity, invalid SHA and fake baseline qualification are rejected', () => {
  const a=observed(); a.identity.ghost='foo'; assert.throws(()=>assess(baseline,a),/unexpected key/);
  const b=observed(); b.toolId='alloy'; assert.throws(()=>assess(baseline,b),/schema\/tool mismatch/);
  const c=observed(); c.identity.upstreamCommit='evil'; assert.throws(()=>assess(baseline,c),/invalid upstreamCommit/);
  const d=clone(baseline); d.qualification.T6=true; assert.throws(()=>assess(d,observed()),/deny all seven/);
});

test('malformed baseline and missing pin cannot manufacture a qualified result', () => {
  const d=clone(baseline); d.sourcePins['portable/builders/tools/networkx.sh']='0'.repeat(40);
  assert.throws(()=>validateBaseline(d),/does not match identity/);
  const e=clone(baseline); delete e.sourcePins['portable/builders/tools/networkx.sh'];
  assert.throws(()=>validateBaseline(e),/missing key/);
});

test('CLI exit contracts FRESH=0, STALE=2, INCOMPLETE=3, NEW_EVIDENCE=4, BAD_INPUT=5', () => {
  const root=mkdtempSync(join(tmpdir(),'ft-networkx-freshness-'));
  try {
    const obsPath=join(root,'observation.json');
    const run=o=>{
      writeFileSync(obsPath,JSON.stringify(o));
      return spawnSync(process.execPath,[assessorPath,'--baseline',baselinePath,'--observed',obsPath],{encoding:'utf8'});
    };
    let a=run(observed());assert.equal(a.status,0,a.stderr);assert.equal(JSON.parse(a.stdout).qualificationGranted,false);
    const drift=observed();drift.identity.version='3.8';a=run(drift);assert.equal(a.status,2,a.stderr);
    const incomplete=observed();delete incomplete.identity.version;a=run(incomplete);assert.equal(a.status,3,a.stderr);
    const freshUnknown=observed();freshUnknown.identity.sourceArchivePublisherSha256='e'.repeat(64);a=run(freshUnknown);assert.equal(a.status,4,a.stderr);
    const wrong=observed();wrong.identity.notInContract='x';a=run(wrong);assert.equal(a.status,5);assert.match(a.stderr,/NETWORKX_T6_ASSESSOR_ERROR/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
