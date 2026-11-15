#!/usr/bin/env node
/**
 * DoWhy-specific T6 identity/freshness assessor.
 *
 * The assessor compares a versioned identity snapshot with an observed
 * snapshot. It does not execute DoWhy, validate a causal Oracle, rebuild the
 * package, or grant T0-T6/Product/Release qualification.
 *
 * CLI:
 *   node scripts/tool-portfolio/dowhy-maintenance.mjs \
 *     --baseline docs/tool-portfolio/r74/DOWHY_T6_MAINTENANCE.json \
 *     --observed path/to/current-observation.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE_SCHEMA = "formal-tools/dowhy-maintenance-baseline/1.0";
export const ASSESSMENT_SCHEMA = "formal-tools/dowhy-maintenance-assessment/1.0";

export const IDENTITY_FIELDS = Object.freeze([
  "version",
  "upstreamRepository",
  "upstreamCommit",
  "sourceSdistSha256",
  "sourceSdistBytesVerified",
  "license",
  "licenseEvidenceBlob",
  "canonicalArchiveDriveId",
  "canonicalArchiveBytes",
  "canonicalArchiveBytesVerified",
  "canonicalArchiveObservedSha256",
  "canonicalArchiveManifestSha256",
  "canonicalArchiveManifestMatch",
  "alternateWheelhouseDriveId",
  "alternateWheelhouseBytes",
  "alternateWheelhouseSha256",
  "alternateWheelhouseManifestSha256",
  "alternateWheelhouseBytesVerified",
  "wheelhousePythonTag",
  "hostPythonVersion",
  "portablePythonRuntimeArchiveSha256",
  "builderBlob",
  "buildToolBlob",
  "metaGeneratorBlob",
  "expectBlob",
  "positiveFixtureBlob",
  "negativeFixtureBlob",
  "runnerBlob",
  "nativeAdapterBlob",
  "nativeCatalogBlob",
  "toolManagerBlob",
  "cliDriverBlob",
  "sdkDriverBlob",
  "toolResultBlob",
  "mcpDriverBlob",
  "portfolioGatewayBlob",
  "portfolioDagBlob",
  "packagerBlob",
  "installRecipeBlob",
  "runtimeImageDigest",
  "toolchainFingerprint",
  "rebuiltPackageTreeSha256",
  "installedPackageTreeSha256",
  "nativeAcceptanceEvidenceRef",
  "oracleId",
  "oracleVersion",
  "oracleCaseBlob"
]);

export const GATE_DEPENDENCIES = Object.freeze({
  T0: Object.freeze([
    "version",
    "upstreamRepository",
    "upstreamCommit",
    "sourceSdistSha256",
    "sourceSdistBytesVerified",
    "license",
    "licenseEvidenceBlob",
    "canonicalArchiveDriveId",
    "canonicalArchiveBytes",
    "canonicalArchiveBytesVerified",
    "canonicalArchiveObservedSha256",
    "canonicalArchiveManifestSha256",
    "canonicalArchiveManifestMatch"
  ]),
  T1: Object.freeze([
    "version",
    "upstreamCommit",
    "sourceSdistSha256",
    "sourceSdistBytesVerified",
    "builderBlob",
    "buildToolBlob",
    "metaGeneratorBlob",
    "packagerBlob",
    "toolchainFingerprint",
    "rebuiltPackageTreeSha256"
  ]),
  T2: Object.freeze([
    "version",
    "alternateWheelhouseDriveId",
    "alternateWheelhouseBytes",
    "alternateWheelhouseSha256",
    "alternateWheelhouseManifestSha256",
    "alternateWheelhouseBytesVerified",
    "wheelhousePythonTag",
    "hostPythonVersion",
    "portablePythonRuntimeArchiveSha256",
    "installRecipeBlob",
    "runtimeImageDigest"
  ]),
  T3: Object.freeze([
    "version",
    "alternateWheelhouseSha256",
    "alternateWheelhouseBytesVerified",
    "wheelhousePythonTag",
    "hostPythonVersion",
    "expectBlob",
    "positiveFixtureBlob",
    "negativeFixtureBlob",
    "nativeAcceptanceEvidenceRef"
  ]),
  T4: Object.freeze([
    "version",
    "alternateWheelhouseSha256",
    "alternateWheelhouseBytesVerified",
    "expectBlob",
    "positiveFixtureBlob",
    "negativeFixtureBlob",
    "runnerBlob",
    "nativeAdapterBlob",
    "nativeCatalogBlob",
    "toolManagerBlob",
    "cliDriverBlob",
    "sdkDriverBlob",
    "toolResultBlob",
    "mcpDriverBlob",
    "portfolioGatewayBlob",
    "portfolioDagBlob",
    "runtimeImageDigest"
  ]),
  T5: Object.freeze([
    "version",
    "installedPackageTreeSha256",
    "positiveFixtureBlob",
    "negativeFixtureBlob",
    "oracleId",
    "oracleVersion",
    "oracleCaseBlob"
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
  T0: "Resolve the original archive/manifest mismatch; verify upstream source bytes, release identity, license and package provenance.",
  T1: "Reproduce the package build from verified source bytes with a pinned toolchain; compare two clean package-tree hashes.",
  T2: "Revalidate the separate CPython 3.13 wheelhouse bytes, ZIP integrity, internal wheel hashes, non-root offline installation and runtime identity.",
  T3: "Re-run the exact DoWhy positive/negative fixtures with raw argv, inputs, stdout, stderr, exits, dependency versions and hashes; preserve the alternate-wheelhouse boundary.",
  T4: "Re-run exact-current-main Runner, candidate portfolio gate, CLI, SDK and MCP routes with the exact package/runtime and fail-closed negative controls.",
  T5: "Run a real source-backed causal case and independent semantic Oracle; validate assumptions, estimand, identification and refutation independently.",
  T6: "Refresh the DoWhy identity snapshot, execute all drift regressions, and revalidate only gates depending on changed identities."
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
  if (baseline.toolId !== "dowhy") {
    throw new TypeError("baseline toolId must be dowhy");
  }
  if (!baseline.identity || typeof baseline.identity !== "object" || Array.isArray(baseline.identity)) {
    throw new TypeError("baseline identity object is required");
  }
  if (!baseline.gateStatus || typeof baseline.gateStatus !== "object") {
    throw new TypeError("baseline gateStatus object is required");
  }
  const missing = IDENTITY_FIELDS.filter(field => !hasOwn(baseline.identity, field));
  if (missing.length) {
    throw new TypeError("baseline is missing identity fields: " + missing.join(", "));
  }
  if (!baseline.gateDependencies || typeof baseline.gateDependencies !== "object") {
    throw new TypeError("baseline gateDependencies object is required");
  }
  for (const gate of Object.keys(GATE_DEPENDENCIES)) {
    if (!sameValue(baseline.gateDependencies[gate], GATE_DEPENDENCIES[gate])) {
      throw new TypeError("baseline gateDependencies mismatch for " + gate);
    }
  }
}

export function assessDoWhyMaintenance(baseline, observed) {
  validateBaseline(baseline);
  if (!observed || observed.toolId !== "dowhy") {
    throw new TypeError("observed toolId must be dowhy");
  }
  if (!observed.identity || typeof observed.identity !== "object" || Array.isArray(observed.identity)) {
    throw new TypeError("observed identity object is required");
  }

  const missingFields = [];
  const unknownFields = [];
  const changedFields = [];

  for (const field of IDENTITY_FIELDS) {
    if (!hasOwn(observed.identity, field) || observed.identity[field] === undefined) {
      missingFields.push(field);
      continue;
    }
    const baselineValue = baseline.identity[field];
    const observedValue = observed.identity[field];

    if (observedValue === null) {
      unknownFields.push(field);
      continue;
    }
    if (baselineValue === null) {
      changedFields.push({
        field,
        baselineValue: null,
        observedValue,
        resolvedPreviouslyUnknown: true
      });
      continue;
    }
    if (!sameValue(baselineValue, observedValue)) {
      changedFields.push({ field, baselineValue, observedValue });
    }
  }

  const changed = new Set([
    ...changedFields.map(item => item.field),
    ...missingFields,
    ...unknownFields
  ]);
  const affectedGates = Object.keys(GATE_DEPENDENCIES).filter(gate =>
    GATE_DEPENDENCIES[gate].some(field => changed.has(field))
  );
  const staleGates = affectedGates.filter(gate =>
    QUALIFIED_STATES.has(baseline.gateStatus[gate])
  );
  const requiredActions = affectedGates.map(gate => ({
    gate,
    previousStatus: baseline.gateStatus[gate] ?? "UNKNOWN",
    action: GATE_ACTIONS[gate]
  }));

  const baselineUnknownFields = IDENTITY_FIELDS.filter(field =>
    baseline.identity[field] === null
  );
  const baselineOpenBlockers = Array.isArray(baseline.openBlockers)
    ? baseline.openBlockers
    : [];

  let status = "FRESH";
  if (missingFields.length || unknownFields.length) {
    status = "INCOMPLETE_OBSERVATION";
  } else if (changedFields.length) {
    status = "STALE_REVERIFY_REQUIRED";
  } else if (baselineUnknownFields.length || baselineOpenBlockers.length) {
    status = "FRESH_UNQUALIFIED";
  }

  return {
    schema: ASSESSMENT_SCHEMA,
    toolId: "dowhy",
    baselineVersion: baseline.identity.version,
    observedVersion: hasOwn(observed.identity, "version") ? observed.identity.version : null,
    status,
    changedFields,
    missingFields,
    unknownFields,
    baselineUnknownFields,
    baselineOpenBlockers,
    staleGates,
    revalidationGates: affectedGates,
    requiredActions,
    qualificationGranted: false,
    note: "Freshness is not qualification. A matching snapshot cannot repair the known archive/manifest mismatch, verify unobserved wheelhouse bytes, establish a reproducible build, execute current-main T4, or grant a causal semantic Oracle."
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
    process.stdout.write("Usage: node scripts/tool-portfolio/dowhy-maintenance.mjs --baseline <baseline.json> --observed <observation.json>\n");
    return 0;
  }
  if (!args.baseline || !args.observed) {
    throw new Error("both --baseline and --observed are required");
  }
  const [baseline, observed] = await Promise.all([
    readJson(args.baseline),
    readJson(args.observed)
  ]);
  const assessment = assessDoWhyMaintenance(baseline, observed);
  process.stdout.write(JSON.stringify(assessment, null, 2) + "\n");
  return ["FRESH", "FRESH_UNQUALIFIED"].includes(assessment.status) ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write("dowhy-maintenance: " + error.message + "\n");
    process.exitCode = 1;
  });
}
