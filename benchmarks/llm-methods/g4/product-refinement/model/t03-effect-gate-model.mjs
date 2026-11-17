/**
 * H1 Source→Model refinement of the original xDownload T03 business
 * acquisition policy (pure decision layer), ported from the merged #163
 * source snapshots
 *   original/packages/download-domain-app/src/business/business-download.mjs
 *     (Git Blob a7dba9a896de0b84fc6d54093563adca2ccbcdfc)
 *   original/packages/download-domain-app/src/business/composition.ts
 *     (Git Blob 616c353fd7c38c6612b320e48750ac4c99fef2c0)
 * (original repo kaicreator-mm/xDownload @ e904f08c478b15147b1c07fbe53c610d2d81851f).
 *
 * WHAT IS MODELLED: the `requested --acquire--> acquired` transition with its
 * `guard:declared-bytes-ok` 1 MiB profile gate, the `refuse` fallback, the
 * `effect:acquire` input projection (exact T01 confirmed-intent fields) and
 * the pure `confirmDownloadRequest` seal step. The model OUTPUTS a declarative
 * effect INTENT (plain data, `executed:false`) — it NEVER executes an Effect,
 * mints no permit, calls no capability and performs no byte transport. The
 * live one-time permit / durable K→C re-check / `acquisition.acquire` run
 * remain governed K/Host obligations outside this model.
 */

import { validateConfirmedIntent } from './t01-intent-model.mjs';

export const MODULE_ID = 'business-download@0.2.0-t03';
export const PACKAGE_KIND = 'business';
export const ABI_VERSION = 'v08-business-abi/1';
export const ENDPOINTS = [{ endpointId: 'business:download', kind: 'business-policy' }];

export const INTENT_TYPES = ['confirmDownload'];
export const EFFECT_TYPES = ['effect:acquire'];

/**
 * v0.2 T03 application-profile bound on the confirmed intent's declaredBytes.
 * The T01 contract maximum (MAX_DECLARED_BYTES, 1 TiB) remains the contract
 * grammar bound; THIS sealed policy additionally refuses to dispatch an
 * acquisition effect for a confirmed intent declaring more than 1 MiB in the
 * v0.2 T03 profile (the same bounded profile the #183 PoC drove).
 */
export const DECLARED_BYTES_PROFILE_BOUND = 1_048_576;

export const GUARD_DECLARED_BYTES_OK = {
  guardId: 'guard:declared-bytes-ok',
  predicate: {
    op: 'lte',
    left: { source: 'event', path: ['payload', 'declaredBytes'] },
    right: { source: 'literal', value: 1_048_576 },
  },
};

export const INTENT_FIELD_PROJECTION = {
  requestId: { source: 'event', path: ['payload', 'requestId'] },
  lineageId: { source: 'event', path: ['payload', 'lineageId'] },
  targetRef: { source: 'event', path: ['payload', 'targetRef'] },
  outputRootScope: { source: 'event', path: ['payload', 'outputRootScope'] },
  allowedOperation: { source: 'event', path: ['payload', 'allowedOperation'] },
  slice: { source: 'event', path: ['payload', 'slice'] },
  digestAnchor: { source: 'event', path: ['payload', 'digestAnchor'] },
  declaredBytes: { source: 'event', path: ['payload', 'declaredBytes'] },
  caller: { source: 'event', path: ['payload', 'caller'] },
};

/** Frozen T01 operation vocabulary the sealed route must stay inside. */
export const FROZEN_ROUTE_FACTS = {
  acquisitionRoute: {
    intentId: 'confirmDownload',
    operationId: 'acquisition.acquire',
    capabilityId: 'acquisition',
    handlerId: 'acquire',
  },
  sealedOperationDeclaration: {
    operationId: 'acquisition.acquire',
    capabilityId: 'acquisition',
    handlerId: 'acquire',
    effectClass: 'non-idempotent',
    externalEffect: true,
  },
  effectResource: { key: 'acquisition', operation: 'acquisition.acquire' },
  effectExternal: { permitTtlMs: 60_000, await: 'terminal' },
  effectSemantics: 'non-idempotent',
  triggerEventType: 'DOWNLOAD_CONFIRMED',
  workflowKey: 'download-acquisition',
  initialState: 'requested',
  states: ['requested', 'acquired', 'refused'],
};

