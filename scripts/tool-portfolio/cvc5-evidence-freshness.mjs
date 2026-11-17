import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BASELINE_SCHEMA = 'formal-tools/cvc5-evidence-freshness/1';
export const OBSERVATION_SCHEMA = 'formal-tools/cvc5-evidence-observation/1';
export const SOURCE_PIN_FIELDS = Object.freeze({
  'docs/tool-portfolio/r27/CVC5_NATIVE_REPLAY.json': 'nativeReplayBlob',
  'portable/builders/tools/cvc5.sh': 'builderBlob',
  'portable/status/receipts/build-cvc5.json': 'buildReceiptBlob',
  'portable/status/receipts/verify-cvc5.json': 'verifyReceiptBlob',
  'portable/verification/cases/cvc5/expect.sh': 'expectBlob',
  'portable/verification/cases/cvc5/pos.smt2': 'posBlob',
  'portable/verification/cases/cvc5/neg.smt2': 'negBlob',
  'portable/verification/cases/cvc5/err.smt2': 'errBlob',
  'portable/packaging/bundle-template/bin/tool-runner': 'runnerBlob',
  'packages/runner/js/native.mjs': 'nativeBlob',
  'packages/runner/js/cli.mjs': 'cliBlob',
  'packages/runner/js/sdk.mjs': 'sdkBlob',
  'packages/runner/js/mcp.mjs': 'mcpBlob',
  'registry/PROBLEM_CAPABILITIES.json': 'registryBlob',
  'tests/cvc5-incremental-failclosed.test.mjs': 'nonincrementalTestBlob'
});
export const FIELDS = Object.freeze([
  'version', 'originalArchiveSha256', 'publisherArchiveSha256',
  'buildPackageSha256', 'installedBinarySha256',
  'nativeReplayBlob', 'builderBlob', 'buildReceiptBlob', 'verifyReceiptBlob',
  'expectBlob', 'posBlob', 'negBlob', 'errBlob',
  'runnerBlob', 'nativeBlob', 'cliBlob', 'sdkBlob', 'mcpBlob',
  'registryBlob', 'nonincrementalTestBlob',
  'oracleEvidenceBlob', 'oracleAuthority'
]);
const d = {
  T0: ['version', 'originalArchiveSha256', 'publisherArchiveSha256', 'nativeReplayBlob'],
  T1: ['version', 'originalArchiveSha256', 'publisherArchiveSha256', 'builderBlob',
       'buildReceiptBlob', 'buildPackageSha256', 'installedBinarySha256'],
  T2: ['version', 'originalArchiveSha256', 'buildPackageSha256', 'installedBinarySha256',
       'builderBlob', 'buildReceiptBlob'],
  T3: ['version', 'originalArchiveSha256', 'buildPackageSha256', 'installedBinarySha256',
       'nativeReplayBlob', 'verifyReceiptBlob', 'expectBlob', 'posBlob', 'negBlob',
       'errBlob', 'runnerBlob'],
  T4: ['version', 'originalArchiveSha256', 'buildPackageSha256', 'installedBinarySha256',
       'expectBlob', 'posBlob', 'negBlob', 'errBlob', 'runnerBlob', 'nativeBlob',
       'cliBlob', 'sdkBlob', 'mcpBlob', 'registryBlob', 'nonincrementalTestBlob'],
  T5: ['version', 'originalArchiveSha256', 'buildPackageSha256', 'installedBinarySha256',
       'posBlob', 'negBlob', 'errBlob', 'oracleEvidenceBlob', 'oracleAuthority'],
  T6: FIELDS
};
export const GATE_DEPENDENCIES = Object.freeze(Object.fromEntries(
  Object.entries(d).map(([gate, fields]) => [gate, Object.freeze([...fields])])
));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function plain(x, name) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.getPrototypeOf(x) !== Object.prototype) {
    throw new Error(name + ' must be a plain JSON object');
  }
  return x;
}
function exactKeys(x, allowed, name, allowMissing = false) {
  for (const k of Object.keys(x)) if (!allowed.includes(k)) throw new Error(name + ': unexpected key ' + k);
  if (!allowMissing) for (const k of allowed) if (!own(x, k)) throw new Error(name + ': missing key ' + k);
}
function validValue(key, value) {
  if (value === null) return true; // UNKNOWN never qualifies a gate
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) return false;
  if (key.endsWith('Blob')) return /^[a-f0-9]{40}$/.test(value);
  if (key.endsWith('Sha256')) return /^[a-f0-9]{64}$/.test(value);
  return !/[\u0000-\u001f\u007f]/.test(value);
}
function identity(x, name, allowMissing = false) {
  plain(x, name); exactKeys(x, FIELDS, name, allowMissing);
  for (const [key, value] of Object.entries(x)) {
    if (!validValue(key, value)) throw new Error(name + ': malformed ' + key);
  }
}
function pins(x, id, name, allowMissing = false) {
  plain(x, name);
  const paths = Object.keys(SOURCE_PIN_FIELDS);
  exactKeys(x, paths, name, allowMissing);
  for (const [path, sha] of Object.entries(x)) {
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) {
      throw new Error(name + ': malformed Git Blob for ' + path);
    }
    const field = SOURCE_PIN_FIELDS[path];
    if (own(id, field) && id[field] !== sha) {
      throw new Error(name + ': ' + path + ' does not match identity.' + field);
    }
  }
}
export function validateBaseline(b) {
  plain(b, 'baseline');
  if (b.schema !== BASELINE_SCHEMA || b.toolId !== 'cvc5') throw new Error('wrong baseline schema/tool');
  if (!/^[a-f0-9]{40}$/.test(b.snapshotMain || '')) throw new Error('invalid snapshotMain');
  identity(b.identity, 'baseline.identity');
  pins(b.sourcePins, b.identity, 'baseline.sourcePins');
  if (b.identity.version !== '1.4.2') throw new Error('wrong frozen cvc5 version');
  plain(b.qualification, 'baseline.qualification');
  const gates = Object.keys(GATE_DEPENDENCIES);
  exactKeys(b.qualification, gates, 'baseline.qualification');
  for (const gate of gates) if (b.qualification[gate] !== false) {
    throw new Error('baseline must not claim an accepted gate: ' + gate);
  }
  if (b.externalGitReadback !== 'UNVERIFIED_EXTERNAL_GIT_READBACK') {
    throw new Error('historical baseline must disclose external Git readback limit');
  }
  return true;
}
export function assess(baseline, observed) {
  validateBaseline(baseline);
  plain(observed, 'observation');
  if (observed.schema !== OBSERVATION_SCHEMA || observed.toolId !== 'cvc5') {
    throw new Error('wrong observation schema/tool');
  }
  identity(observed.identity, 'observation.identity', true);
  pins(observed.sourcePins, observed.identity, 'observation.sourcePins', true);

  const changedFields = [], newEvidenceFields = [], incompleteFields = [], unknownFields = [];
  const touched = new Set();
  for (const key of FIELDS) {
    const before = baseline.identity[key];
    const present = own(observed.identity, key);
    const after = present ? observed.identity[key] : undefined;
    if (!present || (after === null && before !== null)) {
      incompleteFields.push(key); touched.add(key);
    } else if (after === null) {
      unknownFields.push(key);
    } else if (before === null) {
      newEvidenceFields.push(key); touched.add(key);
    } else if (before !== after) {
      changedFields.push(key); touched.add(key);
    }
  }
  for (const [path, field] of Object.entries(SOURCE_PIN_FIELDS)) {
    if (!own(observed.sourcePins, path)) {
      incompleteFields.push('sourcePins:' + path); touched.add(field);
    }
  }
  const reverifyGates = Object.entries(GATE_DEPENDENCIES)
    .filter(([, inputs]) => inputs.some(key => touched.has(key)))
    .map(([gate]) => gate);
  const status = incompleteFields.length ? 'INCOMPLETE_OBSERVATION'
    : changedFields.length ? 'STALE_REVERIFY_REQUIRED'
    : newEvidenceFields.length ? 'NEW_EVIDENCE_REVIEW_REQUIRED'
    : 'FRESH_UNQUALIFIED';
  return {
    schema: 'formal-tools/cvc5-freshness-assessment/1', toolId: 'cvc5', status,
    snapshotMain: baseline.snapshotMain,
    externalSourceVerification: 'UNVERIFIED_EXTERNAL_GIT_READBACK',
    changedFields, newEvidenceFields, incompleteFields, unknownFields, reverifyGates,
    reverifyRequired: reverifyGates.length > 0,
    qualification: Object.fromEntries(Object.keys(GATE_DEPENDENCIES).map(gate => [gate, false])),
    qualificationGranted: false,
    limitations: 'Offline comparison of caller-supplied observations; no live Git, publisher, package, native, business Oracle or Host reauthentication.'
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('usage: cvc5-evidence-freshness.mjs BASELINE.json OBSERVATION.json');
    const result = assess(
      JSON.parse(readFileSync(process.argv[2], 'utf8')),
      JSON.parse(readFileSync(process.argv[3], 'utf8'))
    );
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = ({
      FRESH_UNQUALIFIED: 2, INCOMPLETE_OBSERVATION: 3,
      STALE_REVERIFY_REQUIRED: 4, NEW_EVIDENCE_REVIEW_REQUIRED: 5
    })[result.status];
  } catch (e) {
    process.stderr.write('cvc5 freshness assessment rejected: ' + e.message + '\n');
    process.exitCode = 3;
  }
}
