/**
 * G4-P2 differential driver — original xDownload Kernel live `lte` guard
 * interpretation vs the merged #166 T03 model.
 *
 * LANE: kaicreator-mm/formal-tools#11 FORMAL_TOOLS_I11_G4_P2 (claim
 * issuecomment-6960825898, branch task/i11-g4-p2-lte-s3-io-bound-20261118,
 * base main 401f3bb55f5095fb1f131f176b2ea157e3caa212).
 *
 * Everything in this module is EVIDENCE MACHINERY: it loads the byte-exact
 * vendored ORIGINAL kernel mechanism module (blob 68b77d4711a802bc6a3f6f5e73cbc58e769af32f
 * of xDownload e904f08c478b15147b1c07fbe53c610d2d81851f) and the ORIGINAL
 * business policy snapshot (#163), drives the kernel's REAL prepared-guard
 * evaluation path and its REAL central admission entry (real
 * KernelGovernancePinStore/KernelBaselineStore over a minimal CAS document
 * port), and compares against the merged #166 T03 model functions.
 *
 * NO EFFECT DISPATCH EXISTS IN THIS LANE: effect tools/journal/permit ports
 * are never wired. Guard-passing (acquire-direction) admissions are expected
 * to fail typed at the unwired dynamic-binding resolution boundary
 * (ADMISSION_EFFECT_BINDING_UNVALIDATED) — that typed refusal is recorded as
 * the wiring-boundary artifact it is, not silently swallowed. Refuse-direction
 * admissions complete the real central-admission path with zero effects.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPolicy as getOriginalPolicy } from '../../product-policy-crosswalk/original/packages/download-domain-app/src/business/business-download.mjs';
import { evaluateGuardDeclaredBytes, decideDownloadConfirmed } from '../model/t03-effect-gate-model.mjs';

// Snapshot path note: the ORIGINAL path segment `payloads/dist/` cannot be
// reused verbatim because the repo .gitignore excludes any `dist/` directory
// (a forced add would leave the evidence exposed to `git clean -x`). The
// snapshot lives at original-snapshot/kernel-mechanism-v1.mjs with the exact
// source path recorded in PROVENANCE.json and re-proven by digest.
export const KERNEL_FILE_REL = './original-snapshot/kernel-mechanism-v1.mjs';
const KERNEL_FILE_URL = new URL(KERNEL_FILE_REL, import.meta.url);

// The vendored kernel is loaded via a DYNAMIC, non-literal-specifier import.
// This is purely a TYPE-ISOLATION measure: the repo typecheck (tsc checkJs)
// follows static imports transitively and would demand TS-cleanliness from
// the byte-exact historical snapshot, which must stay unmodified. Execution
// is identical — the same bytes, same ESM namespace, loaded before any
// driver function runs.
const kernel = await import(KERNEL_FILE_URL.href);

export const PROVENANCE = {
  sourceRepo: 'kaicreator-mm/xDownload',
  sourceCommit: 'e904f08c478b15147b1c07fbe53c610d2d81851f',
  sourcePath: 'packages/download-domain-app/src/business/payloads/dist/kernel-mechanism-v1.mjs',
  gitBlobSha1: '68b77d4711a802bc6a3f6f5e73cbc58e769af32f',
  vendoredFile: KERNEL_FILE_REL,
  vendorPolicy: 'byte-exact snapshot, no modifications',
};

/** sha256 of the vendored kernel bytes (hex), computed once from disk. */
export const KERNEL_SHA256 = (() => {
  const bytes = readFileSync(fileURLToPath(KERNEL_FILE_URL));
  return createHash('sha256').update(bytes).digest('hex');
})();

/** Kernel identity read back from the vendored module itself. */
export const KERNEL_IDENTITY = {
  moduleId: kernel.MODULE_ID,
  packageKind: kernel.PACKAGE_KIND,
  abiVersion: kernel.ABI_VERSION,
  kernelGeneration: kernel.KERNEL_GENERATION,
};

/** Portable sha256 port the kernel consumes (`digestUtf8` is its only use). */
export const sha256Port = {
  async digestUtf8(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  },
};

/**
 * Minimal in-memory Host document port per the kernel header contract:
 * get(key) → {value, revision} | null; put(key, value, {mustBeAbsent} |
 * {mustMatchRevision}) → {revision} with typed `HOST_CAS_CONFLICT` rejection.
 */