/**
 * Evaluate `guard:declared-bytes-ok` exactly as the sealed kernel interprets
 * the declared predicate (op 'lte', event payload path vs literal). For
 * T01-valid payloads the field is a safe integer in (0, 1 TiB] or undefined;
 * `undefined <= bound` is false, so an intent without declaredBytes never
 * dispatches the effect (it takes the `refuse` transition).
 */
export function evaluateGuardDeclaredBytes(payload) {
  const left = payload === undefined || payload === null ? undefined : payload.declaredBytes;
  const right = GUARD_DECLARED_BYTES_OK.predicate.right.value;
  const passed = left <= right;
  return { guardId: GUARD_DECLARED_BYTES_OK.guardId, passed, left, right };
}

function projectEffectInput(payload) {
  const input = {};
  for (const field of Object.keys(INTENT_FIELD_PROJECTION)) {
    input[field] = payload[field];
  }
  return input;
}

/**
 * Pure decision for the sealed `download-acquisition` policy on a
 * DOWNLOAD_CONFIRMED event: the guard selects the `acquire` transition (which
 * declares one `effect:acquire` INTENT — data only, never executed) or the
 * unguarded `refuse` transition (no effect intent). Mirrors the original
 * business-download.mjs state machine; no kernel, admission or journal here.
 */
export function decideDownloadConfirmed(payload) {
  const guard = evaluateGuardDeclaredBytes(payload);
  if (guard.passed) {
    return {
      transition: 'acquire',
      targetState: 'acquired',
      guardId: guard.guardId,
      effectDispatched: false,
      effectIntents: [
        {
          effectType: 'effect:acquire',
          input: projectEffectInput(payload),
          idempotencyKey: `acquire:download:${payload.requestId}`,
          resource: { ...FROZEN_ROUTE_FACTS.effectResource },
          external: { ...FROZEN_ROUTE_FACTS.effectExternal },
          executed: false,
        },
      ],
    };
  }
  return {
    transition: 'refuse',
    targetState: 'refused',
    guardId: guard.guardId,
    effectDispatched: false,
    effectIntents: [],
  };
}

/**
 * Kernel ABI decision-record schema (v08-business-abi/1): validates the
 * DERIVED DECISION RECORD the kernel produces when interpreting a sealed
 * intent against this policy, not the raw intent input.
 */
export function decisionSchemaIsValid(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const decision = value.decision;
  const event = value.event;
  if (typeof decision !== 'object' || decision === null || Array.isArray(decision)) return false;
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return false;
  return typeof decision.outcome === 'string' && typeof event.type === 'string';
}

/**
 * Pure `confirmDownloadRequest` step from composition.ts: seal a
 * caller-supplied record into a public download intent through the canonical
 * T01 no-widening validation — unknown fields, raw locators and out-of-bound
 * sizes are refused here, before any K admission exists. No payload bytes are
 * read and no app is built (the sealed-BUILD producer is a separate Host
 * build-time obligation, not part of this model).
 */
export function confirmDownloadRequest(candidate, options) {
  const check = validateConfirmedIntent(candidate);
  if (!check.ok) {
    throw new Error(
      `CONFIRMED_INTENT_INVALID: ${check.diagnostics[0]?.code ?? 'unknown'} — intent refused before send`,
    );
  }
  const confirmed = check.value;
  return {
    confirmed,
    intent: {
      intentType: 'confirmDownload',
      instanceKey: `download-${confirmed.requestId}`,
      messageId: options?.messageId ?? `msg-${confirmed.requestId}`,
      input: { ...confirmed },
    },
  };
}
