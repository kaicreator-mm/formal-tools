/**
 * Capability validation ledger (I24 r176) — read-only overlay on the frozen G1
 * discovery index (registry/PROBLEM_CAPABILITIES.json, schema 0.1).
 *
 * Binds each of the 36 registered tools to its actual native capability-probe
 * receipt from the deployed portable bundle, with sha256 receipt binding.
 * r181: nuxmv/prob were rebound from portable-lane receipts to container-native
 * receipts produced by the refreshed formal-tools:deb13-r1 image sweep.
 * This layer never launches tools and never upgrades a lifecycle gate: a
 * capability probe is technical evidence, not T3/T4/T5/T6/Product acceptance.
 * The G1 discovery registry stays untouched and remains the only source of
 * capability vocabulary and tool/capability mapping.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { REGISTRY_PATH, readCapabilityRegistry } from "./problem-capabilities.mjs";

export const VALIDATION_PATH = new URL("../../../registry/CAPABILITY_VALIDATION.json", import.meta.url);

const STATUSES = new Set(["NATIVE_PROBE_PASS_SCOPED", "PORTABLE_LANE_PASS_SCOPED", "NOT_VERIFIED"]);
const PROBE_QUALITIES = new Set(["EFFECTIVE", "INEFFECTIVE_OUTPUT", "NOT_PROBED"]);
const PROBE_STATUSES = new Set(["PROBED", "NOT_PROBED_UNAVAILABLE"]);
const SHA_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const PHASES = new Set(["setup", "pos", "neg", "err"]);
// Versioned sweep-receipt roots: r176 = original deployed-bundle sweep; r181 = refreshed
// image (deb13-r1) sweep that rebound the two r0-era UNAVAILABLE tools. Explicit
// allowlist stays fail-closed against fabricated receipt locations.
const RECEIPT_ROOTS = ["docs/tool-portfolio/r176/receipts/", "docs/tool-portfolio/r181/receipts/"];
const isVersionedReceiptRef = (ref) =>
  typeof ref === "string" && RECEIPT_ROOTS.some((root) => ref.startsWith(root));

const DEFAULT_REPO_ROOT = new URL("../../../", import.meta.url);
const sha256RepoFile = (repoRelativePath) =>
  createHash("sha256").update(readFileSync(new URL(repoRelativePath, DEFAULT_REPO_ROOT))).digest("hex");

const hasOnlyFields = (record, names) =>
  record && typeof record === "object" && !Array.isArray(record) &&
  Object.keys(record).every((name) => names.includes(name));
const isSha = (value) => typeof value === "string" && SHA_RE.test(value);
const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const stringArray = (value, max = 8) =>
  Array.isArray(value) && value.length > 0 && value.length <= max &&
  value.every((x) => nonEmptyString(x) && x.length <= 200);

/**
 * Validate the capability validation ledger against the frozen discovery index.
 * `receiptHasher` maps an evidence_ref/relative repo path to its sha256; the
 * default reads from the repository working tree so tampered receipts or a
 * stale ledger fail closed.
 */