export function makeDocStore() {
  const docs = new Map();
  const revisions = new Map();
  return {
    async get(key) {
      if (!docs.has(key)) return null;
      return { value: docs.get(key), revision: revisions.get(key) ?? 0 };
    },
    async put(key, value, guard) {
      const revision = revisions.get(key) ?? 0;
      if (guard?.mustBeAbsent === true && docs.has(key)) {
        const error = Object.assign(new Error(`HOST_CAS_CONFLICT: ${key} already exists`), { code: 'HOST_CAS_CONFLICT' });
        throw error;
      }
      if (guard?.mustMatchRevision !== undefined && guard.mustMatchRevision !== revision) {
        const error = Object.assign(new Error(`HOST_CAS_CONFLICT: ${key} revision ${guard.mustMatchRevision} != current ${revision}`), { code: 'HOST_CAS_CONFLICT' });
        throw error;
      }
      docs.set(key, value);
      revisions.set(key, revision + 1);
      return { revision: revision + 1 };
    },
  };
}

const GOVERNANCE_SEMANTICS = { hardInvariants: [] };
const BASELINE_INPUT = {
  domainId: 'downloads',
  governanceId: 'i11-g4p2-lte-differential-baseline',
  schemaVersion: 'v08-governance-baseline/1',
  semantics: GOVERNANCE_SEMANTICS,
};
export const WORKFLOW_INSTANCE_ID = 'wf-i11-g4p2-lte-differential';

/**
 * Real kernel governance/baseline stores bound to one in-memory doc store.
 * Uses the vendored kernel's own classes and digest computation — no
 * re-implementation of any kernel logic.
 */
export async function makeAdmissionPorts() {
  const docs = makeDocStore();
  const moduleSha256 = KERNEL_SHA256;
  const governance = new kernel.KernelGovernancePinStore(docs, sha256Port, moduleSha256);
  const baselines = new kernel.KernelBaselineStore(docs);
  const identity = await kernel.computeGovernanceBaselineIdentity(BASELINE_INPUT, sha256Port);
  await baselines.putBody({ identity, semantics: GOVERNANCE_SEMANTICS });
  await governance.bindPin({ workflowInstanceId: WORKFLOW_INSTANCE_ID, governanceBaseline: identity });
  return { governance, baselines };
}

/** The ORIGINAL policy's frozen guard object (module-private in its source). */
export function originalGuard() {
  const policy = getOriginalPolicy();
  const guards = policy.workflowDefinition.guards;
  if (!Array.isArray(guards) || guards.length !== 1 || guards[0].guardId !== 'guard:declared-bytes-ok') {
    throw new Error('original policy guard shape drifted; refusing to differential-run');
  }
  return guards[0];
}

const EVENT_TYPE = 'DOWNLOAD_CONFIRMED';

/**
 * Kernel guard observation, exactly the line selectAdmittedTransition runs:
 *   evaluateDomainWorkflowGuard(prepareDomainWorkflowGuard(guard), input)
 * plus the RAW predicate path (evaluateDomainPredicate) so the enveloped
 * catch→false is distinguishable from a true boolean false.
 */
