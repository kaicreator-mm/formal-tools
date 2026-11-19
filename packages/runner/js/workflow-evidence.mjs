/**
 * Issue #183 V3: hash-bound execution receipts for the typed DAG executor.
 *
 * This module owns the pinned "formal-tools/execution-receipt/1.0" schema and
 * the canonical-JSON rule shared with the executor: recursively sort object
 * keys, no whitespace, UTF-8 bytes. It deliberately knows nothing about
 * processes or tools — the executor feeds it validated step records and it
 * computes the overall verdicts (process EXIT is not a solver answer, a
 * solver answer is not a user claim).
 *
 * Fail-closed invariants: bounded stream copies are <= 4096 bytes, hashes are
 * always over the FULL captured bytes, and a receipt that cannot be built
 * from well-formed data throws instead of guessing.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const EXECUTION_RECEIPT_SCHEMA = "formal-tools/execution-receipt/1.0";
export const ARTIFACT_MANIFEST_SCHEMA = "formal-tools/execution-artifacts/1.0";
export const STEP_STATUSES = Object.freeze([
  "EXECUTED","NOT_RUN","TIMEOUT","ERROR","SKIPPED_DOWNSTREAM"
]);
export const PROCESS_OUTCOMES = Object.freeze(["OK","PARTIAL","FAILED","ABORTED"]);
export const CROSS_TOOL_VERDICTS = Object.freeze([
  "AGREE_SAT","AGREE_UNSAT","CONTRADICTION","UNKNOWN","NOT_APPLICABLE"
]);
export const CLAIM_VERDICTS = Object.freeze([
  "PASS","UNSUPPORTED_BY_MVP","NOT_APPLICABLE","BLOCKED"
]);
export const BOUNDED_BYTES = 4096;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
// source_sha binds the caller's git HEAD: a 40-hex commit SHA (or a full
// 64-hex sha256 when the caller records a content hash instead).
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const STEP_RECORD_FIELDS = Object.freeze([
  "step_id","tool","operation","status","exit_code","elapsed_ms",
  "stdout_sha256","stderr_sha256","stdout_bounded","stderr_bounded",
  "result","artifacts"
]);
const RECEIPT_FIELDS = Object.freeze([
  "schema","run_id","plan_id","plan_sha256","source_sha","created_at",
  "tool_versions","steps","overall","environment"
]);

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical JSON: recursively sorted object keys, no whitespace, UTF-8. */
export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJsonString(value), "utf8");
}
function canonicalJsonString(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number is not canonical JSON");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJsonString).join(",") + "]";
  if (typeof value !== "object") throw new TypeError("value is not JSON-representable: " + typeof value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError("canonical JSON accepts plain objects only");
  const keys = Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJsonString(value[k])).join(",") + "}";
}

/** First `bytes` UTF-8 bytes of a string, as a string (bounded display copy). */
export function boundText(text, bytes = BOUNDED_BYTES) {
  if (typeof text !== "string") throw new TypeError("boundText expects a string");
  return Buffer.from(text, "utf8").subarray(0, bytes).toString("utf8");
}

const isShaOrNull = v => v === null || (typeof v === "string" && SHA_PATTERN.test(v));
const isBoundedOrNull = v => v === null || (typeof v === "string" && Buffer.byteLength(v, "utf8") <= BOUNDED_BYTES);
const isSafeIntOrNull = v => v === null || (Number.isSafeInteger(v) && v >= 0);

