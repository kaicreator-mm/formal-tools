#!/usr/bin/env node
/**
 * TLA+ TLC 1.8.0 T6 maintenance assessor.
 * It checks evidence identity/freshness only and never runs TLC.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { readFile, lstat, realpath, open } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const GATES = ["T0", "T1", "T2", "T3", "T4", "T5", "T6"];
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const ALL_GATES = new Set(GATES);
const ASSET_KEYS = [
  "portable_package_sha256",
  "upstream_jar_sha256",
  "bundled_jar_sha256",
  "java21_runtime_sha256",
  "oracle_sha256"
];

export function gitBlobSha1(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return createHash("sha1")
    .update("blob " + bytes.length + "\0", "utf8")
    .update(bytes)
    .digest("hex");
}

function validRelativePath(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    value.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

export function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline))
    throw new TypeError("baseline must be an object");
  if (baseline.schema !== "formal-tools/tla-tlc-t6-maintenance-baseline/1")
    throw new TypeError("unsupported TLA-TLC maintenance baseline schema");
  if (baseline.tool?.id !== "tla-tlc" || baseline.tool?.version !== "1.8.0")
    throw new TypeError("baseline tool identity must be tla-tlc 1.8.0");
  if (!validRelativePath(baseline.version_source))
    throw new TypeError("baseline version_source must be a safe relative path");
  if (!baseline.source_files || typeof baseline.source_files !== "object" ||
      Array.isArray(baseline.source_files) || Object.keys(baseline.source_files).length === 0)
    throw new TypeError("baseline source_files must be a nonempty object");

  for (const [path, pin] of Object.entries(baseline.source_files)) {
    if (!validRelativePath(path)) throw new TypeError("unsafe source path: " + path);
    if (!pin || typeof pin !== "object" || !SHA1.test(pin.git_blob_sha1 ?? ""))
      throw new TypeError("invalid Git blob pin for " + path);
    if (!Array.isArray(pin.gates) || pin.gates.length === 0 ||
        pin.gates.some(gate => !ALL_GATES.has(gate)) ||
        new Set(pin.gates).size !== pin.gates.length)
      throw new TypeError("invalid affected gates for " + path);
  }

  const assets = baseline.asset_pins;
  if (!assets || typeof assets !== "object" || Array.isArray(assets))
    throw new TypeError("baseline asset_pins must be an object");
  for (const key of ASSET_KEYS) {
    const value = assets[key];
    if (value !== null && value !== undefined && !SHA256.test(value))
      throw new TypeError("invalid SHA256 baseline pin: " + key);
  }
  if (!baseline.gate_revalidation || typeof baseline.gate_revalidation !== "object" ||
      Array.isArray(baseline.gate_revalidation))
    throw new TypeError("baseline gate_revalidation is required");
  if (!baseline.qualification_boundary || typeof baseline.qualification_boundary !== "object")
    throw new TypeError("baseline qualification_boundary is required");
  return baseline;
}

function addReasons(map, gates, reason) {
  for (const gate of gates) {
    if (!map.has(gate)) map.set(gate, new Set());
    map.get(gate).add(reason);
  }
}

function comparePin({ name, expected, observed, gates, hashPattern = null, missingState = "unknown", stale, unknown, changes }) {
  if (expected === null || expected === undefined) {
    addReasons(unknown, gates, name + ": baseline pin is not established");
    return;
  }
  if (observed === null || observed === undefined || observed === "") {
    const target = missingState === "stale" ? stale : unknown;
    const reason = missingState === "stale"
      ? name + ": previously pinned source is missing"
      : name + ": current evidence is missing";
    addReasons(target, gates, reason);
    return;
  }
  if (hashPattern && (!hashPattern.test(expected) || !hashPattern.test(observed))) {
    addReasons(unknown, gates, name + ": malformed hash evidence");
    return;
  }
  if (String(expected).toLowerCase() !== String(observed).toLowerCase()) {
    addReasons(stale, gates, name + ": identity changed");
    changes.push({ name, expected, observed, gates });
  }
}

export function assessTlaTlcMaintenance(baselineInput, current) {
  const baseline = validateBaseline(baselineInput);
  if (!current || typeof current !== "object" || Array.isArray(current))
    throw new TypeError("current state must be an object");

  const stale = new Map();
  const unknown = new Map();
  const changes = [];
  const unknownEvidence = [];

  comparePin({
    name: "tool_version",
    expected: baseline.tool.version,
    observed: current.version ?? null,
    gates: GATES,
    missingState: "stale",
    stale,
    unknown,
    changes
  });

  for (const [path, pin] of Object.entries(baseline.source_files)) {
    comparePin({
      name: "source_blob:" + path,
      expected: pin.git_blob_sha1,
      observed: current.source_blobs?.[path] ?? null,
      gates: pin.gates,
      hashPattern: SHA1,
      missingState: "stale",
      stale,
      unknown,
      changes
    });
  }

  const assetGates = {
    portable_package_sha256: ["T0", "T1", "T2", "T3", "T4", "T5", "T6"],
    upstream_jar_sha256: ["T0", "T1", "T6"],
    bundled_jar_sha256: ["T1", "T2", "T3", "T4", "T5", "T6"],
    java21_runtime_sha256: ["T1", "T2", "T3", "T4", "T5", "T6"],
    oracle_sha256: ["T5", "T6"]
  };
  for (const key of ASSET_KEYS) {
    comparePin({
      name: key,
      expected: baseline.asset_pins[key] ?? null,
      observed: current.asset_pins?.[key] ?? null,
      gates: assetGates[key],
      hashPattern: SHA256,
      stale,
      unknown,
      changes
    });
  }

  const staleGates = GATES.filter(gate => stale.has(gate));
  const unknownGates = GATES.filter(gate => unknown.has(gate) && !stale.has(gate));
  const affected = GATES.filter(gate => stale.has(gate) || unknown.has(gate));
  const revalidationRequired = {};
  for (const gate of affected) {
    revalidationRequired[gate] = {
      reasons: [
        ...(stale.get(gate) ? Array.from(stale.get(gate)) : []),
        ...(unknown.get(gate) ? Array.from(unknown.get(gate)) : [])
      ],
      actions: baseline.gate_revalidation[gate] ?? ["Review changed TLA-TLC evidence and revalidate this gate."]
    };
  }
  for (const [gate, reasons] of unknown.entries()) {
    unknownEvidence.push({ gate, reasons: Array.from(reasons) });
  }

  const status = staleGates.length ? "STALE" : unknownGates.length ? "UNKNOWN" : "CURRENT";
  return {
    schema: "formal-tools/tla-tlc-t6-maintenance-result/1",
    tool: "tla-tlc",
    baseline_head: baseline.snapshot_head,
    build_source_head: baseline.build_source_head,
    status,
    qualification_granted: false,
    stale_gates: staleGates,
    unknown_gates: unknownGates,
    changes,
    unknown_evidence: unknownEvidence,
    revalidation_required: revalidationRequired,
    qualification_boundary: baseline.qualification_boundary,
    component_applicability: baseline.component_applicability,
    note: "Deterministic identity/drift assessment only. It does not execute TLC, turn a prebuilt JAR into a reproducible source build, add an ERR case, admit T4, provide a T5 semantic Oracle, or grant Product/Release."
  };
}

function parseCliArgs(args) {
  const options = {
    root: process.cwd(),
    baseline: "docs/tool-portfolio/r82/TLA_TLC_T6_MAINTENANCE.json",
    external: null
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--root", "--baseline", "--external"].includes(flag))
      throw new TypeError("unknown option: " + flag);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new TypeError("missing value for " + flag);
    options[flag.slice(2)] = value;
  }
  return options;
}

function normalizeExternalPins(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("external asset evidence must be a JSON object");
  const normalize = candidate =>
    typeof candidate === "string" && SHA256.test(candidate)
      ? candidate.toLowerCase()
      : null;
  return {
    portable_package_sha256: normalize(value.portable_package_sha256),
    upstream_jar_sha256: normalize(value.upstream_jar_sha256),
    bundled_jar_sha256: normalize(value.bundled_jar_sha256),
    java21_runtime_sha256: normalize(value.java21_runtime_sha256),
    oracle_sha256: normalize(value.oracle_sha256)
  };
}

function isWithinPhysicalRoot(root, candidate) {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(prefix);
}

async function readRegularFile(root, relativePath) {
  if (!validRelativePath(relativePath))
    throw new TypeError("pinned evidence path must be a safe relative path: " + relativePath);
  const physicalRoot = await realpath(root);
  const segments = relativePath.split("/");
  let current = physicalRoot;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      if (index === segments.length - 1)
        throw new TypeError("pinned evidence path must be a regular non-symlink file: " + relativePath);
      throw new TypeError("pinned evidence path contains a symlinked ancestor: " + relativePath);
    }
    if (index < segments.length - 1 && !info.isDirectory())
      throw new TypeError("pinned evidence path ancestor is not a directory: " + relativePath);
    const physical = await realpath(current);
    if (!isWithinPhysicalRoot(physicalRoot, physical))
      throw new TypeError("pinned evidence path resolves outside physical root: " + relativePath);
  }
  const info = await lstat(current);
  if (!info.isFile() || info.isSymbolicLink())
    throw new TypeError("pinned evidence path must be a regular non-symlink file: " + relativePath);
  const handle = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino)
      throw new TypeError("pinned evidence path changed while opening: " + relativePath);
    const physical = await realpath(current);
    if (!isWithinPhysicalRoot(physicalRoot, physical))
      throw new TypeError("pinned evidence path resolves outside physical root: " + relativePath);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readCurrentTlaTlcState(root, baselineInput, externalPath = null) {
  const baseline = validateBaseline(baselineInput);
  const absoluteRoot = resolve(root);
  const sourceBlobs = {};

  for (const path of Object.keys(baseline.source_files)) {
    try {
      const bytes = await readRegularFile(absoluteRoot, path);
      sourceBlobs[path] = gitBlobSha1(bytes);
    } catch (error) {
      if (error?.code === "ENOENT") sourceBlobs[path] = null;
      else throw error;
    }
  }

  let version = null;
  try {
    const builder = (await readRegularFile(absoluteRoot, baseline.version_source)).toString("utf8");
    const match = /^FT_TOOL_VERSION=([^\r\n]+)$/m.exec(builder);
    version = match ? match[1].trim() : null;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let assetPins = Object.fromEntries(ASSET_KEYS.map(key => [key, null]));
  if (externalPath) {
    let raw = null;
    try {
      raw = (await readRegularFile(absoluteRoot, externalPath)).toString("utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (raw !== null) {
      try {
        assetPins = normalizeExternalPins(JSON.parse(raw));
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
        assetPins = Object.fromEntries(ASSET_KEYS.map(key => [key, null]));
      }
    }
  }
  return { version, source_blobs: sourceBlobs, asset_pins: assetPins };
}

export async function runTlaTlcMaintenanceCli(args = process.argv.slice(2)) {
  const options = parseCliArgs(args);
  const root = resolve(options.root);
  const baseline = JSON.parse(await readFile(resolve(root, options.baseline), "utf8"));
  const current = await readCurrentTlaTlcState(root, baseline, options.external);
  const report = assessTlaTlcMaintenance(baseline, current);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report.status === "CURRENT" ? 0 : report.status === "STALE" ? 2 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runTlaTlcMaintenanceCli().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write("TLA_TLC_MAINTENANCE_ERROR: " + String(error) + "\n");
    process.exitCode = 64;
  });
}
