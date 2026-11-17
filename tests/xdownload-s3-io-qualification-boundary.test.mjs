// G4-P2 lane FORMAL_TOOLS_I11_G4_P2 — S3-lane network I/O QUALIFICATION
// BOUNDARY (review P2-2 of #5945831322 on merged #166).
//
// The merged #166 S3 guard model injects `resolvePublic`/`hop` seams and
// never performs real network I/O. This suite makes the qualification
// boundary EXACT and machine-checked, per QUALIFICATION_BOUNDARY.json:
//   - ENFORCED aspects: the model logic is asserted (structure, mapping,
//     config validation, seam-construction enforcement);
//   - DELEGATED/HOST aspects: the delegation is DEMONSTRATED — a
//     well-shaped seam feeding reserved/private IPs, oversized bodies or
//     ignored deadlines sails through the loop, proving the model does
//     NOT qualify real DNS, TLS, byte-transport or timeout invariants.
// Zero network sockets are opened anywhere in this suite. Engineering-only:
// nothing here qualifies any real-Host behavior (G4 stays NOT_ADMITTED).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as s3 from '../benchmarks/llm-methods/g4/product-refinement/model/s3-network-guard-model.mjs';

const boundaryRoot = new URL('../benchmarks/llm-methods/g4/product-refinement/s3-io-qualification-boundary/', import.meta.url);
const modelUrl = new URL('../benchmarks/llm-methods/g4/product-refinement/model/s3-network-guard-model.mjs', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('QUALIFICATION_BOUNDARY.json', boundaryRoot), 'utf8'));

const SMALL_BOUNDS = { maxBytes: 8, timeoutMs: 1000, maxRedirects: 0 };
const MEDIA_URI = 'https://media.example.com/media/abc123.mp4';

/** Pass-through admission policy double (always ok, exact echo). */
const ADMIT_OK = { admitInitial: (uri) => ({ ok: true, uri }), admitRedirect: (uri) => ({ ok: true, uri }) };

const aspectById = new Map(manifest.aspects.map((aspect) => [aspect.id, aspect]));

test('boundary manifest: 9 aspects, delegation summary consistent, engineering-only', () => {
  assert.equal(manifest.schema, 'formal-tools.i11.g4-p2.s3-io-qualification-boundary/1');
  assert.equal(manifest.aspects.length, 9);
  assert.deepEqual(
    manifest.aspects.filter((a) => a.modelTreatment.startsWith('ENFORCED')).map((a) => a.id).sort(),
    manifest.summary.enforcedByModel,
  );
  assert.deepEqual(manifest.summary.notQualifiedByModel.sort(), ['QB-04', 'QB-05', 'QB-06', 'QB-07']);
  assert.match(manifest.authority.qualificationConsequence, /G4_QUALIFICATION stays NOT_ADMITTED/);
});

test('W-QB-SEAM-CONSTRUCTION-REQUIRED (QB-08): no reader can be constructed without both seams, any type is refused', () => {
  assert.throws(() => s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {}), /requires injected resolvePublic\/hop seams/);
  assert.throws(() => s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, { resolvePublic: null, hop: async () => ({ kind: 'body', bytes: '' }) }), /requires injected resolvePublic\/hop seams/);
  assert.throws(() => s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, { resolvePublic: async () => '8.8.8.8', hop: 42 }), /requires injected resolvePublic\/hop seams/);
  const reader = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async () => '8.8.8.8',
    hop: async () => ({ kind: 'body', bytes: '12345678', contentType: 'video/mp4' }),
  });
  assert.equal(Object.isFrozen(reader), true, 'reader instance is frozen');
});

test('W-QB-DNS-CLASSIFICATION-DELEGATED (QB-04): a reserved/private pinnedIp from the seam is forwarded to hop verbatim', async () => {
  const hopped = [];
  const reader = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async () => '10.0.0.1', // reserved — the model does NOT reclassify
    hop: async (parsed, pinnedIp) => {
      hopped.push({ host: parsed.hostname, pinnedIp });
      return { kind: 'body', bytes: '12345678', contentType: 'video/mp4' };
    },
  });
  const result = await reader.read(MEDIA_URI);
  assert.equal(result.ok, true, 'seam-supplied private IP sails through — classification is a seam obligation');
  assert.deepEqual(hopped, [{ host: 'media.example.com', pinnedIp: '10.0.0.1' }]);
});

test('W-QB-TLS-PEER-IDENTITY-DELEGATED (QB-05): the read loop never sees a socket; tlsPeerOkay is a host-side spec only', async () => {
  let sawExtra = null;
  const reader = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async () => '8.8.8.8',
    hop: async (parsed, pinnedIp, maxBytes, deadline) => {
      sawExtra = { maxBytes, deadlineIsFinite: Number.isFinite(deadline) };
      // a compliant-shaped body reply carries NO socket facts at all
      return { kind: 'body', bytes: '12345678', contentType: 'video/mp4' };
    },
  });
  const result = await reader.read(MEDIA_URI);
  assert.equal(result.ok, true);
  assert.deepEqual(sawExtra, { maxBytes: 8, deadlineIsFinite: true });
  assert.ok(!('socket' in result) && !('tls' in result), 'no TLS/socket facts appear in the result');
  // The exported predicate is the HOST-side spec; unit semantics kept honest:
  assert.equal(s3.tlsPeerOkay({ encrypted: true, authorized: true, remoteAddress: '8.8.8.8' }, '8.8.8.8'), true);
  assert.equal(s3.tlsPeerOkay({ encrypted: true, authorized: true, remoteAddress: '8.8.4.4' }, '8.8.8.8'), false);
  assert.equal(s3.tlsPeerOkay({ encrypted: false, authorized: true, remoteAddress: '8.8.8.8' }, '8.8.8.8'), false);
  // ...and it is never invoked by the loop: the hop double above returned a
  // body with zero socket fields and the read still succeeded.
});

