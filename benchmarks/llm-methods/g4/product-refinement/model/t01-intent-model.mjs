/**
 * H1 Source→Model refinement of the original xDownload T01 canonical intent
 * contract, ported 1:1 from the merged #163 source snapshot
 *   benchmarks/llm-methods/g4/product-policy-crosswalk/original/packages/
 *     download-domain-app/src/contracts/intent.ts
 * (original repo kaicreator-mm/xDownload @ e904f08c478b15147b1c07fbe53c610d2d81851f,
 *  Git Blob 173bdb2001a54d5477a09fa00ffc271c379992b2).
 *
 * This is an engineering-only executable model of the ORIGINAL business
 * semantics: exact-key no-widening grammar, opaque-targetRef locator rule,
 * output-root containment, and the 1 TiB v0.2 profile bound. It owns no
 * admission/journal/runtime mechanism, resolves no targetRef, and performs
 * no Host action — the trusted Host still resolves opaque targetRefs to
 * locators exactly as in the original contract.
 */

/** Bounded caller identity riding every confirmed intent (auditable, opaque). */
export const INTENT_FIELD_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const REFERENCE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** v0.2 profile bound: 1 TiB per confirmed intent (T01 grammar, not T03 policy). */
export const MAX_DECLARED_BYTES = 1_099_511_627_776;

const INTENT_FIELDS = [
  'requestId',
  'lineageId',
  'targetRef',
  'outputRootScope',
  'allowedOperation',
  'slice',
  'digestAnchor',
  'declaredBytes',
  'caller',
];

export function diagnostic(code, field, message) {
  return { code, field, message };
}

function fail(diagnostics) {
  return { ok: false, diagnostics };
}

function ok(value) {
  return { ok: true, value };
}

/**
 * Output-root containment grammar: absolute, resolved, no traversal.
 * Diagnostic field is 'outputRoot' (matches the original TS source).
 */
export function validateOutputRoot(root) {
  if (typeof root !== 'string' || root.length === 0 || root.length > 512) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'outputRoot', 'output root must be a bounded path string'),
    ]);
  }
  if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(root)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'outputRoot', 'output root must be an absolute path'),
    ]);
  }
  const segments = root.split(/[\\/]/).filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.includes('..')) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'outputRoot', "output root must not contain '..' segments"),
    ]);
  }
  return ok(root);
}

/** Artifact path containment inside a validated root (no escape, no '..'). */
export function validateArtifactPath(root, artifactPath) {
  const rootCheck = validateOutputRoot(root);
  if (!rootCheck.ok) return rootCheck;
  if (typeof artifactPath !== 'string' || artifactPath.length === 0 || artifactPath.length > 768) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'artifactPath', 'artifact path must be a bounded string'),
    ]);
  }
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  if (!artifactPath.startsWith(normalizedRoot)) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'artifactPath', 'artifact path escapes the authorized output root'),
    ]);
  }
  const remainder = artifactPath.slice(normalizedRoot.length);
  if (/^[\\/]/.test(remainder) === false) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'artifactPath', 'artifact path must be inside the output root'),
    ]);
  }
  const segments = remainder.split(/[\\/]/).filter((segment) => segment.length > 0);
  if (segments.includes('..')) {
    return fail([
      diagnostic('OUTPUT_ROOT_ESCAPED', 'artifactPath', "artifact path must not contain '..'"),
    ]);
  }
  return ok(artifactPath);
}

/**
 * Exact-key no-widening validation of a confirmed download intent. Unknown
 * fields are refused, never dropped silently: the confirmed scope cannot grow
 * between sealing and execution. Check order, diagnostic codes and diagnostic
 * fields mirror the original TS source exactly.
 */
