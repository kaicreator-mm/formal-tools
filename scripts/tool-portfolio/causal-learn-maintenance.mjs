#!/usr/bin/env node
/**
 * causal-learn 0.1.4.8 T6 evidence freshness assessor.
 *
 * Deterministic source/asset identity comparison only. It never executes
 * causal-learn, downloads artifacts, verifies an Oracle, or grants T0-T6.
 *
 * CLI:
 *   node scripts/tool-portfolio/causal-learn-maintenance.mjs
 *     --root . --baseline docs/tool-portfolio/r86/CAUSAL_LEARN_T6_MAINTENANCE.json
 *     --external path/to/observed-assets.json
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE_SCHEMA = "formal-tools/causal-learn-t6-maintenance-baseline/1";
export const RESULT_SCHEMA = "formal-tools/causal-learn-t6-maintenance-result/1";
export const GATES = Object.freeze(["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);
export const SHA1 = /^[a-f0-9]{40}$/i;
export const SHA256 = /^[a-f0-9]{64}$/i;

export const ASSET_GATE_DEPENDENCIES = Object.freeze({
  tool_archive_sha256: Object.freeze(["T0", "T1", "T2", "T3", "T4", "T6"]),
  python313_runtime_sha256: Object.freeze(["T1", "T2", "T3", "T4", "T5", "T6"]),
  portable_core_archive_sha256: Object.freeze(["T2", "T3", "T4", "T6"]),
  upstream_source_sdist_sha256: Object.freeze(["T0", "T1", "T6"]),
  independent_oracle_sha256: Object.freeze(["T5", "T6"])
});

export const GATE_ACTIONS = Object.freeze({
  T0: "Reconfirm the upstream release, source bytes, license/rights, original package bytes and manifest provenance.",
  T1: "Reproduce the package from pinned source with a pinned Python 3.13 toolchain; compare complete dependency and output hashes.",
  T2: "Repeat safe archive preflight, non-root extraction, runtime identity and doctor checks using the canonical portable Python 3.13 bundle.",
  T3: "Re-run exact current fixtures under the canonical portable runtime and current Runner; capture raw argv, inputs, stdout, stderr, exits, duration and hashes.",
  T4: "Revalidate current-main Runner, Registry, gateway, CLI, SDK and MCP paths with typed POS/NEG/ERR outcomes and fail-closed controls.",
  T5: "Run a real source-backed causal-discovery case and an independent domain-semantic Oracle; do not infer business truth from PC graph output alone.",
  T6: "Update this baseline after a reviewed version/source change, execute drift regressions and revalidate every affected gate."
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function gitBlobSha1(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return createHash("sha1")
    .update("blob " + bytes.length + "\0", "utf8")
    .update(bytes)
    .digest("hex");
}

export function validRelativePath(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    value.split("/").every(part => part.length > 0 && part !== "." && part !== "..");
}

export function validateBaseline(baseline) {
  if (!isRecord(baseline) || baseline.schema !== BASELINE_SCHEMA)
    throw new TypeError("baseline schema must be " + BASELINE_SCHEMA);
  if (!SHA1.test(baseline.snapshot_head ?? ""))
    throw new TypeError("baseline snapshot_head must be a Git commit SHA");
  if (!isRecord(baseline.tool) || baseline.tool.id !== "causal-learn" ||
      baseline.tool.version !== "0.1.4.8")
    throw new TypeError("baseline tool identity must be causal-learn 0.1.4.8");
  if (!validRelativePath(baseline.version_source))
    throw new TypeError("baseline version_source must be a safe relative path");
  if (!isRecord(baseline.source_files) || Object.keys(baseline.source_files).length === 0)
    throw new TypeError("baseline source_files must be a nonempty object");

  for (const [path, pin] of Object.entries(baseline.source_files)) {
    if (!validRelativePath(path)) throw new TypeError("unsafe source path: " + path);
    if (!isRecord(pin) || !SHA1.test(pin.git_blob_sha1 ?? ""))
      throw new TypeError("invalid Git blob pin for " + path);
    if (!Array.isArray(pin.gates) || pin.gates.length === 0 ||
        pin.gates.some(gate => !GATES.includes(gate)) ||
        new Set(pin.gates).size !== pin.gates.length)
      throw new TypeError("invalid affected gates for " + path);
  }

  if (!isRecord(baseline.asset_pins))
    throw new TypeError("baseline asset_pins must be an object");
  for (const key of Object.keys(ASSET_GATE_DEPENDENCIES)) {
    const value = baseline.asset_pins[key];
    if (value !== null && value !== undefined && !SHA256.test(value))
      throw new TypeError("invalid SHA256 baseline pin: " + key);
  }
  if (!isRecord(baseline.gate_revalidation))
    throw new TypeError("baseline gate_revalidation is required");
  for (const gate of GATES) {
    if (!Array.isArray(baseline.gate_revalidation[gate]) ||
        baseline.gate_revalidation[gate].length === 0 ||
        baseline.gate_revalidation[gate].some(item => typeof item !== "string" || !item.trim()))
      throw new TypeError("baseline gate_revalidation." + gate + " must be a nonempty string array");
  }
  if (!isRecord(baseline.qualification_boundary))
    throw new TypeError("baseline qualification_boundary is required");
  for (const gate of GATES) {
    if (typeof baseline.qualification_boundary[gate] !== "string" ||
        !baseline.qualification_boundary[gate].trim())
      throw new TypeError("qualification boundary missing " + gate);
  }
  if (typeof baseline.qualification_boundary.product_or_release !== "string")
    throw new TypeError("qualification boundary product_or_release is required");
  return baseline;
}

function addReasons(map, gates, reason) {
  for (const gate of gates) {
    if (!map.has(gate)) map.set(gate, new Set());
    map.get(gate).add(reason);
  }
}

function compareIdentity({ name, expected, observed, gates, pattern, stale, unknown, changes }) {
  if (expected === null || expected === undefined) {
    addReasons(unknown, gates, name + ": baseline identity is not established");
    return;
  }
  if (observed === null || observed === undefined || observed === "") {
    addReasons(unknown, gates, name + ": current observed identity is missing");
    return;
  }
  if (pattern && (!pattern.test(expected) || !pattern.test(observed))) {
    addReasons(unknown, gates, name + ": malformed identity hash");
    return;
  }
  if (String(expected).toLowerCase() !== String(observed).toLowerCase()) {
    addReasons(stale, gates, name + ": identity changed");
    changes.push({ name, expected, observed, gates });
  }
}

export function assessCausalLearnMaintenance(baselineInput, current) {
  const baseline = validateBaseline(baselineInput);
  if (!isRecord(current)) throw new TypeError("current observation must be an object");
  if (current.missing_source_paths !== undefined &&
      (!Array.isArray(current.missing_source_paths) ||
       current.missing_source_paths.some(path => typeof path !== "string")))
    throw new TypeError("current missing_source_paths must be an array of strings");
  if (current.missing_version_source !== undefined &&
      typeof current.missing_version_source !== "boolean")
    throw new TypeError("current missing_version_source must be boolean");

  const stale = new Map();
  const unknown = new Map();
  const changes = [];
  const missingSourcePaths = new Set(current.missing_source_paths ?? []);
  const trackedPaths = new Set([...Object.keys(baseline.source_files), baseline.version_source]);
  for (const path of missingSourcePaths) {
    if (!trackedPaths.has(path))
      throw new TypeError("current missing_source_paths contains an untracked path: " + path);
  }

  if (current.missing_version_source === true || missingSourcePaths.has(baseline.version_source)) {
    addReasons(stale, GATES, "version_source: pinned build receipt is missing");
    changes.push({
      name: "tool_version",
      expected: baseline.tool.version,
      observed: null,
      gates: GATES
    });
  } else {
    compareIdentity({
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
      changes.push({
        name: "source_blob:" + path,
        expected: pin.git_blob_sha1,
        observed: null,
        gates: pin.gates
      });
      continue;
    }
    compareIdentity({
      name: "source_blob:" + path,
      expected: pin.git_blob_sha1,
      observed: current.source_blobs?.[path] ?? null,
      gates: pin.gates,
      pattern: SHA1,
      stale,
      unknown,
      changes
    });
  }

  for (const [key, gates] of Object.entries(ASSET_GATE_DEPENDENCIES)) {
    compareIdentity({
      name: key,
      expected: baseline.asset_pins[key] ?? null,
      observed: current.asset_pins?.[key] ?? null,
      gates,
      pattern: SHA256,
      stale,
      unknown,
      changes
    });
  }

  const staleGates = GATES.filter(gate => stale.has(gate));
  const unknownGates = GATES.filter(gate => unknown.has(gate) && !stale.has(gate));
  const affectedGates = GATES.filter(gate => stale.has(gate) || unknown.has(gate));
  const revalidationRequired = {};
  for (const gate of affectedGates) {
    revalidationRequired[gate] = {
      reasons: [
        ...(stale.has(gate) ? [...stale.get(gate)] : []),
        ...(unknown.has(gate) ? [...unknown.get(gate)] : [])
      ],
      actions: baseline.gate_revalidation[gate]
    };
  }

  const status = staleGates.length > 0
    ? "STALE"
    : unknownGates.length > 0
      ? "UNKNOWN"
      : "CURRENT";

  return {
    schema: RESULT_SCHEMA,
    tool: baseline.tool.id,
    baseline_version: baseline.tool.version,
    observed_version: current.version ?? null,
    baseline_head: baseline.snapshot_head,
    status,
    stale_gates: staleGates,
    unknown_gates: unknownGates,
    affected_gates: affectedGates,
    changes,
    revalidation_required: revalidationRequired,
    qualification_granted: false,
    qualification_boundary: baseline.qualification_boundary,
    note: "Identity/freshness assessment only. It does not execute causal-learn, prove a reproducible build, admit installation, verify current Runner/CLI/SDK/MCP routes, establish an independent causal Oracle, or grant Product/Release."
  };
}

function isPathInsideRoot(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== "" && pathFromRoot !== "." &&
    pathFromRoot !== ".." && !pathFromRoot.startsWith(".." + sep) &&
    !isAbsolute(pathFromRoot);
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
      throw new TypeError(finalComponent
        ? "pinned evidence path must be a regular non-symlink file: " + relativePath
        : "pinned evidence path contains a symlinked parent component: " + relativePath);
    }
    if (finalComponent ? !info.isFile() : !info.isDirectory())
      throw new TypeError("pinned evidence path must resolve through directories to a regular file: " + relativePath);
  }

  const physicalPath = await realpath(cursor);
  if (!isPathInsideRoot(root, physicalPath))
    throw new TypeError("pinned evidence path resolves outside root: " + relativePath);

  const handle = await open(physicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new TypeError("pinned evidence path is not a regular file: " + relativePath);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function normalizeAssetPins(value) {
  if (!isRecord(value)) throw new TypeError("external asset evidence must be a JSON object");
  const normalized = {};
  for (const key of Object.keys(ASSET_GATE_DEPENDENCIES)) {
    const candidate = value[key];
    normalized[key] = typeof candidate === "string" && SHA256.test(candidate)
      ? candidate.toLowerCase()
      : null;
  }
  return normalized;
}

function resolveExternalPath(root, externalPath) {
  if (typeof externalPath !== "string" || externalPath.length === 0 ||
      externalPath.includes("\0") || externalPath.split(/[\\/]/).includes(".."))
    throw new TypeError("external evidence path must be a safe path inside root");
  if (!validRelativePath(externalPath))
    throw new TypeError("external evidence path must be a safe relative path");
  const absolutePath = resolve(root, externalPath);
  if (!isPathInsideRoot(root, absolutePath))
    throw new TypeError("external evidence path must remain inside root");
  return relative(root, absolutePath).split(sep).join("/");
}

export async function readCurrentCausalLearnState(root, baselineInput, externalPath = null) {
  const baseline = validateBaseline(baselineInput);
  const absoluteRoot = await realpath(resolve(root));
  const rootInfo = await lstat(absoluteRoot);
  if (!rootInfo.isDirectory()) throw new TypeError("causal-learn maintenance root must be a directory");

  const sourceBlobs = {};
  const missingSourcePaths = [];
  for (const path of Object.keys(baseline.source_files)) {
    try {
      sourceBlobs[path] = gitBlobSha1(await readRegularFile(absoluteRoot, path));
    } catch (error) {
      if (error?.code === "ENOENT") {
        sourceBlobs[path] = null;
        missingSourcePaths.push(path);
      } else {
        throw error;
      }
    }
  }

  let version = null;
  let missingVersionSource = false;
  try {
    const bytes = await readRegularFile(absoluteRoot, baseline.version_source);
    const receipt = JSON.parse(bytes.toString("utf8"));
    version = typeof receipt.version === "string" ? receipt.version : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      missingVersionSource = true;
      if (!missingSourcePaths.includes(baseline.version_source))
        missingSourcePaths.push(baseline.version_source);
    } else {
      throw error;
    }
  }

  let assetPins = Object.fromEntries(Object.keys(ASSET_GATE_DEPENDENCIES).map(key => [key, null]));
  if (externalPath !== null) {
    const safePath = resolveExternalPath(absoluteRoot, externalPath);
    try {
      const raw = await readRegularFile(absoluteRoot, safePath);
      assetPins = normalizeAssetPins(JSON.parse(raw.toString("utf8")));
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

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    baseline: "docs/tool-portfolio/r86/CAUSAL_LEARN_T6_MAINTENANCE.json",
    external: null,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (!["--root", "--baseline", "--external"].includes(flag))
      throw new TypeError("unknown option: " + flag);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new TypeError("missing value for " + flag);
    options[flag.slice(2)] = value;
    index += 1;
  }
  return options;
}

export async function runCausalLearnMaintenanceCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Usage: node scripts/tool-portfolio/causal-learn-maintenance.mjs [--root <dir>] [--baseline <relative-json>] [--external <relative-json>]\n");
    return 0;
  }
  const root = await realpath(resolve(options.root));
  const baselineBytes = await readRegularFile(root, options.baseline);
  const baseline = JSON.parse(baselineBytes.toString("utf8"));
  const current = await readCurrentCausalLearnState(root, baseline, options.external);
  const result = assessCausalLearnMaintenance(baseline, current);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.status === "CURRENT" ? 0 : result.status === "STALE" ? 2 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCausalLearnMaintenanceCli().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write("CAUSAL_LEARN_MAINTENANCE_ERROR: " + String(error) + "\n");
    process.exitCode = 64;
  });
}