function validateStepRecord(r, index) {
  if (r === null || typeof r !== "object" || Array.isArray(r))
    throw new TypeError("step record must be a plain object: index " + index);
  const keys = Object.keys(r);
  if (keys.length !== STEP_RECORD_FIELDS.length || keys.some(k => !STEP_RECORD_FIELDS.includes(k)))
    throw new TypeError("step record field set mismatch: " + String(r.step_id));
  if (typeof r.step_id !== "string" || !ID_PATTERN.test(r.step_id))
    throw new TypeError("invalid step_id in receipt record: " + String(r.step_id));
  if (typeof r.tool !== "string" || !r.tool || r.tool.length > 32)
    throw new TypeError("invalid tool in step record: " + String(r.step_id));
  if (typeof r.operation !== "string" || !r.operation)
    throw new TypeError("invalid operation in step record: " + String(r.step_id));
  if (!STEP_STATUSES.includes(r.status))
    throw new TypeError("invalid step status: " + String(r.status));
  if (!isSafeIntOrNull(r.exit_code) || !isSafeIntOrNull(r.elapsed_ms))
    throw new TypeError("invalid exit_code/elapsed_ms: " + String(r.step_id));
  if (!isShaOrNull(r.stdout_sha256) || !isShaOrNull(r.stderr_sha256))
    throw new TypeError("invalid stream hashes: " + String(r.step_id));
  if (!isBoundedOrNull(r.stdout_bounded) || !isBoundedOrNull(r.stderr_bounded))
    throw new TypeError("stream copies must be null or <= " + BOUNDED_BYTES + " bytes: " + String(r.step_id));
  if (!(r.result === null || (typeof r.result === "object" && !Array.isArray(r.result))))
    throw new TypeError("step result must be null or an object: " + String(r.step_id));
  if (!Array.isArray(r.artifacts))
    throw new TypeError("step artifacts must be an array: " + String(r.step_id));
  for (const a of r.artifacts) {
    if (a === null || typeof a !== "object" || Array.isArray(a) ||
        typeof a.name !== "string" || !a.name || a.name.length > 256 ||
        !isShaOrNull(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes < 0)
      throw new TypeError("invalid artifact entry: " + String(r.step_id));
  }
}

function normalizeAnswer(entry) {
  // entry.answer is an SMT answer token or an LP HiGHS model status.
  if (entry.operation === "solve-smt") return ["sat","unsat","unknown"].includes(entry.answer) ? entry.answer : "unknown";
  if (entry.operation === "solve-lp") {
    if (entry.answer === "kOptimal") return "sat";
    if (entry.answer === "kInfeasible") return "unsat";
    return "unknown";
  }
  return "unknown";
}

function computeOverall(steps, failClosedReason, aborted) {
  const statuses = steps.map(s => s.status);
  let process_outcome;
  if (aborted) process_outcome = "ABORTED";
  else if (statuses.some(s => s === "ERROR" || s === "TIMEOUT")) process_outcome = "FAILED";
  else if (statuses.some(s => s === "SKIPPED_DOWNSTREAM" || s === "NOT_RUN")) process_outcome = "PARTIAL";
  else process_outcome = "OK";

  // Solver answer view: only EXECUTED solve steps contribute; disagreement
  // collapses to value null (the cross_tool_verdict carries the contradiction).
  const byStep = steps
    .filter(s => s.status === "EXECUTED" && ["solve-smt","solve-lp"].includes(s.operation) &&
      s.result !== null && typeof s.result === "object")
    .map(s => ({
      step_id: s.step_id, tool: s.tool, operation: s.operation,
      answer: s.operation === "solve-smt"
        ? (typeof s.result.answer === "string" ? s.result.answer : "unknown")
        : (typeof s.result.model_status === "string" ? s.result.model_status : "unknown")
    }));
  const kinds = [...new Set(byStep.map(x => x.operation))];
  const normalized = byStep.map(x => ({...x, normalized: normalizeAnswer(x)}));
  const distinct = [...new Set(normalized.map(x => x.normalized))];
  const kind = kinds.length === 0 ? "none" : kinds.length === 1 ? kinds[0] : "mixed";
  const value = byStep.length > 0 && distinct.length === 1 && distinct[0] !== "unknown" ? distinct[0] : null;

  const verdicts = new Set(steps
    .filter(s => s.status === "EXECUTED" && s.operation === "cross-check" &&
      s.result !== null && typeof s.result.verdict === "string")
    .map(s => s.result.verdict));
  let cross_tool_verdict;
  if (verdicts.size === 0) cross_tool_verdict = "NOT_APPLICABLE";
  else if (verdicts.has("CONTRADICTION")) cross_tool_verdict = "CONTRADICTION";
  else if (verdicts.size === 1 && verdicts.has("AGREE_SAT")) cross_tool_verdict = "AGREE_SAT";
  else if (verdicts.size === 1 && verdicts.has("AGREE_UNSAT")) cross_tool_verdict = "AGREE_UNSAT";
  else cross_tool_verdict = "UNKNOWN";

  const allDefinitive = normalized.length > 0 &&
    normalized.every(x => x.normalized === "sat" || x.normalized === "unsat");
  let claim_verdict;
  if (process_outcome === "ABORTED") claim_verdict = "BLOCKED";
  else if (process_outcome !== "OK" || failClosedReason) claim_verdict = "UNSUPPORTED_BY_MVP";
  else if (cross_tool_verdict === "AGREE_SAT" || cross_tool_verdict === "AGREE_UNSAT") {
    claim_verdict = allDefinitive ? "PASS" : "UNSUPPORTED_BY_MVP";
  } else if (cross_tool_verdict === "NOT_APPLICABLE") claim_verdict = "NOT_APPLICABLE";
  else claim_verdict = "UNSUPPORTED_BY_MVP";

  return {
    process_outcome, solver_answer: {kind, value, by_step: byStep},
    cross_tool_verdict, claim_verdict
  };
}

/**
 * Build the pinned execution receipt from validated step records.
 * Throws (never guesses) on any shape violation. Pure and deterministic:
 * time, run id, host and source SHA are injected by the caller.
 */
export function buildExecutionReceipt(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("receipt input must be a plain object");
  const {
    plan, plan_sha256, steps, tool_versions, fail_closed_reason = null,
    aborted = false, run_id, source_sha = null, created_at, environment
  } = input;
  if (plan === null || typeof plan !== "object" || Array.isArray(plan) ||
      plan.schema !== "formal-tools/execution-plan/1.0" || typeof plan.plan_id !== "string")
    throw new TypeError("receipt requires a validated execution plan");
  if (typeof plan_sha256 !== "string" || !SHA_PATTERN.test(plan_sha256))
    throw new TypeError("receipt requires the plan sha256");
  if (!Array.isArray(steps) || steps.length === 0)
    throw new TypeError("receipt requires validated step records");
  if (typeof run_id !== "string" || !ID_PATTERN.test(run_id))
    throw new TypeError("invalid run_id");
  if (typeof created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(created_at))
    throw new TypeError("created_at must be an ISO-8601 UTC timestamp");
  if (source_sha !== null && (typeof source_sha !== "string" || !SOURCE_SHA_PATTERN.test(source_sha)))
    throw new TypeError("source_sha must be null, a 40-hex git commit SHA, or a 64-hex sha256");
  if (tool_versions === null || typeof tool_versions !== "object" || Array.isArray(tool_versions))
    throw new TypeError("tool_versions must be a plain object");
  for (const [tool, probe] of Object.entries(tool_versions)) {
    if (typeof tool !== "string" || !tool || probe === null || typeof probe !== "object" ||
        typeof probe.version !== "string" || !probe.version || probe.version.length > 128 ||
        !isShaOrNull(probe.probe_sha256) || !isBoundedOrNull(probe.probe_bounded))
      throw new TypeError("invalid tool_versions entry: " + tool);
  }
  if (environment === null || typeof environment !== "object" || Array.isArray(environment) ||
      typeof environment.host !== "string" || !environment.host ||
      typeof environment.node !== "string" ||
      !(environment.formal_portable_root_sha === null ||
        (typeof environment.formal_portable_root_sha === "string" &&
         SHA_PATTERN.test(environment.formal_portable_root_sha))))
    throw new TypeError("invalid environment block");
  if (fail_closed_reason !== null &&
      (typeof fail_closed_reason !== "string" || !fail_closed_reason || fail_closed_reason.length > 128))
    throw new TypeError("fail_closed_reason must be null or a short code");
  for (const step of steps) validateStepRecord(step, 0);

  const overall = computeOverall(steps, fail_closed_reason, aborted === true);
  const receipt = {
    schema: EXECUTION_RECEIPT_SCHEMA,
    run_id,
    plan_id: plan.plan_id,
    plan_sha256,
    source_sha,
    created_at,
    tool_versions: {...tool_versions},
    steps: steps.map(s => ({...s, artifacts: s.artifacts.map(a => ({...a}))})),
    overall: {...overall, ...(fail_closed_reason ? {fail_closed_reason} : {})},
    environment: {
      host: environment.host,
      node: environment.node,
      formal_portable_root_sha: environment.formal_portable_root_sha ?? null
    }
  };
  const keys = Object.keys(receipt);
  if (keys.length !== RECEIPT_FIELDS.length || keys.some(k => !RECEIPT_FIELDS.includes(k)))
    throw new TypeError("receipt field set mismatch");
  return receipt;
}

const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.\-\/]{0,255}$/;

