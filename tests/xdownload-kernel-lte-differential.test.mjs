// G4-P2 lane FORMAL_TOOLS_I11_G4_P2 — original Kernel live `lte` interpretation
// differential trace (review P2-1 of #5945831322 on merged #166).
//
// This suite replays the committed DIFFERENTIAL.json matrix LIVE against the
// byte-exact vendored ORIGINAL kernel mechanism module (xDownload blob
// 68b77d47) and the merged #166 T03 model, asserting per-case that live
// kernel/model observations still match the committed receipt, and that the
// recorded divergence findings keep their exact direction. Engineering-only:
// no effect dispatch port exists anywhere in this suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  KERNEL_SHA256,
  KERNEL_IDENTITY,
  PROVENANCE,
  runMatrix,
} from '../benchmarks/llm-methods/g4/product-refinement/kernel-lte-differential/differential-drive.mjs';

const diffRoot = new URL('../benchmarks/llm-methods/g4/product-refinement/kernel-lte-differential/', import.meta.url);
const receipt = JSON.parse(await readFile(new URL('DIFFERENTIAL.json', diffRoot), 'utf8'));
const provenance = JSON.parse(await readFile(new URL('PROVENANCE.json', diffRoot), 'utf8'));

test('vendored kernel snapshot integrity: sha256 + git blob sha1 + identity constants match the pinned provenance', async () => {
  assert.equal(KERNEL_SHA256, provenance.vendoredKernel.kernelSha256);
  assert.equal(KERNEL_SHA256, 'e1ed59556f8b447b5f559302a893738eeae1d272e3a30ac4545fedfb1da8a3e7');
  assert.deepEqual(KERNEL_IDENTITY, provenance.vendoredKernel.kernelIdentity);
  assert.equal(KERNEL_IDENTITY.moduleId, 'v08-kernel-mechanism@1.0.0');
  assert.equal(KERNEL_IDENTITY.packageKind, 'kernel');
  // Byte-exactness re-proven from disk: the git blob id is sha1 over
  // "blob <size>\0" + bytes, recomputed here without invoking git.
  const bytes = await readFile(fileURLToPath(new URL(PROVENANCE.vendoredFile, diffRoot)));
  const blobSha1 = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(blobSha1, provenance.vendoredKernel.gitBlobSha1);
  assert.equal(PROVENANCE.gitBlobSha1, '68b77d4711a802bc6a3f6f5e73cbc58e769af32f');
});

test('differential receipt structure: 19 cases, zero unclassified, summary consistent', () => {
  assert.equal(receipt.schema, 'formal-tools.i11.g4-p2.kernel-lte-differential/1');
  assert.equal(receipt.summary.total, receipt.cases.length);
  assert.equal(receipt.summary.unclassified, 0);
  assert.equal(receipt.summary.total, 19);
  const counts = {};
  for (const entry of receipt.cases) counts[entry.expect.verdict] = (counts[entry.expect.verdict] ?? 0) + 1;
  assert.deepEqual(counts, {
    MATCH_ACQUIRE: receipt.summary.matchAcquire,
    MATCH_REFUSE: receipt.summary.matchRefuse,
    DIVERGE_MODEL_FAIL_OPEN: receipt.summary.divergeModelFailOpen,
    DIVERGE_KERNEL_ERROR_VS_MODEL_REFUSE: receipt.summary.divergeKernelErrorVsModelRefuse,
  });
});

test('live replay: every committed case matches the live kernel/model observations', async () => {
  const live = await runMatrix(receipt.cases);
  assert.equal(live.length, receipt.cases.length);
  for (let index = 0; index < live.length; index += 1) {
    const got = live[index];
    const want = receipt.cases[index].expect;
    assert.equal(got.id, receipt.cases[index].id, 'case order stable');
    assert.equal(got.verdict, want.verdict, `${got.id} verdict`);

    // Kernel guard envelope (the selectAdmittedTransition observable)
    if (want.kernelGuardEnveloped === 'preparation-error') {
      assert.ok(got.kernelGuard.preparationError, `${got.id}: preparation error recorded`);
      assert.equal(got.kernelGuard.enveloped, undefined);
    } else {
      assert.equal(got.kernelGuard.enveloped, want.kernelGuardEnveloped, `${got.id} enveloped guard`);
      if (want.kernelGuardRaw.threw) {
        assert.equal(got.kernelGuard.raw.threw, true, `${got.id} raw violation`);
        assert.equal(got.kernelGuard.raw.errorName, want.kernelGuardRaw.errorName);
        assert.equal(got.kernelGuard.raw.message, want.kernelGuardRaw.message);
      } else {
        assert.deepEqual(
          { threw: false, passed: got.kernelGuard.raw.passed },
          want.kernelGuardRaw,
          `${got.id} raw boolean`,
        );
      }
    }

    // Kernel admission observable
    if (want.kernelAdmission.kind === 'threw') {
      assert.equal(got.kernelAdmission.kind, 'threw', `${got.id} admission threw`);
      assert.equal(got.kernelAdmission.code, want.kernelAdmission.code);
      assert.equal(got.kernelAdmission.errorName, want.kernelAdmission.errorName);
    } else {
      assert.equal(got.kernelAdmission.kind, want.kernelAdmission.kind, `${got.id} admission kind`);
      assert.equal(got.kernelAdmission.transitionKey, want.kernelAdmission.transitionKey);
      assert.equal(got.kernelAdmission.targetState, want.kernelAdmission.targetState);
      assert.equal(got.kernelAdmission.effectCount, want.kernelAdmission.effectCount);
    }

    // Model side
    assert.equal(got.model.guardPassed, want.modelGuardPassed, `${got.id} model guard`);
    assert.equal(got.model.transition, want.modelTransition, `${got.id} model transition`);
  }
});

