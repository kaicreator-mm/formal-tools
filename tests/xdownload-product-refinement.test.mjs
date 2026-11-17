import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as t01 from '../benchmarks/llm-methods/g4/product-refinement/model/t01-intent-model.mjs';
import * as t03 from '../benchmarks/llm-methods/g4/product-refinement/model/t03-effect-gate-model.mjs';
import * as s3 from '../benchmarks/llm-methods/g4/product-refinement/model/s3-network-guard-model.mjs';

const refinementRoot = new URL('../benchmarks/llm-methods/g4/product-refinement/', import.meta.url);
const g4Root = new URL('../benchmarks/llm-methods/g4/', import.meta.url);
const project = new URL('../', import.meta.url);

const refinement = JSON.parse(await readFile(new URL('REFINEMENT.json', refinementRoot), 'utf8'));
const gaps = JSON.parse(await readFile(new URL('SMT_ABSTRACTION_GAPS.json', refinementRoot), 'utf8'));
const crosswalk = JSON.parse(
  await readFile(new URL('product-policy-crosswalk/CROSSWALK.json', g4Root), 'utf8'),
);

const noExecutableValues = (value) => {
  if (value === null || value === undefined) return true;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true;
    case 'object': {
      if (Array.isArray(value)) return value.every(noExecutableValues);
      return Object.values(value).every(noExecutableValues);
    }
    default:
      return false;
  }
};

const witnessById = new Map(refinement.witness.map((entry) => [entry.id, entry]));
const admit = (script, uri) => {
  const action = script[uri];
  if (action === 'admit') return { ok: true, uri };
  if (action === 'echo-mismatch') return { ok: true, uri: `${uri}x` };
  return { ok: false };
};

