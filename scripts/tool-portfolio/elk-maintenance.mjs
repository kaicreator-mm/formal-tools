#!/usr/bin/env node
/**
 * ELK 0.6.0 T6 maintenance assessor.
 * This is a deterministic identity/freshness check only; it never executes ELK.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const GATES = ["T0", "T1", "T2", "T3", "T4", "T5", "T6"];
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const ALL_GATES = new Set(GATES);

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
    value.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
}

export function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline))
    throw new TypeError("baseline must be an object");
  if (baseline.schema !== "formal-tools/elk-t6-maintenance-baseline/1")
    throw new TypeError("unsupported ELK maintenance baseline schema");
  if (baseline.tool?.id !== "elk" || baseline.tool?.version !== "0.6.0")
    throw new TypeError("baseline tool identity must be elk 0.6.0");
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
  for (const key of ["portable_package_sha256", "upstream_source_archive_sha256", "binary_sha256", "oracle_sha256"]) {
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

function comparePin({ name, expected, observed, gates, hashPattern = null, stale, unknown, changes }) {
  if (expected === null || expected === undefined) {
    addReasons(unknown, gates, name + ": baseline pin is not established");
    return;
  }
  if (observed === null || observed === undefined || observed === "") {
    addReasons(unknown, gates, name + ": current evidence is missing");
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

export function assessElkMaintenance(baselineInput, current) {
  const baseline = validateBaseline(baselineInput);
  if (!current || typeof current !== "object" || Array.isArray(current))
    throw new TypeError("current state must be an object");

  const stale = new Map();
  const unknown = new Map();
  const changes = [];
  const unknownEvidence = [];
  if (current.missing_source_paths !== undefined &&
      (!Array.isArray(current.missing_source_paths) ||
       current.missing_source_paths.some(path => typeof path !== "string"))) {
    throw new TypeError("current missing_source_paths must be an array of paths");
  }
  const missingSourcePaths = new Set(current.missing_source_paths ?? []);
  const trackedPaths = new Set([...Object.keys(baseline.source_files), baseline.version_source]);
  for (const path of missingSourcePaths) {
    if (!trackedPaths.has(path))
      throw new TypeError("current missing_source_paths contains an untracked path: " + path);
  }
  if (current.missing_version_source !== undefined && typeof current.missing_version_source !== "boolean") {
    throw new TypeError("current missing_version_source must be boolean");
  }

  if (current.missing_version_source === true || missingSourcePaths.has(baseline.version_source)) {
    addReasons(stale, GATES, "version_source: tracked builder file is missing");
    changes.push({ name: "tool_version", expected: baseline.tool.version, observed: null, gates: GATES });
  } else {
    comparePin({
      name: "tool_version",
      expected: baseline.tool.version,
      observed: current.version ?? null,
      gates: GATES,
      stale,
      unknown,
      changes
    });
  }

  for (const [path, pin] of Object.entries(baseline.source_files)) {
    if (missingSourcePaths.has(path)) {
      addReasons(stale, pin.gates, "source_blob:" + path + ": tracked source file is missing");
      changes.push({ name: "source_blob:" + path, expected: pin.git_blob_sha1, observed: null, gates: pin.gates });
      continue;
    }
    comparePin({
      name: "source_blob:" + path,
      expected: pin.git_blob_sha1,
      observed: current.source_blobs?.[path] ?? null,
      gates: pin.gates,
      hashPattern: SHA1,
      stale,
      unknown,
      changes
    });
  }

  const assetGates = {
    portable_package_sha256: ["T0", "T2", "T3", "T4", "T6"],
    upstream_source_archive_sha256: ["T0", "T1", "T6"],
    binary_sha256: ["T1", "T2", "T3", "T4", "T5", "T6"],
    oracle_sha256: ["T5", "T6"]
  };
  for (const key of Object.keys(assetGates)) {
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
      actions: baseline.gate_revalidation[gate] ?? ["Review changed ELK evidence and revalidate this gate."]
    };
  }
  for (const [gate, reasons] of unknown.entries()) {
    unknownEvidence.push({ gate, reasons: Array.from(reasons) });
  }

  const status = staleGates.length ? "STALE" : unknownGates.length ? "UNKNOWN" : "CURRENT";
  return {
    schema: "formal-tools/elk-t6-maintenance-result/1",
    tool: "elk",
    baseline_head: baseline.snapshot_head,
    status,
    stale_gates: staleGates,
    unknown_gates: unknownGates,
    changes,
    unknown_evidence: unknownEvidence,
    revalidation_required: revalidationRequired,
    qualification_boundary: baseline.qualification_boundary,
    component_applicability: baseline.component_applicability,
    note: "Deterministic identity/drift assessment only. It does not execute ELK, prove a reproducible T1 build, admit original-package T4, provide an independent T5 Oracle, or grant Product/Release."
  };
}

function parseCliArgs(args) {
  const options = {
    root: process.cwd(),
    baseline: "docs/tool-portfolio/r82/ELK_T6_MAINTENANCE.json",
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
    upstream_source_archive_sha256: normalize(value.upstream_source_archive_sha256),
    binary_sha256: normalize(value.binary_sha256),
    oracle_sha256: normalize(value.oracle_sha256)
  };
}

function isPathInsideRoot(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== "" && pathFromRoot !== "." &&
    pathFromRoot !== ".." && !pathFromRoot.startsWith(".." + sep) &&
    !isAbsolute(pathFromRoot);
}

function resolveExternalRelativePath(root, externalPath) {
  if (typeof externalPath !== "string" || externalPath.length === 0 ||
      externalPath.includes("\0") || externalPath.split(/[\\/]/).includes("..")) {
    throw new TypeError("external evidence path must be a safe path inside root");
  }
  if (!isAbsolute(externalPath) && !validRelativePath(externalPath)) {
    throw new TypeError("external evidence path must be a safe relative path");
  }
  const absolutePath = isAbsolute(externalPath)
    ? resolve(externalPath)
    : resolve(root, externalPath);
  if (!isPathInsideRoot(root, absolutePath)) {
    throw new TypeError("external evidence path must remain inside root");
  }
  const relativePath = relative(root, absolutePath).split(sep).join("/");
  if (!validRelativePath(relativePath)) {
    throw new TypeError("external evidence path must be a safe relative path inside root");
  }
  return relativePath;
}

async function readRegularFile(root, relativePath) {
  if (!validRelativePath(relativePath))
    throw new TypeError("pinned evidence path must be a safe relative path: " + relativePath);
  const absolutePath = resolve(root, relativePath);
  if (!isPathInsideRoot(root, absolutePath))
    throw new TypeError("pinned evidence path escapes root: " + relativePath);

  const components = relative(root, absolutePath).split(sep);
  let cursor = root;
  for (let index = 0; index < components.length; index += 1) {
    cursor = resolve(cursor, components[index]);
    const info = await lstat(cursor);
    const finalComponent = index === components.length - 1;
    if (info.isSymbolicLink()) {
      const message = finalComponent
        ? "pinned evidence path must be a regular non-symlink file: " + relativePath
        : "pinned evidence path contains a symlinked parent component: " + relativePath;
      throw new TypeError(message);
    }
    if (finalComponent ? !info.isFile() : !info.isDirectory()) {
      throw new TypeError("pinned evidence path must resolve through directories to a regular file: " + relativePath);
    }
  }

  const physicalPath = await realpath(cursor);
  if (!isPathInsideRoot(root, physicalPath))
    throw new TypeError("pinned evidence path resolves outside root: " + relativePath);

  const handle = await open(physicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile())
      throw new TypeError("pinned evidence path must be a regular non-symlink file: " + relativePath);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readCurrentElkState(root, baselineInput, externalPath = null) {
  const baseline = validateBaseline(baselineInput);
  const absoluteRoot = await realpath(resolve(root));
  const rootInfo = await lstat(absoluteRoot);
  if (!rootInfo.isDirectory()) throw new TypeError("ELK maintenance root must be a directory");
  const sourceBlobs = {};
  const missingSourcePaths = [];

  for (const path of Object.keys(baseline.source_files)) {
    try {
      const bytes = await readRegularFile(absoluteRoot, path);
      sourceBlobs[path] = gitBlobSha1(bytes);
    } catch (error) {
      if (error?.code === "ENOENT") {
        sourceBlobs[path] = null;
        missingSourcePaths.push(path);
      } else throw error;
    }
  }

  let version = null;
  let missingVersionSource = false;
  try {
    const builder = (await readRegularFile(absoluteRoot, baseline.version_source)).toString("utf8");
    const match = /^FT_TOOL_VERSION=([^\r\n]+)$/m.exec(builder);
    version = match ? match[1].trim() : null;
  } catch (error) {
    if (error?.code === "ENOENT") missingVersionSource = true;
    else throw error;
  }

  let assetPins = {
    portable_package_sha256: null,
    upstream_source_archive_sha256: null,
    binary_sha256: null,
    oracle_sha256: null
  };
  if (externalPath) {
    const relativeExternalPath = resolveExternalRelativePath(absoluteRoot, externalPath);
    try {
      const raw = (await readRegularFile(absoluteRoot, relativeExternalPath)).toString("utf8");
      assetPins = normalizeExternalPins(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return {
    version,
    source_blobs: sourceBlobs,
    asset_pins: assetPins,
    missing_source_paths: missingSourcePaths,
    missing_version_source: missingVersionSource
  };
}

export async function runElkMaintenanceCli(args = process.argv.slice(2)) {
  const options = parseCliArgs(args);
  const root = resolve(options.root);
  const baseline = JSON.parse(await readFile(resolve(root, options.baseline), "utf8"));
  const current = await readCurrentElkState(root, baseline, options.external);
  const report = assessElkMaintenance(baseline, current);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report.status === "CURRENT" ? 0 : report.status === "STALE" ? 2 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runElkMaintenanceCli().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write("ELK_MAINTENANCE_ERROR: " + String(error) + "\n");
    process.exitCode = 64;
  });
}