test('F1 fail-open family: kernel refuses through real admission while the model acquires', async () => {
  const f1 = receipt.cases.filter((entry) => entry.finding === 'F1');
  assert.deepEqual(
    f1.map((entry) => entry.id),
    ['W-KD-G03', 'W-KD-G04', 'W-KD-G07', 'W-KD-G08', 'W-KD-G19'],
  );
  const live = await runMatrix(f1);
  for (const got of live) {
    // Kernel: raw ordered-comparison violation, enveloped guard false, the
    // REAL central admission then admits the unguarded refuse transition.
    assert.equal(got.kernelGuard.raw.threw, true, `${got.id} kernel raw throws`);
    assert.equal(got.kernelGuard.raw.errorName, 'PredicateContractViolation');
    assert.equal(got.kernelGuard.raw.message, 'ordered comparison requires two numbers or two strings');
    assert.equal(got.kernelGuard.enveloped, false, `${got.id} enveloped false`);
    assert.equal(got.kernelAdmission.kind, 'admitted');
    assert.equal(got.kernelAdmission.transitionKey, 'refuse');
    assert.equal(got.kernelAdmission.effectCount, 0);
    // Model: JS loose coercion acquires (effect INTENT data only).
    assert.equal(got.model.transition, 'acquire', `${got.id} model fail-open`);
    assert.equal(got.model.guardPassed, true);
  }
});

test('F2 error-vs-refuse family: kernel typed preparation failure, model clean refuse', async () => {
  const f2 = receipt.cases.filter((entry) => entry.finding === 'F2');
  assert.deepEqual(f2.map((entry) => entry.id), ['W-KD-G02', 'W-KD-G09', 'W-KD-G10']);
  const live = await runMatrix(f2);
  for (const got of live) {
    assert.ok(got.kernelGuard.preparationError, `${got.id} preparation error`);
    assert.equal(got.kernelGuard.preparationError.errorName, 'PredicateContractViolation');
    assert.equal(got.kernelGuard.preparationError.code, 'PREDICATE_CONTRACT_VIOLATION');
    assert.equal(got.kernelAdmission.kind, 'threw');
    assert.equal(got.kernelAdmission.code, 'PREDICATE_CONTRACT_VIOLATION');
    assert.equal(got.model.transition, 'refuse', `${got.id} model refuses`);
  }
});

test('missing-field case (W-KD-G01): kernel MISSING-operand violation enveloped to refuse; model refuses', async () => {
  const live = await runMatrix([receipt.cases[0]]);
  const got = live[0];
  assert.equal(got.id, 'W-KD-G01');
  assert.equal(got.kernelGuard.raw.threw, true);
  assert.equal(got.kernelGuard.raw.message, 'ordered comparison cannot use a missing operand');
  assert.equal(got.kernelGuard.enveloped, false);
  assert.equal(got.kernelAdmission.kind, 'admitted');
  assert.equal(got.kernelAdmission.transitionKey, 'refuse');
  assert.equal(got.kernelAdmission.targetState, 'refused');
  assert.equal(got.model.transition, 'refuse');
  assert.equal(got.verdict, 'MATCH_REFUSE');
});

test('profile boundary (W-KD-G13/G14): inclusive 1 MiB lte agrees on the T01-valid number domain', async () => {
  const at = receipt.cases.find((entry) => entry.id === 'W-KD-G13');
  const above = receipt.cases.find((entry) => entry.id === 'W-KD-G14');
  const live = await runMatrix([at, above]);
  assert.deepEqual(live.map((entry) => entry.verdict), ['MATCH_ACQUIRE', 'MATCH_REFUSE']);
  assert.equal(live[0].kernelGuard.enveloped, true);
  assert.equal(live[1].kernelGuard.enveloped, false);
});

test('F5 wiring boundary: acquire-direction admission stops typed at the unwired dynamic binding', async () => {
  const acquire = receipt.cases.filter((entry) => entry.expect.verdict === 'MATCH_ACQUIRE');
  const live = await runMatrix(acquire);
  for (const got of live) {
    assert.equal(got.kernelGuard.enveloped, true, `${got.id} guard passes`);
    assert.equal(got.kernelAdmission.kind, 'threw');
    assert.equal(got.kernelAdmission.code, 'ADMISSION_EFFECT_BINDING_UNVALIDATED');
    assert.equal(got.kernelAdmission.stage, 'central-admission');
  }
});

test('engineering-only: the differential receipt and driver dispatch no effect anywhere', () => {
  assert.equal(receipt.authority.formalAuthority, 'ENGINEERING_ONLY');
  assert.match(receipt.authority.noEffect, /no effect ports wired/);
  for (const entry of receipt.cases) {
    if (entry.expect.kernelAdmission.kind === 'admitted') {
      // Every completed admission in this lane is a refuse transition with
      // zero effects — there is no other admitted shape in the receipt.
      assert.equal(entry.expect.kernelAdmission.transitionKey, 'refuse');
      assert.equal(entry.expect.kernelAdmission.effectCount, 0);
    }
  }
});