const dispatch = {
  't01.validateConfirmedIntent': (entry) => t01.validateConfirmedIntent(entry.input),
  't01.validateOutputRoot': (entry) => t01.validateOutputRoot(entry.input.root),
  't01.validateArtifactPath': (entry) => t01.validateArtifactPath(entry.input.root, entry.input.artifactPath),
  't01.constants': () => ({ constants: { maxDeclaredBytes: t01.MAX_DECLARED_BYTES } }),
  't03.evaluateGuard': (entry) => t03.evaluateGuardDeclaredBytes(entry.input),
  't03.decideDownloadConfirmed': (entry) => t03.decideDownloadConfirmed(entry.input),
  't03.decisionSchemaValid': (entry) => ({ valid: t03.decisionSchemaIsValid(entry.input.value) }),
  't03.confirmDownloadRequest': (entry) => {
    try {
      const result = t03.confirmDownloadRequest(entry.input);
      return { threw: false, ...result };
    } catch (error) {
      return { threw: true, message: error.message };
    }
  },
  't03.constants': () => ({
    constants: {
      moduleId: t03.MODULE_ID,
      packageKind: t03.PACKAGE_KIND,
      abiVersion: t03.ABI_VERSION,
      endpoints: t03.ENDPOINTS,
      intentTypes: t03.INTENT_TYPES,
      effectTypes: t03.EFFECT_TYPES,
      profileBound: t03.DECLARED_BYTES_PROFILE_BOUND,
      t01ContractMax: t01.MAX_DECLARED_BYTES,
    },
  }),
  't03.frozenRouteFacts': () => ({ routeFacts: t03.FROZEN_ROUTE_FACTS }),
  'meta.plainDataOnly': (entry) => {
    const source = witnessById.get(entry.input.caseId);
    if (!source) throw new Error(`plainDataOnly caseId ${entry.input.caseId} missing`);
    const decision = t03.decideDownloadConfirmed(source.input);
    return { plainDataOnly: noExecutableValues(decision) };
  },
  'meta.effectIntentsNeverExecute': (entry) => {
    for (const caseId of entry.input.caseIds) {
      const source = witnessById.get(caseId);
      if (!source) throw new Error(`effectIntentsNeverExecute caseId ${caseId} missing`);
      const decision = t03.decideDownloadConfirmed(source.input);
      assert.ok(noExecutableValues(decision), `${caseId} decision carries executable values`);
      for (const effectIntent of decision.effectIntents) {
        assert.equal(effectIntent.executed, false, `${caseId} effect intent must stay executed:false`);
        assert.equal(effectIntent.effectType, 'effect:acquire');
      }
    }
    return { neverExecuted: true };
  },
  's3.publicIpv4': (entry) => ({ accepted: s3.publicIpv4(entry.input.value) }),
  's3.mediaUrl': (entry) => {
    const parsed = s3.mediaUrl(entry.input.value);
    return { accepted: parsed !== undefined, hostname: parsed?.hostname };
  },
  's3.classifyDnsAnswers': (entry) => {
    const pinned = s3.classifyDnsAnswers(entry.input.answers, entry.input.withinDeadline);
    return { accepted: pinned !== undefined, pinnedIp: pinned };
  },
  's3.tlsPeerOkay': (entry) => ({ accepted: s3.tlsPeerOkay(entry.input.socket, entry.input.pinnedIp) }),
  's3.validateReaderBounds': (entry) => {
    try {
      s3.validateReaderBounds(entry.input.bounds);
      return { accepted: true };
    } catch (error) {
      return { threw: true, message: error.message };
    }
  },
  's3.constants': () => ({
    constants: {
      maxBytes: s3.MAX_BYTES,
      maxMs: s3.MAX_MS,
      maxRedirects: s3.MAX_REDIRECTS,
      redirectCodes: s3.S3_GUARD_FACTS.redirectCodes,
      reservedCidrCount: s3.S3_GUARD_FACTS.reservedCidrs.length,
    },
  }),
  's3.readLoop': (entry) =>
    (async () => {
      const policy = {
        admitInitial: (uri) => admit(entry.input.policy, uri),
        admitRedirect: (uri) => admit(entry.input.policy, uri),
      };
      const seams = {
        resolvePublic: async (hostname) => s3.classifyDnsAnswers(entry.input.resolve[hostname], true),
        hop: async (parsed) => entry.input.hops[parsed.href] ?? { kind: 'failure', reason: 'HTTP_REJECTED' },
      };
      const reader = s3.createPinnedPublicS3HttpsReader(policy, entry.input.bounds, seams);
      const result = await reader.read(entry.input.uri);
      if (result.ok) {
        return { ok: true, visited: [...result.visited], byteCount: result.bytes.length };
      }
      return { ok: false, reason: result.reason };
    })(),
  's3.readerSeamsRequired': (entry) => {
    try {
      s3.createPinnedPublicS3HttpsReader(entry.input.policy, entry.input.bounds);
      return { threw: false };
    } catch (error) {
      return { threw: true, message: error.message };
    }
  },
};

