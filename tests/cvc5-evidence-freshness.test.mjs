import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assess, validateBaseline, GATE_DEPENDENCIES, SOURCE_PIN_FIELDS, OBSERVATION_SCHEMA } from '../scripts/tool-portfolio/cvc5-evidence-freshness.mjs';

const baselineFile = fileURLToPath(new URL('../docs/tool-portfolio/r142/CVC5_T6_EVIDENCE_FRESHNESS.json', import.meta.url));
const cliFile = fileURLToPath(new URL('../scripts/tool-portfolio/cvc5-evidence-freshness.mjs', import.meta.url));
const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
const clone = value => structuredClone(value);
const observed = () => ({schema:OBSERVATION_SCHEMA, toolId:'cvc5',
  identity:clone(baseline.identity),sourcePins:clone(baseline.sourcePins)});
const changeSha = sha => (sha[0]==='a' ? 'b' : 'a') + sha.slice(1);
const gates = ['T0','T1','T2','T3','T4','T5','T6'];
const allFalse = outcome => assert.deepEqual(outcome.qualification,
  Object.fromEntries(gates.map(x=>[x,false])));
test('baseline binds known historical Git pins, distinguishes generated from original archive', () => {
  assert.doesNotThrow(()=>validateBaseline(baseline));
  assert.equal(Object.keys(SOURCE_PIN_FIELDS).length,15);
  assert.deepEqual(Object.keys(GATE_DEPENDENCIES),gates);
  assert.notEqual(baseline.identity.originalArchiveSha256,baseline.identity.buildPackageSha256);
  assert.equal(baseline.identity.publisherArchiveSha256,null);
  assert.equal(baseline.identity.oracleEvidenceBlob,null);
  assert.equal(baseline.qualification.T6,false);
});
test('exact observation is not externally authenticated or fully qualified', () => {
  const r=assess(baseline,observed());
  assert.equal(r.status,'FRESH_UNQUALIFIED');
  assert.equal(r.reverifyRequired,false);
  assert.equal(r.externalSourceVerification,'UNVERIFIED_EXTERNAL_GIT_READBACK');
  assert.equal(r.qualificationGranted,false);
  assert.ok(r.unknownFields.includes('oracleEvidenceBlob'));
  allFalse(r);
});
test('original source archive drift invalidates all T0..T6 including build and semantic consumers', () => {
  const o=observed(); o.identity.originalArchiveSha256=changeSha(o.identity.originalArchiveSha256);
  const r=assess(baseline,o);
  assert.equal(r.status,'STALE_REVERIFY_REQUIRED');
  assert.deepEqual(r.reverifyGates,gates);
  allFalse(r);
});
test('generated package bytes and installed binary bytes invalidate build+all downstream gates', () => {
  for(const key of ['buildPackageSha256','installedBinarySha256']) {
    const o=observed(); o.identity[key]=changeSha(o.identity[key]);
    const r=assess(baseline,o);
    assert.equal(r.status,'STALE_REVERIFY_REQUIRED');
    assert.deepEqual(r.reverifyGates,['T1','T2','T3','T4','T5','T6']);
    allFalse(r);
  }
});
test('new publisher digest cannot convert historic producer match into source qualification', () => {
  const o=observed(); o.identity.publisherArchiveSha256='a'.repeat(64);
  const r=assess(baseline,o);
  assert.equal(r.status,'NEW_EVIDENCE_REVIEW_REQUIRED');
  assert.deepEqual(r.reverifyGates,['T0','T1','T6']);
  assert.equal(r.qualification.T0,false); allFalse(r);
});
test('changed, new, null and missing archive pins all fail closed', () => {
  const sha=baseline.identity.originalArchiveSha256;
  const oldNull=clone(baseline); oldNull.identity.originalArchiveSha256=null;
  let r=assess(oldNull,observed());
  assert.equal(r.status,'NEW_EVIDENCE_REVIEW_REQUIRED');
  assert.deepEqual(r.reverifyGates,gates); allFalse(r);
  const nullObs=observed(); nullObs.identity.originalArchiveSha256=null;
  r=assess(baseline,nullObs);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.ok(r.incompleteFields.includes('originalArchiveSha256'));
  assert.deepEqual(r.reverifyGates,gates); allFalse(r);
  const missing=observed(); delete missing.identity.originalArchiveSha256;
  r=assess(baseline,missing);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.deepEqual(r.reverifyGates,gates); allFalse(r);
  assert.equal(sha.length,64);
});
test('changed native fixture invalidates native, integration, business and maintain receipts', () => {
  const o=observed(),path='portable/verification/cases/cvc5/pos.smt2';
  o.sourcePins[path]=changeSha(o.sourcePins[path]); o.identity.posBlob=o.sourcePins[path];
  const r=assess(baseline,o);
  assert.equal(r.status,'STALE_REVERIFY_REQUIRED');
  assert.deepEqual(r.reverifyGates,['T3','T4','T5','T6']); allFalse(r);
});
test('changed Runner and MCP source pin invalidate T3/T4 or only T4, always T6', () => {
  const cases=/** @type {[string,string[],string][]} */([
    ['portable/packaging/bundle-template/bin/tool-runner',['T3','T4','T6'],'runnerBlob'],
    ['packages/runner/js/mcp.mjs',['T4','T6'],'mcpBlob']
  ]);
  for(const [path,expected,field] of cases) {
    const o=observed(); o.sourcePins[path]=changeSha(o.sourcePins[path]);
    o.identity[field]=o.sourcePins[path];
    assert.deepEqual(assess(baseline,o).reverifyGates,expected);
  }
});
test('missing or inconsistent pinned Git path rejects stale identity replay', () => {
  const path='packages/runner/js/cli.mjs',o=observed();
  delete o.sourcePins[path];
  const r=assess(baseline,o);
  assert.equal(r.status,'INCOMPLETE_OBSERVATION');
  assert.deepEqual(r.reverifyGates,['T4','T6']);
  const invalid=observed(); invalid.sourcePins[path]='b'.repeat(40);
  assert.throws(()=>assess(baseline,invalid),/does not match/);
});
test('nonincremental regression contract drift invalidates T4 and T6', () => {
  const o=observed(),path='tests/cvc5-incremental-failclosed.test.mjs';
  o.sourcePins[path]=changeSha(o.sourcePins[path]);
  o.identity.nonincrementalTestBlob=o.sourcePins[path];
  assert.deepEqual(assess(baseline,o).reverifyGates,['T4','T6']);
});
test('new Oracle provenance is review-required, not accepted business meaning', () => {
  const o=observed(); o.identity.oracleEvidenceBlob='a'.repeat(40);
  const r=assess(baseline,o);
  assert.equal(r.status,'NEW_EVIDENCE_REVIEW_REQUIRED');
  assert.deepEqual(r.reverifyGates,['T5','T6']); allFalse(r);
});
test('co-mutated caller baseline remains FRESH_UNQUALIFIED rather than external Git attestation', () => {
  const b=clone(baseline),path='portable/builders/tools/cvc5.sh';
  b.sourcePins[path]='b'.repeat(40);b.identity.builderBlob=b.sourcePins[path];
  const o={schema:OBSERVATION_SCHEMA,toolId:'cvc5',identity:clone(b.identity),sourcePins:clone(b.sourcePins)};
  const r=assess(b,o);
  assert.equal(r.status,'FRESH_UNQUALIFIED');
  assert.equal(r.externalSourceVerification,'UNVERIFIED_EXTERNAL_GIT_READBACK');allFalse(r);
});
test('tampered qualification, unexpected properties and malformed digest fail closed',()=>{
  const forged=clone(baseline);forged.qualification.T4=true;
  assert.throws(()=>assess(forged,observed()),/must not claim/);
  const extra=observed();extra.identity.unauthorized='success';
  assert.throws(()=>assess(baseline,extra),/unexpected key/);
  const malformed=observed();malformed.identity.buildPackageSha256='bad';
  assert.throws(()=>assess(baseline,malformed),/malformed/);
});
test('CLI never exits zero on fresh, stale, new, incomplete, invalid observations',()=>{
  const dir=mkdtempSync(join(tmpdir(),'cvc5-freshness-'));
  try {
    const base=join(dir,'base.json'),obs=join(dir,'obs.json');
    writeFileSync(base,JSON.stringify(baseline));
    for (const [o,exit,status] of [
      [observed(),2,'FRESH_UNQUALIFIED'],
      [(()=>{const x=observed();x.identity.originalArchiveSha256='a'.repeat(64);return x;})(),4,'STALE_REVERIFY_REQUIRED'],
      [(()=>{const x=observed();x.identity.oracleAuthority='independent';return x;})(),5,'NEW_EVIDENCE_REVIEW_REQUIRED'],
      [(()=>{const x=observed();delete x.identity.version;return x;})(),3,'INCOMPLETE_OBSERVATION']
    ]) {
      writeFileSync(obs,JSON.stringify(o));
      const run=spawnSync(process.execPath,[cliFile,base,obs],{encoding:'utf8'});
      assert.equal(run.status,exit,run.stderr);
      assert.equal(JSON.parse(run.stdout).status,status);
    }
    writeFileSync(obs,'{broken');
    const bad=spawnSync(process.execPath,[cliFile,base,obs],{encoding:'utf8'});
    assert.equal(bad.status,3);assert.match(bad.stderr,/rejected/);
  } finally {rmSync(dir,{force:true,recursive:true});}
});