/**
 * Persist receipt.json, bounded per-step raw logs and a hash manifest under
 * `dir`. Log bytes are written verbatim from the bounded copies so that every
 * committed log file can be re-verified against the receipt hashes. Returns
 * the manifest and the receipt.json sha256.
 */
export async function writeExecutionReceiptArtifacts(dir, receipt, rawStreams = []) {
  if (receipt === null || typeof receipt !== "object" || receipt.schema !== EXECUTION_RECEIPT_SCHEMA)
    throw new TypeError("writeExecutionReceiptArtifacts requires a built execution receipt");
  if (!Array.isArray(rawStreams)) throw new TypeError("rawStreams must be an array");
  const names = new Set();
  const streams = [];
  for (const s of rawStreams) {
    if (s === null || typeof s !== "object" || typeof s.step_id !== "string" ||
        !ID_PATTERN.test(s.step_id) || names.has(s.step_id))
      throw new TypeError("invalid rawStreams entry: " + String(s?.step_id));
    names.add(s.step_id);
    streams.push(s);
  }
  await mkdir(dir, {recursive: true});
  await mkdir(join(dir, "logs"), {recursive: true});
  const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n", "utf8");
  const receiptSha256 = sha256Hex(receiptBytes);
  const artifacts = [{name: "receipt.json", sha256: receiptSha256, bytes: receiptBytes.length}];
  await writeFile(join(dir, "receipt.json"), receiptBytes);
  for (const s of streams) {
    for (const [field, suffix] of [["stdout","stdout"],["stderr","stderr"]]) {
      const text = s[field];
      if (typeof text !== "string" || text.length === 0) continue;
      if (Buffer.byteLength(text, "utf8") > BOUNDED_BYTES)
        throw new TypeError("raw log exceeds bounded size: " + s.step_id);
      const name = `logs/${s.step_id}.${suffix}.txt`;
      const bytes = Buffer.from(text, "utf8");
      await writeFile(join(dir, name), bytes);
      artifacts.push({name, sha256: sha256Hex(bytes), bytes: bytes.length});
    }
  }
  artifacts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const manifest = {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    run_id: receipt.run_id,
    plan_id: receipt.plan_id,
    receipt_sha256: receiptSha256,
    artifacts
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await writeFile(join(dir, "manifest.json"), manifestBytes);
  return {manifest, receipt_sha256: artifacts[0].sha256};
}