const assertExpect = (result, expect, entry) => {
  assert.ok(result !== undefined, `${entry.id}: dispatch returned undefined`);
  if ('ok' in expect && ('visited' in expect || 'reason' in expect)) {
    assert.equal(result.ok, expect.ok, `${entry.id}: readLoop ok`);
    if (expect.visited) assert.deepStrictEqual(result.visited, expect.visited, `${entry.id}: visited`);
    if ('reason' in expect) assert.equal(result.reason, expect.reason, `${entry.id}: reason`);
    if ('byteCount' in expect) assert.equal(result.byteCount, expect.byteCount, `${entry.id}: byteCount`);
    return;
  }
  if (expect.ok === true) {
    assert.equal(result.ok, true, `${entry.id}: expected acceptance`);
    for (const [key, value] of Object.entries(expect.value_contains ?? {})) {
      assert.deepStrictEqual(result.value[key], value, `${entry.id}: value.${key}`);
    }
    for (const key of expect.value_not_keys ?? []) {
      assert.ok(!(key in result.value), `${entry.id}: unexpected key ${key}`);
    }
    return;
  }
  if (expect.ok === false) {
    assert.equal(result.ok, false, `${entry.id}: expected refusal`);
    assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length >= 1, `${entry.id}: diagnostics`);
    assert.equal(result.diagnostics[0].code, expect.code, `${entry.id}: diagnostic code`);
    assert.equal(result.diagnostics[0].field, expect.field, `${entry.id}: diagnostic field`);
    return;
  }
  if ('passed' in expect) {
    assert.equal(result.passed, expect.passed, `${entry.id}: guard passed`);
    if ('left' in expect) assert.deepStrictEqual(result.left, expect.left, `${entry.id}: guard left`);
    if ('right' in expect) assert.deepStrictEqual(result.right, expect.right, `${entry.id}: guard right`);
    return;
  }
  if ('transition' in expect) {
    assert.equal(result.transition, expect.transition, `${entry.id}: transition`);
    assert.equal(result.targetState, expect.targetState, `${entry.id}: targetState`);
    assert.equal(result.effectIntents.length, expect.effectIntentCount, `${entry.id}: effectIntentCount`);
    if (expect.effect) {
      assert.equal(result.effectIntents.length, 1, `${entry.id}: effect subset needs one intent`);
      for (const [key, value] of Object.entries(expect.effect)) {
        assert.deepStrictEqual(result.effectIntents[0][key], value, `${entry.id}: effect.${key}`);
      }
    }
    if (expect.projectionKeys) {
      assert.deepStrictEqual(
        Object.keys(result.effectIntents[0].input),
        expect.projectionKeys,
        `${entry.id}: projectionKeys`,
      );
    }
    return;
  }
  if ('valid' in expect) {
    assert.equal(result.valid, expect.valid, `${entry.id}: decisionSchema valid`);
    return;
  }
  if ('throws' in expect) {
    assert.equal(result.threw, true, `${entry.id}: expected throw`);
    if (expect.messagePrefix) {
      assert.ok(result.message.startsWith(expect.messagePrefix), `${entry.id}: message prefix`);
    }
    if (expect.message) {
      assert.equal(result.message, expect.message, `${entry.id}: exact message`);
    }
    return;
  }
  if ('constants' in expect) {
    assert.deepStrictEqual(result.constants, expect.constants, `${entry.id}: constants`);
    return;
  }
  if ('routeFacts' in expect) {
    assert.deepStrictEqual(result.routeFacts, expect.routeFacts, `${entry.id}: routeFacts`);
    return;
  }
  if ('intent' in expect) {
    for (const [key, value] of Object.entries(expect.intent)) {
      assert.deepStrictEqual(result.intent[key], value, `${entry.id}: intent.${key}`);
    }
    return;
  }
  if ('plainDataOnly' in expect) {
    assert.equal(result.plainDataOnly, expect.plainDataOnly, `${entry.id}: plainDataOnly`);
    return;
  }
  if ('neverExecuted' in expect) {
    assert.equal(result.neverExecuted, expect.neverExecuted, `${entry.id}: neverExecuted`);
    return;
  }
  if ('accepted' in expect) {
    assert.equal(result.accepted, expect.accepted, `${entry.id}: accepted`);
    if ('hostname' in expect) assert.equal(result.hostname, expect.hostname, `${entry.id}: hostname`);
    if ('pinnedIp' in expect) assert.equal(result.pinnedIp, expect.pinnedIp, `${entry.id}: pinnedIp`);
    return;
  }
  throw new Error(`${entry.id}: unmatched expect shape ${JSON.stringify(expect)}`);
};