export function validateCapabilityValidation(input, {
  discovery = readCapabilityRegistry(),
  receiptHasher = sha256RepoFile,
} = {}) {
  const issues = [];
  const fail = (message) => issues.push(message);
  if (!hasOnlyFields(input, ["schema", "status", "authority", "semantics", "scope_rules", "counts", "tools"])) {
    fail("unexpected registry fields");
    return { ok: false, issues };
  }
  if (input.schema !== "formal-tools/capability-validation/0.1") fail("wrong schema");
  if (input.status !== "PROBE_VALIDATED_SCOPED_NOT_FORMAL_ACCEPTANCE") fail("invalid validation status");

  if (!hasOnlyFields(input.authority, ["discovery_registry", "discovery_registry_schema", "portfolio_issue",
    "closed_product_issue", "base_main_sha", "deployment", "bundle_manifest_sha256", "tool_runner_sha256",
    "sweep_summary", "sweep_summary_sha256", "probe_harness", "output_label", "r181_refresh"]))
    fail("unexpected authority fields");
  else {
    if (input.authority.discovery_registry !== "registry/PROBLEM_CAPABILITIES.json") fail("wrong discovery registry authority");
    if (input.authority.discovery_registry_schema !== discovery.schema) fail("discovery schema mismatch");
    if (input.authority.portfolio_issue !== 24) fail("portfolio issue must be 24");
    if (input.authority.closed_product_issue !== 11) fail("closed product issue must be recorded as 11");
    if (!GIT_SHA_RE.test(input.authority.base_main_sha ?? "") ||
        !isSha(input.authority.bundle_manifest_sha256) ||
        !isSha(input.authority.tool_runner_sha256) || !isSha(input.authority.sweep_summary_sha256))
      fail("authority provenance hashes must be sha256 (base_main_sha: 40-hex git sha)");
    if (!nonEmptyString(input.authority.sweep_summary) || !nonEmptyString(input.authority.probe_harness) ||
        !nonEmptyString(input.authority.output_label)) fail("authority must bind sweep summary, harness and output label");
    if (isSha(input.authority.sweep_summary_sha256)) {
      try {
        if (receiptHasher(input.authority.sweep_summary) !== input.authority.sweep_summary_sha256)
          fail("sweep summary hash mismatch");
      } catch { fail("sweep summary unreadable"); }
    }
    if (input.authority.r181_refresh !== undefined) {
      const refresh = input.authority.r181_refresh;
      if (!hasOnlyFields(refresh, ["sweep_summary", "sweep_summary_sha256", "deployment",
        "bundle_manifest_sha256", "tool_runner_sha256", "rebound_tools", "executed_at_utc"]))
        fail("unexpected r181 refresh authority fields");
      else {
        if (refresh.sweep_summary !== "docs/tool-portfolio/r181/SWEEP_SUMMARY.json")
          fail("r181 refresh must bind its own committed sweep summary");
        if (!isSha(refresh.sweep_summary_sha256) || !isSha(refresh.bundle_manifest_sha256) ||
            !isSha(refresh.tool_runner_sha256))
          fail("r181 refresh provenance hashes must be sha256");
        if (!nonEmptyString(refresh.deployment) || !nonEmptyString(refresh.executed_at_utc))
          fail("r181 refresh must record deployment and execution time");
        if (!Array.isArray(refresh.rebound_tools) || !refresh.rebound_tools.length ||
            !refresh.rebound_tools.every(nonEmptyString))
          fail("r181 refresh must list its rebound tools");
        if (isSha(refresh.sweep_summary_sha256)) {
          try {
            if (receiptHasher(refresh.sweep_summary) !== refresh.sweep_summary_sha256)
              fail("r181 sweep summary hash mismatch");
          } catch { fail("r181 sweep summary unreadable"); }
        }
      }
    }
  }

  if (!hasOnlyFields(input.semantics, ["status_enum", "probe_quality_enum", "warning"]) ||
      !Array.isArray(input.semantics.status_enum) || input.semantics.status_enum.length !== STATUSES.size ||
      !input.semantics.status_enum.every((s) => STATUSES.has(s)) ||
      !Array.isArray(input.semantics.probe_quality_enum) || input.semantics.probe_quality_enum.length !== PROBE_QUALITIES.size ||
      !input.semantics.probe_quality_enum.every((s) => PROBE_QUALITIES.has(s)) ||
      !nonEmptyString(input.semantics.warning))
    fail("invalid semantics metadata");
  if (!Array.isArray(input.scope_rules) || input.scope_rules.length < 3 || !input.scope_rules.every(nonEmptyString))
    fail("scope rules required");

  const discoveryMap = new Map(discovery.tools.map((t) => [t.id, t]));
  const rows = Array.isArray(input.tools) ? input.tools : [];
  if (!Array.isArray(input.tools) || rows.length !== discoveryMap.size)
    fail(`tool rows must cover exactly the ${discoveryMap.size} discovery-registered tools`);
  const seen = new Set();
  const recount = { native: 0, portable: 0, not_verified: 0, effective: 0 };
  for (const row of rows) {
    if (!hasOnlyFields(row, ["id", "origin", "capability_ids", "status", "evidence_ref", "evidence_sha256",
      "verify_verdict", "verify_phases", "declared_version", "probed_version", "probe_status", "probe_quality",
      "probe_note", "container_probe_receipt", "version_drift", "applicable_problems", "io", "limitations"])) {
      fail("unexpected validation row fields: " + (row?.id ?? "?"));
      continue;
    }
    const source = discoveryMap.get(row.id);
    if (!source) { fail("unknown tool id: " + row.id); continue; }
    if (seen.has(row.id)) fail("duplicate validation row: " + row.id);
    seen.add(row.id);
    if (row.origin !== source.origin) fail("origin drift vs discovery registry: " + row.id);
    if (JSON.stringify(row.capability_ids) !== JSON.stringify(source.capability_ids))
      fail("capability mapping must be inherited verbatim from the discovery registry: " + row.id);
    if (!STATUSES.has(row.status)) fail("unknown validation status: " + row.id);
    if (!PROBE_QUALITIES.has(row.probe_quality)) fail("unknown probe quality: " + row.id);
    if (!PROBE_STATUSES.has(row.probe_status)) fail("unknown probe status: " + row.id);
    if (!Array.isArray(row.verify_phases) || !row.verify_phases.length ||
        !row.verify_phases.every((p) => PHASES.has(p)))
      fail("invalid verify phases: " + row.id);
    if (!stringArray(row.applicable_problems, 5)) fail("invalid applicable_problems: " + row.id);
    if (!hasOnlyFields(row.io, ["inputs", "outputs"]) ||
        !stringArray(row.io?.inputs) || !stringArray(row.io?.outputs))
      fail("invalid io contract: " + row.id);
    if (!nonEmptyString(row.limitations)) fail("missing limitations: " + row.id);
    if (row.version_drift !== null &&
        (!hasOnlyFields(row.version_drift, ["declared", "probed", "note"]) ||
         !nonEmptyString(row.version_drift?.declared) || !nonEmptyString(row.version_drift?.probed) ||
         !nonEmptyString(row.version_drift?.note)))
      fail("invalid version drift record: " + row.id);
    if (row.probe_note !== null && !nonEmptyString(row.probe_note)) fail("invalid probe note: " + row.id);

    if (row.status === "NATIVE_PROBE_PASS_SCOPED") {
      recount.native += 1;
      if (!isVersionedReceiptRef(row.evidence_ref))
        fail("native probe row must bind a versioned sweep receipt (r176 or r181): " + row.id);
      if (!isSha(row.evidence_sha256)) fail("native probe row must sha256-bind its receipt: " + row.id);
      else {
        try {
          if (receiptHasher(row.evidence_ref) !== row.evidence_sha256) fail("receipt hash mismatch: " + row.id);
        } catch { fail("receipt unreadable: " + row.id); }
      }
      if (row.verify_verdict !== "PASS") fail("native probe status requires verify PASS: " + row.id);
      if (!row.verify_phases.includes("pos")) fail("native probe row must include a positive phase: " + row.id);
      if (row.probe_status !== "PROBED") fail("native probe row requires a probe attempt: " + row.id);
      if (row.container_probe_receipt !== null) fail("native probe row must not carry the unavailable-lane receipt: " + row.id);
      if (row.probe_quality === "EFFECTIVE") recount.effective += 1;
    } else if (row.status === "PORTABLE_LANE_PASS_SCOPED") {
      recount.portable += 1;
      if (row.evidence_ref !== `portable/status/receipts/verify-${row.id}.json`)
        fail("portable lane row must cite the merged verify receipt: " + row.id);
      if (row.evidence_sha256 !== null) fail("portable lane row must not sha256-bind a container receipt: " + row.id);
      if (!hasOnlyFields(row.container_probe_receipt, ["path", "sha256", "records"]) ||
          !isSha(row.container_probe_receipt?.sha256) ||
          !row.container_probe_receipt.path.startsWith("docs/tool-portfolio/r176/receipts/"))
        fail("portable lane row must retain its honest container-skip receipt: " + row.id);
      else {
        try {
          if (receiptHasher(row.container_probe_receipt.path) !== row.container_probe_receipt.sha256)
            fail("container skip receipt hash mismatch: " + row.id);
        } catch { fail("container skip receipt unreadable: " + row.id); }
      }
      if (row.verify_verdict !== "PASS") fail("portable lane status requires merged verify PASS: " + row.id);
      if (row.probe_status !== "NOT_PROBED_UNAVAILABLE" || row.probe_quality !== "NOT_PROBED")
        fail("portable lane row must record the honest unprobed deployment state: " + row.id);
      if (!nonEmptyString(row.declared_version)) fail("portable lane row requires the merged declared version: " + row.id);
      if (row.probed_version !== null) fail("portable lane row must not fabricate a container probe version: " + row.id);
    } else {
      recount.not_verified += 1;
      if (row.verify_verdict === "PASS") fail("NOT_VERIFIED row must not claim verify PASS: " + row.id);
    }
  }
  const extra = [...discoveryMap.keys()].filter((id) => !seen.has(id));
  if (extra.length) fail("missing validation rows for: " + extra.sort().join(","));

  if (Array.isArray(input.authority?.r181_refresh?.rebound_tools)) {
    for (const id of input.authority.r181_refresh.rebound_tools) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "NATIVE_PROBE_PASS_SCOPED" ||
          !row.evidence_ref.startsWith("docs/tool-portfolio/r181/receipts/"))
        fail("declared rebound tool lacks an r181 native receipt binding: " + id);
    }
  }

  if (!hasOnlyFields(input.counts, ["tools", "capabilities", "native_probe_pass_scoped",
    "portable_lane_pass_scoped", "not_verified", "probe_quality_effective", "probe_quality_ineffective",
    "probe_not_probed_unavailable"]))
    fail("unexpected counts fields");
  else {
    const expected = {
      tools: discoveryMap.size,
      capabilities: discovery.capabilities.length,
      native_probe_pass_scoped: recount.native,
      portable_lane_pass_scoped: recount.portable,
      not_verified: recount.not_verified,
      probe_quality_effective: recount.effective,
      probe_quality_ineffective: recount.native - recount.effective,
      probe_not_probed_unavailable: recount.portable,
    };
    if (JSON.stringify(input.counts) !== JSON.stringify(expected))
      fail("counts do not match row-derived values: " + JSON.stringify({ declared: input.counts, derived: expected }));
  }
  return { ok: issues.length === 0, issues };
}

