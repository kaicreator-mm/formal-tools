#!/usr/bin/env node
/**
 * Alloy-specific T6 identity/freshness assessor.
 *
 * This compares a versioned identity baseline with a current observation.
 * It does not execute Alloy, rebuild the package, validate a business Oracle,
 * or grant T0-T6, Product, or Release qualification.
 *
 * CLI:
 *   node scripts/tool-portfolio/alloy-maintenance.mjs \
 *     --baseline docs/tool-portfolio/r105/ALLOY_T6_MAINTENANCE.json \
 *     --observed path/to/current-observation.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE_SCHEMA = "formal-tools/alloy-t6-maintenance-baseline/1.0";
export const ASSESSMENT_SCHEMA = "formal-tools/alloy-t6-maintenance-assessment/1.0";

export const IDENTITY_FIELDS = Object.freeze([
  "version",
  "upstreamRepository",
  "upstreamReleaseTag",
  "upstreamCommit",
  "upstreamAssetSha256",
  "license",
  "licenseEvidenceRef",
  "canonicalArchiveDriveId",
  "canonicalArchiveBytes",
  "canonicalArchiveSha256",
  "canonicalArchiveBytesVerified",
  "canonicalArchiveManifestDriveId",
  "canonicalArchiveManifestDeclaredSha256",
  "canonicalArchiveManifestMatch",
  "bundledJarSha256",
  "alloyRunnerClassSha256",
  "observedHostJavaVersion",
  "observedHostJavaSha256",
  "portableJavaRuntimeSha256",
  "builderBlob",
  "alloyRunnerSourceBlob",
  "buildToolBlob",
  "metaGeneratorBlob",
  "expectBlob",
  "positiveFixtureBlob",
  "negativeFixtureBlob",
  "errorFixtureBlob",
  "exitContractTestBlob",
  "packagerBlob",
  "manifestGeneratorBlob",
  "unpackerBlob",
  "runnerBlob",
  "nativeAdapterBlob",
  "nativeCatalogBlob",
  "toolManagerBlob",
  "cliDriverBlob",
  "sdkDriverBlob",
  "toolResultBlob",
  "mcpDriverBlob",
  "portfolioGatewayBlob",
  "registryBlob",
  "portfolioDagBlob",
  "auditEvidenceBlob",
  "runtimeImageDigest",
  "toolchainFingerprint",
  "rebuiltPackageTreeSha256",
  "installedPackageTreeSha256",
  "nativeAcceptanceEvidenceRef",
  "oracleId",
  "oracleVersion",
  "oracleCaseBlob"
]);

export const SOURCE_PIN_FIELDS = Object.freeze({
  "portable/builders/tools/alloy.sh": "builderBlob",
  "portable/builders/java-src/AlloyRunner.java": "alloyRunnerSourceBlob",
  "portable/builders/build-tool.sh": "buildToolBlob",
  "portable/builders/make_meta.py": "metaGeneratorBlob",
  "portable/verification/cases/alloy/expect.sh": "expectBlob",
  "portable/verification/cases/alloy/pos.als": "positiveFixtureBlob",
  "portable/verification/cases/alloy/neg.als": "negativeFixtureBlob",
  "portable/verification/cases/alloy/err.als": "errorFixtureBlob",
  "tests/alloy-exit-contract.test.mjs": "exitContractTestBlob",
  "portable/packaging/pack.sh": "packagerBlob",
  "portable/packaging/make-manifest.py": "manifestGeneratorBlob",
  "portable/packaging/unpack-template/unpack.sh": "unpackerBlob",
  "portable/packaging/bundle-template/bin/tool-runner": "runnerBlob",
  "packages/runner/js/native.mjs": "nativeAdapterBlob",
  "packages/runner/js/native-catalog.mjs": "nativeCatalogBlob",
  "packages/runner/js/tool-manager.mjs": "toolManagerBlob",
  "packages/runner/js/cli.mjs": "cliDriverBlob",
  "packages/runner/js/sdk.mjs": "sdkDriverBlob",
  "packages/runner/js/tool-result.mjs": "toolResultBlob",
  "packages/runner/js/mcp.mjs": "mcpDriverBlob",
  "packages/runner/js/tool-portfolio-t4.mjs": "portfolioGatewayBlob",
  "registry/PROBLEM_CAPABILITIES.json": "registryBlob",
  "docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json": "portfolioDagBlob",
  "docs/tool-portfolio/r77/ALLOY_EXIT_CONTRACT.json": "auditEvidenceBlob"
});

export const GATE_DEPENDENCIES = Object.freeze({
  T0: Object.freeze([
    "version", "upstreamRepository", "upstreamReleaseTag", "upstreamCommit",
    "upstreamAssetSha256", "license", "licenseEvidenceRef",
    "canonicalArchiveDriveId", "canonicalArchiveBytes", "canonicalArchiveSha256",
    "canonicalArchiveBytesVerified", "canonicalArchiveManifestDriveId",
    "canonicalArchiveManifestDeclaredSha256", "canonicalArchiveManifestMatch"
  ]),
  T1: Object.freeze([
    "version", "upstreamCommit", "upstreamAssetSha256", "builderBlob",
    "alloyRunnerSourceBlob", "buildToolBlob", "metaGeneratorBlob", "packagerBlob",
    "manifestGeneratorBlob", "toolchainFingerprint", "rebuiltPackageTreeSha256"
  ]),
  T2: Object.freeze([
    "version", "canonicalArchiveDriveId", "canonicalArchiveBytes",
    "canonicalArchiveSha256", "canonicalArchiveBytesVerified",
    "canonicalArchiveManifestMatch", "unpackerBlob", "observedHostJavaVersion",
    "observedHostJavaSha256", "portableJavaRuntimeSha256", "runtimeImageDigest",
    "installedPackageTreeSha256"
  ]),
  T3: Object.freeze([
    "version", "canonicalArchiveSha256", "bundledJarSha256", "alloyRunnerClassSha256",
    "expectBlob", "positiveFixtureBlob", "negativeFixtureBlob", "errorFixtureBlob",
    "exitContractTestBlob", "observedHostJavaVersion", "observedHostJavaSha256",
    "auditEvidenceBlob", "nativeAcceptanceEvidenceRef"
  ]),
  T4: Object.freeze([
    "version", "canonicalArchiveSha256", "bundledJarSha256", "alloyRunnerClassSha256",
    "expectBlob", "positiveFixtureBlob", "negativeFixtureBlob", "errorFixtureBlob",
    "exitContractTestBlob", "runnerBlob", "nativeAdapterBlob", "nativeCatalogBlob",
    "toolManagerBlob", "cliDriverBlob", "sdkDriverBlob", "toolResultBlob",
    "mcpDriverBlob", "portfolioGatewayBlob", "registryBlob", "portfolioDagBlob",
    "auditEvidenceBlob", "observedHostJavaVersion", "observedHostJavaSha256", "portableJavaRuntimeSha256",
    "runtimeImageDigest"
  ]),
  T5: Object.freeze([
    "version", "canonicalArchiveSha256", "bundledJarSha256", "alloyRunnerClassSha256",
    "installedPackageTreeSha256", "observedHostJavaVersion", "observedHostJavaSha256",
    "portableJavaRuntimeSha256", "runtimeImageDigest", "positiveFixtureBlob",
    "negativeFixtureBlob", "errorFixtureBlob", "auditEvidenceBlob",
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
  T0: "Re-fetch the original Alloy archive and manifest; verify upstream release identity, source commit, publisher digest and license evidence. A producer-manifest match is not a publisher signature.",
  T1: "Rebuild Alloy 6.2.0 from pinned upstream source with a pinned Java/toolchain in two clean environments; compare complete package-tree hashes.",
  T2: "Repeat safe archive preflight and non-root installation with the canonical bundled Java 21 runtime; record runtime and installed-tree identities.",
  T3: "Re-run only changed POS/NEG/ERR cases with exact package/runtime identity and raw argv, inputs, stdout, stderr, exits and hashes. Preserve the R3/R77 execution boundary.",
  T4: "Run the exact-current-main original package through Runner, CLI, SDK and MCP with typed outcomes and fail-closed negative controls.",
  T5: "Run a source-backed Alloy case with an independent semantic Oracle; Alloy's own SAT/UNSAT output is not an independent business Oracle.",
  T6: "Refresh the versioned identity baseline, execute drift regressions, and complete a real release/version-change regression cycle with independent review."
});

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateBaseline(baseline) {
  if (!isObject(baseline) || baseline.schema !== BASELINE_SCHEMA) {
    throw new TypeError("baseline schema must be " + BASELINE_SCHEMA);
  }
  if (baseline.toolId !== "alloy") {
    throw new TypeError("baseline toolId must be alloy");
  }
  if (!isObject(baseline.identity)) {
    throw new TypeError("baseline identity object is required");
  }
  const missing = IDENTITY_FIELDS.filter(field => !hasOwn(baseline.identity, field));
  if (missing.length) {
    throw new TypeError("baseline is missing identity fields: " + missing.join(", "));
  }
  for (const field of IDENTITY_FIELDS) {
    const value = baseline.identity[field];
    if (!(value === null || ["string", "boolean", "number"].includes(typeof value))) {
      throw new TypeError("baseline identity field must be a primitive or null: " + field);
    }
  }
  if (!isObject(baseline.gateStatus)) {
    throw new TypeError("baseline gateStatus object is required");
  }
  if (!isObject(baseline.gateDependencies)) {
    throw new TypeError("baseline gateDependencies object is required");
  }
  // Validate actual semantic field ownership, not just equality of two copies
  // of the same dependency map: a shared typo must never silently mask drift.
  const identityFieldSet = new Set(IDENTITY_FIELDS);
  for (const [gate, dependencies] of Object.entries(GATE_DEPENDENCIES)) {
    if (!Array.isArray(dependencies) || !dependencies.length) {
      throw new TypeError("invalid gate dependency list: " + gate);
    }
    const seen = new Set();
    for (const field of dependencies) {
      if (!identityFieldSet.has(field) || seen.has(field)) {
        throw new TypeError("unknown or duplicate gate dependency field in " + gate + ": " + field);
      }
      seen.add(field);
    }
  }
  for (const gate of Object.keys(GATE_DEPENDENCIES)) {
    const deps = baseline.gateDependencies[gate];
    if (!Array.isArray(deps)) {
      throw new TypeError("baseline gateDependencies missing array for " + gate);
    }
    const seen = new Set();
    for (const field of deps) {
      if (typeof field !== "string" || !identityFieldSet.has(field) || seen.has(field)) {
        throw new TypeError("baseline gateDependencies contains unknown or duplicate identity field in " + gate + ": " + field);
      }
      seen.add(field);
    }
  }
  for (const gate of Object.keys(GATE_DEPENDENCIES)) {
    if (!hasOwn(baseline.gateStatus, gate)) {
      throw new TypeError("baseline gateStatus is missing " + gate);
    }
    if (!sameValue(baseline.gateDependencies[gate], GATE_DEPENDENCIES[gate])) {
      throw new TypeError("baseline gateDependencies mismatch for " + gate);
    }
  }
  if (!Array.isArray(baseline.openBlockers) ||
      !baseline.openBlockers.every(item => typeof item === "string" && item.length > 0)) {
    throw new TypeError("baseline openBlockers must be an array of non-empty strings");
  }
  if (!isObject(baseline.sourcePins)) {
    throw new TypeError("baseline sourcePins object is required");
  }
  const expectedPaths = Object.keys(SOURCE_PIN_FIELDS).sort();
  const actualPaths = Object.keys(baseline.sourcePins).sort();
  if (!sameValue(actualPaths, expectedPaths)) {
    throw new TypeError("baseline sourcePins must contain the exact allowlisted path set");
  }
  for (const [path, field] of Object.entries(SOURCE_PIN_FIELDS)) {
    const sha = baseline.sourcePins[path];
    if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)) {
      throw new TypeError("baseline source pin must be a Git Blob SHA-1: " + path);
    }
    if (baseline.identity[field] !== sha) {
      throw new TypeError("baseline source pin does not match identity field " + field);
    }
  }
  if (!isObject(baseline.currentMainSnapshot) ||
      baseline.currentMainSnapshot.commit !== baseline.snapshotMain ||
      baseline.currentMainSnapshot.mainPushStatus !== "SUCCESS") {
    throw new TypeError("baseline currentMainSnapshot must bind snapshotMain and a successful main push");
  }
}

export function assessAlloyMaintenance(baseline, observed) {
  validateBaseline(baseline);
  if (!isObject(observed) || observed.toolId !== "alloy") {
    throw new TypeError("observed toolId must be alloy");
  }
  if (!isObject(observed.identity)) {
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
      // A null observation on a field the baseline already declares unknown is
      // the inherited baseline state (reported via baselineUnknownFields), not
      // a new incomplete observation. Nulling a known field is a regression.
      if (baselineValue !== null) {
        unknownFields.push(field);
      }
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
    previousStatus: baseline.gateStatus[gate],
    action: GATE_ACTIONS[gate]
  }));

  const baselineUnknownFields = IDENTITY_FIELDS.filter(field =>
    baseline.identity[field] === null
  );
  let status = "FRESH";
  if (missingFields.length || unknownFields.length) {
    status = "INCOMPLETE_OBSERVATION";
  } else if (changedFields.length) {
    status = "STALE_REVERIFY_REQUIRED";
  } else if (baselineUnknownFields.length || baseline.openBlockers.length) {
    status = "FRESH_UNQUALIFIED";
  }

  return {
    schema: ASSESSMENT_SCHEMA,
    toolId: "alloy",
    baselineVersion: baseline.identity.version,
    observedVersion: hasOwn(observed.identity, "version") ? observed.identity.version : null,
    baselineMain: baseline.snapshotMain,
    status,
    changedFields,
    missingFields,
    unknownFields,
    baselineUnknownFields,
    baselineOpenBlockers: baseline.openBlockers,
    staleGates,
    revalidationGates: affectedGates,
    requiredActions,
    qualificationGranted: false,
    note: "A matching identity snapshot is only a freshness observation. It cannot repair unknown source/license provenance, prove a reproducible build, establish current-main Runner integration, create a business Oracle, or grant any lifecycle/Product/Release qualification."
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline" || arg === "--observed") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(arg + " requires a file path");
      }
      result[arg.slice(2)] = value;
      index += 1;
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

export async function runAlloyMaintenanceCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write("Usage: node scripts/tool-portfolio/alloy-maintenance.mjs --baseline <baseline.json> --observed <observation.json>\n");
    return 0;
  }
  if (!args.baseline || !args.observed) {
    throw new Error("both --baseline and --observed are required");
  }
  const [baseline, observed] = await Promise.all([
    readJson(args.baseline),
    readJson(args.observed)
  ]);
  const assessment = assessAlloyMaintenance(baseline, observed);
  process.stdout.write(JSON.stringify(assessment, null, 2) + "\n");
  return ["FRESH", "FRESH_UNQUALIFIED"].includes(assessment.status) ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runAlloyMaintenanceCli().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write("alloy-maintenance: " + error.message + "\n");
    process.exitCode = 1;
  });
}
