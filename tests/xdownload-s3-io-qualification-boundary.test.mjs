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
//     deadlines already in the past sails through the loop, proving the
//     model does NOT qualify real DNS, TLS, byte-transport or timeout
//     invariants; and malformed seam replies are REACHABLE (recorded,
//     unqualified) — the seam-reply shape contract is trusted input.
// Zero network sockets are opened anywhere in this suite. Engineering-only:
// nothing here qualifies any real-Host behavior (G4 stays NOT_ADMITTED).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
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

test('W-QB-DEADLINE-DELEGATED (QB-07): a seam that genuinely runs PAST the received deadline still completes — no model-side interrupt', async () => {
  // Dedicated witness bounds (review P1-01): timeoutMs = 1 so the model's own
  // deadline expires within ~1ms. The falsifier waits until the monotonic
  // clock ACTUALLY reports the received deadline expired (bounded guard, no
  // real network). A short sleep against a large budget witnesses nothing —
  // it would equally pass an implementation that checked the deadline.
  const DEADLINE_BOUNDS = { maxBytes: 8, timeoutMs: 1, maxRedirects: 0 };
  const seenDeadlines = [];
  const readStartedAt = performance.now();
  const reader = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, DEADLINE_BOUNDS, {
    resolvePublic: async (hostname, deadline) => {
      const giveUpAt = performance.now() + 1000; // bounded guard, independent of the model deadline
      while (performance.now() < deadline) {
        if (performance.now() > giveUpAt) {
          throw new Error('deadline witness aborted: implausibly distant model deadline');
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      assert.ok(performance.now() >= deadline, 'witness precondition: deadline observed EXPIRED before the seam returns');
      seenDeadlines.push({ seam: 'resolvePublic', deadline });
      return '8.8.8.8';
    },
    hop: async (parsed, pinnedIp, maxBytes, deadline) => {
      assert.ok(performance.now() >= deadline, 'hop receives the same already-expired deadline');
      seenDeadlines.push({ seam: 'hop', deadline });
      return { kind: 'body', bytes: '12345678', contentType: 'video/mp4' };
    },
  });
  const result = await reader.read(MEDIA_URI);
  assert.equal(result.ok, true, 'a run past the model deadline still completes — enforcement is not model logic');
  assert.equal(seenDeadlines.length, 2, 'both seams ran');
  assert.equal(seenDeadlines[1].deadline, seenDeadlines[0].deadline, 'the SAME deadline value is passed to both seams');
  assert.ok(seenDeadlines[0].deadline > readStartedAt, 'deadline was computed by the model during read()');
  assert.ok(performance.now() > seenDeadlines[0].deadline, 'read() succeeded strictly after the deadline had passed');
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

test('W-QB-SEAM-SHAPE-PRECONDITION-BOUNDED (QB-09): malformed seam replies are REACHABLE — bounded negative witness of observed behavior', async () => {
  // The failure mapping is enforced model logic ONLY under trusted,
  // well-shaped seam replies; the factory validates just that the seams are
  // functions (review P2-01). These bounded negatives record what actually
  // happens for malformed shapes — observed, UNQUALIFIED behavior, not an
  // impossible state.
  const unknownKind = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, { maxBytes: 8, timeoutMs: 1000, maxRedirects: 1 }, {
    resolvePublic: async () => '8.8.8.8',
    hop: async () => ({ kind: 'mystery' }), // unknown kind, no location
  });
  assert.deepEqual(
    await unknownKind.read(MEDIA_URI),
    { ok: false, reason: 'SOURCE_REJECTED' },
    'unknown-kind reply degrades into redirect handling (undefined location -> SOURCE_REJECTED), it is not an unreachable state',
  );

  const locationShaped = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async () => '8.8.8.8',
    hop: async () => ({ location: MEDIA_URI }), // shape-less reply carrying a location
  });
  assert.deepEqual(
    await locationShaped.read(MEDIA_URI),
    { ok: false, reason: 'HTTP_REJECTED' },
    'a missing-kind reply IS treated as a redirect (HTTP_REJECTED at the last allowed index with maxRedirects=0)',
  );

  const nullReply = s3.createPinnedPublicS3HttpsReader(ADMIT_OK, SMALL_BOUNDS, {
    resolvePublic: async () => '8.8.8.8',
    hop: async () => null,
  });
  await assert.rejects(
    nullReply.read(MEDIA_URI),
    TypeError,
    'a null reply throws a TypeError that escapes read() — no failure mapping applies to malformed shapes',
  );
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
