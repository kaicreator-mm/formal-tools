#!/usr/bin/env node
/** NetworkX FT-T20 scoped, fail-closed T6 evidence-freshness assessment.
 * Does not fetch upstream archives, run NetworkX, or grant any lifecycle gate.
 * CLI: node scripts/tool-portfolio/networkx-evidence-freshness.mjs
 *      --baseline docs/tool-portfolio/r126/NETWORKX_T6_EVIDENCE_FRESHNESS.json
 *      --observed /path/to/pinned-current-observation.json
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const BASELINE_SCHEMA = 'formal-tools/networkx-t6-freshness-baseline/1.0';
export const OBSERVATION_SCHEMA = 'formal-tools/networkx-t6-freshness-observation/1.0';
export const ASSESSMENT_SCHEMA = 'formal-tools/networkx-t6-freshness-assessment/1.0';

export const SOURCE_PIN_FIELDS = Object.freeze({
  'docs/tool-portfolio/r22/NETWORKX_T0_SOURCE_AUDIT.json': 'sourceAuditEvidenceBlob',
  'portable/builders/tools/networkx.sh': 'builderBlob',
  'portable/verification/cases/networkx/expect.sh': 'expectBlob',
  'portable/verification/cases/networkx/pos.py': 'posBlob',
  'portable/verification/cases/networkx/neg.py': 'negBlob',
  'portable/verification/cases/networkx/err.py': 'errBlob',
  'portable/packaging/bundle-template/bin/tool-runner': 'runnerBlob',
  'packages/runner/js/native.mjs': 'nativeBlob',
  'packages/runner/js/cli.mjs': 'cliBlob',
  'packages/runner/js/sdk.mjs': 'sdkBlob',
  'packages/runner/js/mcp.mjs': 'mcpBlob',
  'registry/PROBLEM_CAPABILITIES.json': 'registryBlob'
});

export const FIELDS = Object.freeze([
  'version', 'upstreamTag', 'upstreamCommit', 'license',
  'archiveSha256', 'producerManifestSha256', 'sourceArchivePublisherSha256',
  'sourceAuditEvidenceBlob', 'builderBlob', 'expectBlob', 'posBlob',
  'negBlob', 'errBlob', 'runnerBlob', 'nativeBlob', 'cliBlob',
  'sdkBlob', 'mcpBlob', 'registryBlob', 'pythonRuntimeSha256',
  'reproduciblePackageTreeSha256', 'installedPackageTreeSha256',
  't5OracleBlob', 't5OracleAuthority'
]);

export const DEPENDENCIES = Object.freeze({
  T0: ['version', 'upstreamTag', 'upstreamCommit', 'license', 'archiveSha256',
    'producerManifestSha256', 'sourceArchivePublisherSha256', 'sourceAuditEvidenceBlob'],
  T1: ['version', 'upstreamCommit', 'archiveSha256', 'builderBlob', 'pythonRuntimeSha256',
    'reproduciblePackageTreeSha256'],
  T2: ['archiveSha256', 'reproduciblePackageTreeSha256', 'pythonRuntimeSha256', 'installedPackageTreeSha256'],
  T3: ['version', 'archiveSha256', 'reproduciblePackageTreeSha256',
    'installedPackageTreeSha256', 'expectBlob', 'posBlob', 'negBlob', 'errBlob',
    'runnerBlob', 'pythonRuntimeSha256'],
  T4: ['version', 'archiveSha256', 'reproduciblePackageTreeSha256',
    'installedPackageTreeSha256', 'expectBlob', 'posBlob', 'negBlob', 'errBlob',
    'runnerBlob', 'nativeBlob', 'cliBlob', 'sdkBlob', 'mcpBlob', 'registryBlob',
    'pythonRuntimeSha256'],
  T5: ['version', 'archiveSha256', 'reproduciblePackageTreeSha256',
    'installedPackageTreeSha256', 'posBlob', 'negBlob', 'errBlob',
    'pythonRuntimeSha256', 't5OracleBlob', 't5OracleAuthority'],
  T6: FIELDS
});

const IDENTIFIER_SHA1 = /Blob$/;
const SHA256 = /Sha256$/;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function object(x, label) {
  if (x === null || typeof x !== 'object' || Array.isArray(x) || Object.getPrototypeOf(x) !== Object.prototype) {
    throw new Error(`${label} must be a plain JSON object`);
  }
  return x;
}
function exactKeys(obj, keys, label, allowMissing = false) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) throw new Error(`${label}: unexpected key ${k}`);
  if (!allowMissing) for (const k of keys) if (!hasOwn(obj, k)) throw new Error(`${label}: missing key ${k}`);
}
function valueValid(k, v) {
  if (v === null) return true; // Unknown is explicit; never interpreted as qualified.
  if (typeof v !== 'string' || v.length === 0 || v.length > 1024) return false;
  if (IDENTIFIER_SHA1.test(k)) return /^[a-f0-9]{40}$/.test(v);
  if (SHA256.test(k)) return /^[a-f0-9]{64}$/.test(v);
  if (k === 'upstreamCommit') return /^[a-f0-9]{40}$/.test(v);
  return !/[\u0000-\u001f\u007f]/.test(v);
}
function validateIdentity(identity, label, allowMissing = false) {
  object(identity, label);
  exactKeys(identity, FIELDS, label, allowMissing);
  for (const k of Object.keys(identity)) if (!valueValid(k, identity[k])) {
    throw new Error(`${label}: invalid ${k}`);
  }
}
function validatePins(pins, identity, label, allowMissing = false) {
  object(pins, label);
  const paths = Object.keys(SOURCE_PIN_FIELDS);
  exactKeys(pins, paths, label, allowMissing);
  for (const path of Object.keys(pins)) {
    const sha = pins[path];
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new Error(`${label}: invalid Git Blob for ${path}`);
    const field = SOURCE_PIN_FIELDS[path];
    if (hasOwn(identity, field) && sha !== identity[field]) {
      throw new Error(`${label}: ${path} does not match identity.${field}`);
    }
  }
}
export function validateBaseline(baseline) {
  object(baseline, 'baseline');
  if (baseline.schema !== BASELINE_SCHEMA || baseline.toolId !== 'networkx') throw new Error('baseline schema/tool mismatch');
  if (!/^[a-f0-9]{40}$/.test(baseline.snapshotMain ?? '')) throw new Error('baseline snapshotMain must be an exact 40-hex Git SHA');
  validateIdentity(baseline.identity, 'baseline.identity');
  validatePins(baseline.sourcePins, baseline.identity, 'baseline.sourcePins');
  if (baseline.identity.version !== '3.7' || baseline.identity.upstreamTag !== 'networkx-3.7' || baseline.identity.license !== 'BSD-3-Clause') {
    throw new Error('baseline fixed NetworkX 3.7 source identity mismatch');
  }
  if (!baseline.qualification || Object.values(baseline.qualification).length !== 7 ||
      Object.entries(baseline.qualification).some(([k,v]) => !hasOwn(DEPENDENCIES,k) || v !== false)) {
    throw new Error('baseline must deny all seven lifecycle qualifications');
  }
  return baseline;
}
export function assess(baseline, observed) {
  validateBaseline(baseline);
  object(observed, 'observation');
  if (observed.schema !== OBSERVATION_SCHEMA || observed.toolId !== 'networkx') throw new Error('observation schema/tool mismatch');
  validateIdentity(observed.identity, 'observation.identity', true);
  validatePins(observed.sourcePins, observed.identity, 'observation.sourcePins', true);
  const missing = FIELDS.filter(k => !hasOwn(observed.identity,k));
  for (const path of Object.keys(SOURCE_PIN_FIELDS)) if (!hasOwn(observed.sourcePins, path)) missing.push(`sourcePins:${path}`);
  const changed = [];
  const newlyObserved = [];
  const unknown = [];
  for (const k of FIELDS) {
    if (!hasOwn(observed.identity,k)) continue;
    const before = baseline.identity[k], after = observed.identity[k];
    if (after === null && before === null) unknown.push(k);
    else if (after === null && before !== null) missing.push(k);
    else if (before === null && after !== null) newlyObserved.push(k);
    else if (before !== after) changed.push(k);
  }
  for (const path of Object.keys(SOURCE_PIN_FIELDS)) {
    if (!hasOwn(observed.sourcePins,path)) continue;
    if (observed.sourcePins[path] !== baseline.sourcePins[path]) {
      const field = SOURCE_PIN_FIELDS[path];
      if (!changed.includes(field)) changed.push(field);
    }
  }
  const changedKeys = new Set([...changed, ...newlyObserved, ...missing.filter(k => FIELDS.includes(k)),
    ...missing.filter(k => k.startsWith('sourcePins:')).map(k => SOURCE_PIN_FIELDS[k.slice('sourcePins:'.length)])]);
  const reverifyGates = Object.entries(DEPENDENCIES)
    .filter(([, deps]) => deps.some(d => changedKeys.has(d))).map(([gate]) => gate);
  const state = missing.length ? 'INCOMPLETE_OBSERVATION'
    : changed.length ? 'STALE_REVERIFY_REQUIRED'
    : newlyObserved.length ? 'NEW_EVIDENCE_REVIEW_REQUIRED' : 'FRESH_UNQUALIFIED';
  return {
    schema: ASSESSMENT_SCHEMA, toolId: 'networkx', baselineMain: baseline.snapshotMain,
    externalSourceVerification: 'UNVERIFIED_EXTERNAL_GIT_READBACK',
    status: state, qualificationGranted: false,
    qualification: Object.fromEntries(Object.keys(DEPENDENCIES).map(k => [k, false])),
    changedFields: changed.sort(), newEvidenceFields: newlyObserved.sort(),
    incompleteFields: [...new Set(missing)].sort(), unknownFields: unknown.sort(),
    reverifyGates, reverifyRequired: state !== 'FRESH_UNQUALIFIED',
    limitations: 'Caller-provided observation and sourcePins are not authenticated against the current Git tree. External source readback UNVERIFIED; original archive bytes, Python313, full T1/T4, T5 Oracle and T6 remain unqualified.'
  };
}

function main(argv) {
  if (argv.length !== 4 || argv[0] !== '--baseline' || argv[2] !== '--observed') {
    throw new Error('usage: --baseline BASELINE.json --observed OBSERVATION.json');
  }
  const baseline = JSON.parse(readFileSync(resolve(argv[1]), 'utf8'));
  const observed = JSON.parse(readFileSync(resolve(argv[3]), 'utf8'));
  const result = assess(baseline, observed);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = ({FRESH_UNQUALIFIED:0, STALE_REVERIFY_REQUIRED:2,
    INCOMPLETE_OBSERVATION:3, NEW_EVIDENCE_REVIEW_REQUIRED:4})[result.status];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.error(`NETWORKX_T6_ASSESSOR_ERROR: ${e.message}`);
    process.exitCode = 5;
  }
}