export function runKernelGuard(payload) {
  let guard;
  let input;
  try {
    guard = kernel.prepareDomainWorkflowGuard(originalGuard());
    input = kernel.prepareDomainPredicateEvaluationInput({
      context: {},
      event: { type: EVENT_TYPE, payload },
    });
  } catch (error) {
    // The kernel refuses non-JSON event material at PREPARATION time, before
    // any predicate evaluation — a distinct observable from enveloped false.
    return {
      enveloped: undefined,
      preparationError: {
        errorName: error instanceof Error ? error.name : String(error),
        code: error?.code,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  const enveloped = kernel.evaluateDomainWorkflowGuard(guard, input);
  let raw;
  try {
    raw = { passed: kernel.evaluateDomainPredicate(guard.predicate, input) };
  } catch (error) {
    raw = {
      threw: true,
      errorName: error instanceof Error ? error.name : String(error),
      code: error?.code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { enveloped, raw };
}

/**
 * Kernel central-admission observation through the REAL admitCentralDecision
 * entry: real pin + baseline stores, real schema gate, real event preparation,
 * real transition selection. No effect ports are wired: refuse-direction
 * admissions complete cleanly; acquire-direction admissions stop typed at the
 * unwired dynamic-binding boundary.
 */
export async function runKernelAdmission(payload, ports, caseId) {
  const policy = getOriginalPolicy();
  const request = {
    workflowInstanceId: WORKFLOW_INSTANCE_ID,
    target: { workflowId: 'download-acquisition', instanceKey: `i11-g4p2-${caseId}` },
    turn: { kind: 'message', sourceMessageId: `msg-i11-g4p2-${caseId}` },
    context: {},
    event: { type: EVENT_TYPE, payload },
    definition: policy.workflowDefinition,
    trigger: { kind: 'event', eventType: EVENT_TYPE },
    currentStateKey: policy.initialStateKey,
    decisionSchema: policy.decisionSchema,
    resolved: {
      source: 'i11-g4p2-differential-harness',
      llmAvoided: true,
      modelCallEvidence: { status: 'unmeasured' },
      cacheDisposition: { read: 'miss' },
      telemetry: [],
      structuredDecision: {
        decision: { outcome: 'differential-guard-observation' },
        event: { type: EVENT_TYPE },
      },
    },
  };
  try {
    const outcome = await kernel.admitCentralDecision(request, {
      governance: ports.governance,
      baselines: ports.baselines,
      sha256: sha256Port,
    });
    if (outcome.status === 'admitted') {
      return {
        kind: 'admitted',
        transitionKey: outcome.admitted.transitionKey,
        targetState: outcome.admitted.targetState,
        effectCount: outcome.admitted.effects.length,
      };
    }
    return {
      kind: 'denied',
      reason: outcome.denial.reason,
      transitionKey: outcome.denial.transitionKey,
      guardId: outcome.denial.guardId,
    };
  } catch (error) {
    return {
      kind: 'threw',
      stage: error instanceof kernel.CentralAdmissionError ? 'central-admission' : 'preparation-or-selection',
      errorName: error instanceof Error ? error.name : String(error),
      code: error?.code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** T03 model observations (merged #166 model, read-only import). */
export function runModel(payload) {
  const guard = evaluateGuardDeclaredBytes(payload);
  const decision = decideDownloadConfirmed(payload);
  return {
    guardPassed: guard.passed === true,
    guardLeft: guard.left,
    transition: decision.transition,
    targetState: decision.targetState,
    effectIntentCount: decision.effectIntents.length,
  };
}

/**
 * Canonical operand materialization. JSON cannot carry `undefined`/`NaN`/
 * `Infinity` (or distinguish an absent key), so special operands are declared
 * as {"$special": name} specs and materialized here — the committed
 * DIFFERENTIAL.json stays valid JSON while the live matrix runs the real
 * values.
 */
export function materializeDeclaredBytes(spec) {
  if (spec === undefined) return { present: false, value: undefined };
  if (spec !== null && typeof spec === 'object' && typeof spec.$special === 'string') {
    if (spec.$special === 'absent') return { present: false, value: undefined };
    if (spec.$special === 'undefined') return { present: true, value: undefined };
    if (spec.$special === 'NaN') return { present: true, value: Number.NaN };
    if (spec.$special === 'Infinity') return { present: true, value: Number.POSITIVE_INFINITY };
    throw new Error(`unknown special operand ${spec.$special}`);
  }
  return { present: true, value: spec };
}

export function materializePayload(entry) {
  const declared = materializeDeclaredBytes(entry.spec);
  const payload = { requestId: `req-${entry.id}` };
  if (declared.present) payload.declaredBytes = declared.value;
  return payload;
}

/**
 * One differential verdict: the kernel is the ORIGINAL interpreter, the model
 * is the merged #166 refinement. MATCH means both sides take the same
 * observable decision direction (acquire-direction vs refuse-direction).
 */
function verdictOf(kernelGuard, kernelAdmission, model) {
  const kernelRefuseDirection =
    (kernelGuard.enveloped === false) ||
    (kernelAdmission.kind === 'admitted' && kernelAdmission.transitionKey === 'refuse') ||
    (kernelAdmission.kind === 'threw');
  const kernelAcquireDirection = kernelGuard.enveloped === true;
  const modelAcquireDirection = model.transition === 'acquire';
  if (kernelAcquireDirection && modelAcquireDirection) return 'MATCH_ACQUIRE';
  if (kernelRefuseDirection && !modelAcquireDirection) {
    return kernelAdmission.kind === 'threw' ? 'DIVERGE_KERNEL_ERROR_VS_MODEL_REFUSE' : 'MATCH_REFUSE';
  }
  if (kernelRefuseDirection && modelAcquireDirection) return 'DIVERGE_MODEL_FAIL_OPEN';
  if (kernelAcquireDirection && !modelAcquireDirection) return 'DIVERGE_MODEL_FAIL_CLOSED';
  return 'UNCLASSIFIED';
}

/** Run the full matrix. `cases` come from the committed DIFFERENTIAL.json. */
export async function runMatrix(cases) {
  const ports = await makeAdmissionPorts();
  const results = [];
  for (const entry of cases) {
    const payload = materializePayload(entry);
    const kernelGuard = runKernelGuard(payload);
    const kernelAdmission = await runKernelAdmission(payload, ports, entry.id);
    const model = runModel(payload);
    const verdict = verdictOf(kernelGuard, kernelAdmission, model);
    results.push({
      id: entry.id,
      verdict,
      kernelGuard: {
        enveloped: kernelGuard.enveloped,
        raw: kernelGuard.raw,
        preparationError: kernelGuard.preparationError,
      },
      kernelAdmission,
      model,
    });
  }
  return results;
}