export function loadCapabilityValidation(options) {
  const parsed = JSON.parse(readFileSync(VALIDATION_PATH, "utf8"));
  const report = validateCapabilityValidation(parsed, options);
  if (!report.ok) throw new Error("Capability validation ledger invalid: " + report.issues.join("; "));
  return parsed;
}

/**
 * Deterministic capability → validated tools match. Ranking: native-ref tools
 * first, then candidates, each by id. Availability comes from the validation
 * ledger, capability vocabulary from the frozen discovery index.
 */
export function matchValidatedTools(capabilityIds, { includeNotVerified = false } = {}) {
  if (!Array.isArray(capabilityIds) || !capabilityIds.length ||
      capabilityIds.some((x) => typeof x !== "string" || !x.length))
    throw new TypeError("capabilityIds must be nonempty strings");
  if (typeof includeNotVerified !== "boolean") throw new TypeError("includeNotVerified must be boolean");
  const discovery = readCapabilityRegistry();
  const ledger = loadCapabilityValidation({ discovery });
  const known = new Set(discovery.capabilities.map((c) => c.id));
  const needed = [...new Set(capabilityIds)].sort();
  for (const id of needed) if (!known.has(id)) throw new RangeError("unknown capability: " + id);
  const rows = ledger.tools
    .filter((t) => t.capability_ids.some((c) => needed.includes(c)))
    .filter((t) => includeNotVerified || t.status !== "NOT_VERIFIED")
    .map((t) => ({
      id: t.id,
      origin: t.origin,
      matched_capabilities: t.capability_ids.filter((c) => needed.includes(c)),
      status: t.status,
      probe_quality: t.probe_quality,
      declared_version: t.declared_version,
      probed_version: t.probed_version,
      version_drift: t.version_drift,
      evidence_ref: t.evidence_ref,
      applicable_problems: t.applicable_problems,
      io: t.io,
      limitations: t.limitations,
    }))
    .sort((a, b) => (a.origin === "native-ref" ? 0 : 1) - (b.origin === "native-ref" ? 0 : 1) ||
      a.id.localeCompare(b.id));
  return {
    required_capabilities: needed,
    matches: rows,
    uncovered_capabilities: needed.filter((c) => !rows.some((t) => t.matched_capabilities.includes(c))),
    status: ledger.status,
  };
}