test('W-QB-BODY-BOUNDS-DELEGATED (QB-06): an oversized body from a shape-compliant hop reply is returned unvalidated', async () => {
  const oversized = 'x'.repeat(16); // bounds.maxBytes = 8 — enforcement is the transport's obligation
  const reader = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async () => '8.8.8.8',
    hop: async () => ({ kind: 'body', bytes: oversized, contentType: 'video/mp4' }),
  });
  const result = await reader.read(MEDIA_URI);
  assert.equal(result.ok, true, 'model returns the body verbatim; byte-bound enforcement is delegated');
  assert.equal(result.bytes, oversized, 'bytes identity preserved (no copy, no truncation, no measurement)');
  assert.equal(result.bytes.length > SMALL_BOUNDS.maxBytes, true);
});

test('W-QB-DEADLINE-DELEGATED (QB-07): a seam that ignores the deadline still completes — no model-side interrupt', async () => {
  const reader = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async (hostname, deadline) => {
      await new Promise((resolve) => setTimeout(resolve, 5)); // deliberately blow past any budget the model could impose
      assert.equal(typeof deadline, 'number');
      return '8.8.8.8';
    },
    hop: async () => ({ kind: 'body', bytes: '12345678', contentType: 'video/mp4' }),
  });
  const result = await reader.read(MEDIA_URI);
  assert.equal(result.ok, true, 'deadline is advisory data for the seams; enforcement is not model logic');
});

test('W-QB-SEAM-FAILURE-MAPPING (QB-09): undefined seam answer -> DNS_REJECTED; hop failure passes through verbatim', async () => {
  const dnsFail = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async () => undefined,
    hop: async () => {
      throw new Error('hop must never be reached after DNS_REJECTED');
    },
  });
  const rejected = await dnsFail.read(MEDIA_URI);
  assert.deepEqual(rejected, { ok: false, reason: 'DNS_REJECTED' });

  const hopFail = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async () => '8.8.8.8',
    hop: async () => ({ kind: 'failure', reason: 'TLS_PEER_MISMATCH' }),
  });
  const failed = await hopFail.read(MEDIA_URI);
  assert.deepEqual(failed, { ok: false, reason: 'TLS_PEER_MISMATCH' }, 'failure reason passes through unmapped');
});

test('W-QB-BOUNDS-VALIDATION-NOT-ENFORCEMENT (QB-03): construction validates config; enforcement is elsewhere', () => {
  assert.throws(() => s3.validateReaderBounds({ maxBytes: 0, timeoutMs: 1000, maxRedirects: 0 }), /bounded trusted configuration/);
  assert.throws(() => s3.validateReaderBounds({ maxBytes: 2 ** 40, timeoutMs: 1000, maxRedirects: 0 }), /bounded trusted configuration/);
  assert.throws(() => s3.validateReaderBounds({ maxBytes: 1024, timeoutMs: Number.NaN, maxRedirects: 0 }), /bounded trusted configuration/);
  assert.throws(() => s3.validateReaderBounds({ maxBytes: 1024, timeoutMs: 1000, maxRedirects: 4 }), /bounded trusted configuration/);
  assert.doesNotThrow(() => s3.validateReaderBounds(SMALL_BOUNDS));
});

test('W-QB-STRUCT-SOURCE-NETWORK-FREE (QB-08): model source imports no transport modules; resolve4 lives only in the never-tested real resolver', async () => {
  const source = await readFile(modelUrl, 'utf8');
  const imports = [...source.matchAll(/^import .* from '(node:[^']+)';$/gmu)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), ['node:dns/promises', 'node:perf_hooks'], 'only DNS promise API + perf clock are imported');
  // every resolve4 reference sits inside resolvePublicViaDns (the parity shim
  // that no test path invokes — the DNS seam obligation is external)
  const realResolverAt = source.indexOf('export async function resolvePublicViaDns');
  const firstResolve4 = source.indexOf('resolve4(');
  const lastResolve4 = source.lastIndexOf('resolve4(');
  assert.ok(realResolverAt > 0, 'resolvePublicViaDns present (original-source parity)');
  assert.ok(firstResolve4 > realResolverAt, 'resolve4 referenced only after the real resolver begins');
  const nextExport = source.indexOf('\nexport ', realResolverAt + 10);
  assert.ok(lastResolve4 < nextExport, 'resolve4 fully contained in resolvePublicViaDns');
  // no transport module surface anywhere in the pure model
  for (const banned of ['node:net', 'node:tls', 'node:http', 'node:https', 'node:http2', 'node:stream', 'node:fs']) {
    assert.ok(!source.includes(banned), `pure model must not reference ${banned}`);
  }
  // manifest ↔ code binding: every aspect anchors a symbol that exists
  for (const aspect of manifest.aspects) {
    if (aspect.id === 'QB-08') continue; // anchored at module level, asserted above
    for (const symbol of aspect.sourceAnchor.symbols) {
      const needle = symbol.includes('read loop') ? 'createPinnedPublicS3HttpsReader' : symbol;
      assert.ok(source.includes(needle), `QB anchor ${aspect.id}: symbol ${needle} present in model source`);
    }
  }
});

test('boundary honesty: the manifest grants no qualification (engineering-only consequence binding)', () => {
  for (const id of manifest.summary.notQualifiedByModel) {
    const aspect = aspectById.get(id);
    assert.ok(aspect.notQualified, `${id} records what is NOT qualified`);
    assert.ok(aspect.boundaryTests.length > 0, `${id} binds demonstration tests`);
  }
  assert.match(manifest.authority.qualificationConsequence, /no real-Host DNS, TLS, timeout or body invariant is qualified/);
});