test('refinement witness is machine-readable, engineering-only, and blob-consistent with the merged crosswalk', () => {
  assert.equal(refinement.schema, 'formal-tools/g4-xdownload-product-refinement/0.1');
  assert.equal(refinement.status, 'ENGINEERING_ONLY_NOT_QUALIFIED');
  const authority = refinement.authority;
  assert.equal(authority.qualified_solution, 'NOT_ADMITTED');
  assert.equal(authority.positive_replay, false);
  assert.equal(authority.effect, false);
  assert.equal(authority.source_owner_adoption, 'NOT_APPROVED');
  assert.equal(authority.product_claim_version, 'NOT_FROZEN');
  assert.equal(authority.professional_oracle, 'NOT_ATTESTED');
  assert.equal(authority.host_signing, 'NOT_ATTESTED');
  assert.equal(authority.trust_roots, 'NOT_CONFIGURED');
  assert.equal(authority.formal_authority, 'ENGINEERING_ONLY');
  const expectedBlobs = {};
  for (const source of crosswalk.product.sources) {
    const role =
      source.role === 'business'
        ? 'business'
        : source.role === 'intent'
          ? 'intent'
          : source.role === 'composition'
            ? 'composition'
            : 'https';
    expectedBlobs[role] = { path: source.path, git_blob: source.git_blob };
  }
  assert.deepStrictEqual(refinement.source_pin.blob_map, expectedBlobs);
  assert.equal(refinement.source_pin.exact_commit, crosswalk.product.exact_commit);
  const ids = refinement.witness.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'witness ids are unique');
  const anchorKeys = new Set([...Object.keys(refinement.source_pin.blob_map), 'business+composition']);
  for (const entry of refinement.witness) {
    assert.ok(anchorKeys.has(entry.anchor.file), `${entry.id}: anchor file ${entry.anchor.file}`);
    assert.ok(typeof entry.anchor.fact === 'string' && entry.anchor.fact.length > 0, `${entry.id}: anchor fact`);
    assert.ok(['POS', 'NEG'].includes(entry.kind), `${entry.id}: kind`);
    assert.ok(dispatch[entry.exec], `${entry.id}: unknown exec ${entry.exec}`);
  }
});

test('every witness case executes and matches its expected verdict exactly', async (t) => {
  for (const entry of refinement.witness) {
    await t.test(entry.id, async () => {
      const result = await dispatch[entry.exec](entry);
      assertExpect(result, entry.expect, entry);
    });
  }
});

test('POS-02: T01 grammar accepts 1048577 while T03 profile refuses the effect intent (exact 1048576/1048577 boundary)', () => {
  const base = {
    requestId: 'req-1',
    lineageId: 'lin-1',
    targetRef: 'asset-1',
    outputRootScope: '/srv/downloads',
    allowedOperation: 'acquisition.acquire',
    slice: 'S3',
    caller: { actor: 'requester', sessionRef: 'session-1' },
  };
  const atProfile = t01.validateConfirmedIntent({ ...base, declaredBytes: 1048576 });
  const oneAbove = t01.validateConfirmedIntent({ ...base, declaredBytes: 1048577 });
  assert.equal(atProfile.ok, true);
  assert.equal(oneAbove.ok, true, 'T01 grammar bound is 1 TiB, so 1048577 parses');
  const dispatchAtProfile = t03.decideDownloadConfirmed({ ...base, declaredBytes: 1048576 });
  const dispatchOneAbove = t03.decideDownloadConfirmed({ ...base, declaredBytes: 1048577 });
  assert.equal(dispatchAtProfile.transition, 'acquire');
  assert.equal(dispatchAtProfile.effectIntents[0].effectType, 'effect:acquire');
  assert.equal(dispatchAtProfile.effectIntents[0].executed, false);
  assert.equal(dispatchOneAbove.transition, 'refuse');
  assert.equal(dispatchOneAbove.effectIntents.length, 0);
  assert.equal(t03.evaluateGuardDeclaredBytes({ declaredBytes: 1048576 }).passed, true);
  assert.equal(t03.evaluateGuardDeclaredBytes({ declaredBytes: 1048577 }).passed, false);
});

