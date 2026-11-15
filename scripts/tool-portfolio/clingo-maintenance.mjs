#!/usr/bin/env node
/**
 * Clingo-specific lifecycle freshness assessor.
 *
 * It compares versioned source/package/fixture/runtime/Oracle identity pins.
 * It never executes clingo and never grants qualification. A changed pin
 * invalidates only the gates that depend on it; an unchanged documentation
 * field does not make execution receipts stale.
 *
 * CLI:
 *   node scripts/tool-portfolio/clingo-maintenance.mjs \
 *     --baseline docs/tool-portfolio/r60/CLINGO_T6_MAINTENANCE.json \
 *     --observed path/to/current-observation.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE_SCHEMA = "formal-tools/clingo-maintenance-baseline/1.0";

export const IDENTITY_FIELDS = Object.freeze([
  "version",
  "upstreamRepository",
  "upstreamCommit",
  "sourceSdistSha256",
  "sourceSdistBytesVerified",
  "license",
  "licenseEvidenceBlob",
  "canonicalArchiveSha256",
  "binarySha256",
  "positiveFixtureBlob",
  "negativeFixtureBlob",
  "nativeCatalogBlob",
  "nativeAdapterBlob",
  "toolManagerBlob",
  "cliDriverBlob",
  "sdkDriverBlob",
  "mcpDriverBlob",
  "nativeAcceptanceBlob",
  "runtimeReadmeBlob",
  "buildRecipeBlob",
  "toolchainFingerprint",
  "rebuiltBinarySha256",
  "installRecipeBlob",
  "runtimeImageDigest",
  "runnerImageDigest",
  "oracleId",
  "oracleVersion",
  "oracleCaseBlob"
]);

export const GATE_DEPENDENCIES = Object.freeze({
  T0: Object.freeze([
    "version", "upstreamRepository", "upstreamCommit", "sourceSdistSha256",
    "sourceSdistBytesVerified", "license", "licenseEvidenceBlob",
    "canonicalArchiveSha256"
  ]),
  T1: Object.freeze([
    "version", "upstreamCommit", "sourceSdistSha256",
    "sourceSdistBytesVerified", "buildRecipeBlob", "toolchainFingerprint",
    "rebuiltBinarySha256"
  ]),
  T2: Object.freeze([
    "version", "canonicalArchiveSha256", "binarySha256",
    "installRecipeBlob", "runtimeImageDigest"
  ]),
  T3: Object.freeze([
    "version", "binarySha256", "positiveFixtureBlob", "negativeFixtureBlob",
    "nativeAcceptanceBlob"
  ]),
  T4: Object.freeze([
    "version", "binarySha256", "nativeCatalogBlob", "nativeAdapterBlob",
    "toolManagerBlob", "cliDriverBlob", "sdkDriverBlob", "mcpDriverBlob",
    "runnerImageDigest"
  ]),
  T5: Object.freeze([
    "version", "binarySha256", "positiveFixtureBlob", "negativeFixtureBlob",
    "oracleId", "oracleVersion", "oracleCaseBlob"
  ]),
  T6: IDENTITY_FIELDS
});

const QUALIFIED_STATES = new Set([
  "PASS",
  "PASS_SCOPED",
  "ACCEPTED_SCOPED",
  "MERGED_SCOPED"
]);

const GATE_ACTIONS = Object.freeze({
  T0: "Re-audit upstream release identity, source bytes, license and archive provenance.",
  T1: "Rebuild twice from the exact source with a pinned toolchain; compare binary hashes and run upstream build tests.",
  T2: "Repeat safe archive preflight, non-root installation, dependency doctor and runtime-image checks.",
  T3: "Re-run native POS/NEG/ERR and applicable UNKNOWN/timeout cases with raw argv, streams, exits and hashes.",
  T4: "Re-run exact-current-main Runner, Registry, CLI, SDK and MCP paths with fail-closed negative controls.",
  T5: "Re-run a real source-backed case and independent semantic Oracle; do not infer semantics from solver exit status.",
  T6: "Update the maintenance baseline, execute the version-drift regression, and revalidate every affected gate."
});

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateBaseline(baseline) {
  if (!baseline || baseline.schema !== BASELINE_SCHEMA) {
    throw new TypeError("baseline schema must be " + BASELINE_SCHEMA);
  }
  if (baseline.toolId !== "clingo") {
    throw new TypeError("baseline toolId must be clingo");
  }
  if (!baseline.identity || typeof baseline.identity !== "object") {
    throw new TypeError("baseline identity object is required");
  }
  if (!baseline.gateStatus || typeof baseline.gateStatus !== "object") {
    throw new TypeError("baseline gateStatus object is required");
  }
  const missing = IDENTITY_FIELDS.filter(field => !hasOwn(baseline.identity, field));
  if (missing.length) {
    throw new TypeError("baseline is missing identity fields: " + missing.join(", "));
  }
}

export function assessClingoMaintenance(baseline, observed) {
  validateBaseline(baseline);
  if (!observed || observed.toolId !== baseline.toolId) {
    throw new TypeError("observed toolId must match baseline toolId clingo");
  }
  if (!observed.identity || typeof observed.identity !== "object") {
    throw new TypeError("observed identity object is required");
  }

  const missingFields = [];
  const changedFields = [];
  for (const field of IDENTITY_FIELDS) {
    if (!hasOwn(observed.identity, field)) {
      missingFields.push(field);
      continue;
    }
    const baselineValue = baseline.identity[field];
    const observedValue = observed.identity[field];
    if (!sameValue(baselineValue, observedValue)) {
      changedFields.push({ field, baselineValue, observedValue });
    }
  }

  const changed = new Set([
    ...changedFields.map(item => item.field),
    ...missingFields
  ]);
  const affectedGates = Object.keys(GATE_DEPENDENCIES).filter(gate =>
    GATE_DEPENDENCIES[gate].some(field => changed.has(field))
  );
  const staleGates = affectedGates.filter(gate =>
    QUALIFIED_STATES.has(baseline.gateStatus[gate])
  );
  const revalidationGates = affectedGates;
  const requiredActions = revalidationGates.map(gate => ({
    gate,
    previousStatus: baseline.gateStatus[gate] ?? "UNKNOWN",
    action: GATE_ACTIONS[gate]
  }));

  let status = "FRESH";
  if (missingFields.length) status = "INCOMPLETE_OBSERVATION";
  else if (changedFields.length) status = "STALE_REVERIFY_REQUIRED";

  return {
    schema: "formal-tools/clingo-maintenance-assessment/1.0",
    toolId: baseline.toolId,
    baselineVersion: baseline.identity.version,
    observedVersion: hasOwn(observed.identity, "version")
      ? observed.identity.version
      : null,
    status,
    changedFields,
    missingFields,
    staleGates,
    revalidationGates,
    requiredActions,
    qualificationGranted: false,
    note: "This assessment only detects evidence freshness. It does not execute the tool, verify an Oracle, or grant T0-T6/Product/Release qualification."
  };
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--baseline" || arg === "--observed") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(arg + " requires a file path");
      }
      result[arg.slice(2)] = value;
      i += 1;
    } else if (arg === "--help") {
      result.help = true;
    } else {
      throw new Error("unknown argument: " + arg);
    }
  }
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write("Usage: node scripts/tool-portfolio/clingo-maintenance.mjs --baseline <baseline.json> --observed <observation.json>\n");
    return 0;
  }
  if (!args.baseline || !args.observed) {
    throw new Error("both --baseline and --observed are required");
  }
  const [baseline, observed] = await Promise.all([
    readJson(args.baseline),
    readJson(args.observed)
  ]);
  const assessment = assessClingoMaintenance(baseline, observed);
  process.stdout.write(JSON.stringify(assessment, null, 2) + "\n");
  return assessment.status === "FRESH" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write("clingo-maintenance: " + error.message + "\n");
    process.exitCode = 1;
  });
}