export function validateConfirmedIntent(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'intent', 'confirmed intent must be a plain object'),
    ]);
  }
  const record = input;
  for (const key of Object.keys(record)) {
    if (!INTENT_FIELDS.includes(key)) {
      return fail([
        diagnostic(
          'SCOPE_WIDENING_REFUSED',
          key,
          `unknown field is refused by the no-widening contract: ${key}`,
        ),
      ]);
    }
  }
  for (const key of [
    'requestId',
    'lineageId',
    'targetRef',
    'outputRootScope',
    'allowedOperation',
    'slice',
    'caller',
  ]) {
    if (record[key] === undefined) {
      return fail([diagnostic('MISSING_REQUIRED_FIELD', key, `confirmed intent requires ${key}`)]);
    }
  }
  const requestId = record.requestId;
  if (typeof requestId !== 'string' || !INTENT_FIELD_PATTERN.test(requestId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'requestId',
        'requestId must match ^[a-z0-9][a-z0-9-]{0,63}$',
      ),
    ]);
  }
  const lineageId = record.lineageId;
  if (typeof lineageId !== 'string' || !INTENT_FIELD_PATTERN.test(lineageId)) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'lineageId',
        'lineageId must match ^[a-z0-9][a-z0-9-]{0,63}$',
      ),
    ]);
  }
  const targetRef = record.targetRef;
  const isRawLocator =
    typeof targetRef === 'string' &&
    (/^[a-z][a-z0-9+.-]*:\/\//i.test(targetRef) ||
      /^[/\\]/.test(targetRef) ||
      /^[A-Za-z]:[/\\]/.test(targetRef));
  if (typeof targetRef !== 'string' || isRawLocator || !REFERENCE_TOKEN_PATTERN.test(targetRef)) {
    return fail([
      diagnostic(
        'LOCATOR_SUBSTITUTION_REJECTED',
        'targetRef',
        'targetRef must be an opaque bounded token; raw locators are not a C config authority',
      ),
    ]);
  }
  const outputRootScope = record.outputRootScope;
  const rootCheck = validateOutputRoot(outputRootScope);
  if (!rootCheck.ok) return rootCheck;
  const allowedOperation = record.allowedOperation;
  if (
    typeof allowedOperation !== 'string' ||
    allowedOperation.length === 0 ||
    allowedOperation.length > 128
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'allowedOperation',
        'allowedOperation must be a bounded operation id',
      ),
    ]);
  }
  const slice = record.slice;
  if (slice !== 'S1' && slice !== 'S3') {
    return fail([diagnostic('MALFORMED_REQUIRED_FIELD', 'slice', "slice must be 'S1' or 'S3'")]);
  }
  let digestAnchor;
  if (record.digestAnchor !== undefined) {
    if (typeof record.digestAnchor !== 'string' || !SHA256_PATTERN.test(record.digestAnchor)) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'digestAnchor',
          'digestAnchor must be lowercase 64-hex',
        ),
      ]);
    }
    digestAnchor = record.digestAnchor;
  }
  let declaredBytes;
  if (record.declaredBytes !== undefined) {
    if (
      typeof record.declaredBytes !== 'number' ||
      !Number.isSafeInteger(record.declaredBytes) ||
      record.declaredBytes <= 0 ||
      record.declaredBytes > MAX_DECLARED_BYTES
    ) {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'declaredBytes',
          `declaredBytes must be a safe integer in (0, ${MAX_DECLARED_BYTES}]`,
        ),
      ]);
    }
    declaredBytes = record.declaredBytes;
  }
  const caller = record.caller;
  if (typeof caller !== 'object' || caller === null || Array.isArray(caller)) {
    return fail([
      diagnostic('MALFORMED_REQUIRED_FIELD', 'caller', 'caller must be a plain object'),
    ]);
  }
  const callerRecord = caller;
  if (
    typeof callerRecord.actor !== 'string' ||
    callerRecord.actor.length === 0 ||
    callerRecord.actor.length > 128
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'caller.actor',
        'caller.actor must be a bounded string',
      ),
    ]);
  }
  if (
    typeof callerRecord.sessionRef !== 'string' ||
    callerRecord.sessionRef.length === 0 ||
    callerRecord.sessionRef.length > 256
  ) {
    return fail([
      diagnostic(
        'MALFORMED_REQUIRED_FIELD',
        'caller.sessionRef',
        'caller.sessionRef must be bounded',
      ),
    ]);
  }
  return ok({
    requestId,
    lineageId,
    targetRef,
    outputRootScope: rootCheck.value,
    allowedOperation,
    slice,
    ...(digestAnchor === undefined ? {} : { digestAnchor }),
    ...(declaredBytes === undefined ? {} : { declaredBytes }),
    caller: { actor: callerRecord.actor, sessionRef: callerRecord.sessionRef },
  });
}