test('T01 1 TiB grammar bound is exact and stays distinct from the T03 1 MiB profile', () => {
  const base = {
    requestId: 'req-1',
    lineageId: 'lin-1',
    targetRef: 'asset-1',
    outputRootScope: '/srv/downloads',
    allowedOperation: 'acquisition.acquire',
    slice: 'S3',
    caller: { actor: 'requester', sessionRef: 'session-1' },
  };
  const atGrammarMax = t01.validateConfirmedIntent({ ...base, declaredBytes: 1099511627776 });
  const aboveGrammarMax = t01.validateConfirmedIntent({ ...base, declaredBytes: 1099511627777 });
  assert.equal(atGrammarMax.ok, true);
  assert.equal(aboveGrammarMax.ok, false);
  assert.equal(aboveGrammarMax.diagnostics[0].code, 'MALFORMED_REQUIRED_FIELD');
  const decided = t03.decideDownloadConfirmed({ ...base, declaredBytes: 1099511627776 });
  assert.equal(decided.transition, 'refuse', 'grammar-max intent still refuses at the T03 profile');
});

test('declaredBytes absent: T01 accepts the optional field while T03 never dispatches (undefined fails lte)', () => {
  const base = {
    requestId: 'req-1',
    lineageId: 'lin-1',
    targetRef: 'asset-1',
    outputRootScope: '/srv/downloads',
    allowedOperation: 'acquisition.acquire',
    slice: 'S3',
    caller: { actor: 'requester', sessionRef: 'session-1' },
  };
  const checked = t01.validateConfirmedIntent(base);
  assert.equal(checked.ok, true);
  assert.ok(!('declaredBytes' in checked.value));
  const decided = t03.decideDownloadConfirmed(base);
  assert.equal(decided.transition, 'refuse');
  assert.equal(decided.effectIntents.length, 0);
});

test('five frozen SMT QF_UF abstraction gaps are machine-readably documented with executable replacements', async () => {
  assert.equal(gaps.schema, 'formal-tools/g4-smt-abstraction-gaps/0.1');
  assert.equal(gaps.status, 'ENGINEERING_ONLY_NOT_QUALIFIED');
  assert.equal(gaps.gaps.length, 5);
  const caseFiles = gaps.gaps.map((gap) => gap.smt_case);
  assert.ok(
    caseFiles.every((file) => file.startsWith('cases/')),
    'gap cases point into the frozen cases/ directory',
  );
  for (const file of caseFiles) {
    await assert.doesNotReject(
      () => readFile(new URL(file, g4Root)),
      `frozen SMT case ${file} must exist untouched`,
    );
    const text = await readFile(new URL(file, g4Root), 'utf8');
    assert.ok(text.includes('(set-logic QF_UF)'), `${file} stays a frozen QF_UF case`);
  }
  const witnessIdsSet = new Set(refinement.witness.map((entry) => entry.id));
  for (const gap of gaps.gaps) {
    const witnessIds = gap.executable_replacement.witness_ids;
    assert.ok(witnessIds.length >= 1, `${gap.id}: needs executable replacements`);
    for (const id of witnessIds) {
      assert.ok(witnessIdsSet.has(id), `${gap.id}: witness ${id} must exist`);
    }
  }
  const referenced = new Set(gaps.gaps.flatMap((gap) => gap.executable_replacement.witness_ids));
  assert.ok(referenced.size >= 10, 'five gaps collectively reference a substantive witness subset');
});

test('the S3 guard model is network-free: DNS and byte transport are required injected seams', () => {
  const bounds = { maxBytes: 1048576, timeoutMs: 1000, maxRedirects: 2 };
  assert.throws(
    () => s3.createPinnedPublicS3HttpsReader({}, bounds),
    /requires injected resolvePublic\/hop seams/,
  );
  assert.throws(
    () => s3.createPinnedPublicS3HttpsReader({}, bounds, { resolvePublic: () => {} }),
    /requires injected resolvePublic\/hop seams/,
  );
});
