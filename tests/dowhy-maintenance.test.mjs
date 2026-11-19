import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessDoWhyMaintenance,
  GATE_DEPENDENCIES,
  IDENTITY_FIELDS
} from "../scripts/tool-portfolio/dowhy-maintenance.mjs";

const baseline = JSON.parse(readFileSync(
  new URL("../docs/tool-portfolio/r74/DOWHY_T6_MAINTENANCE.json", import.meta.url),
  "utf8"
));
const CLI_PATH = fileURLToPath(new URL("../scripts/tool-portfolio/dowhy-maintenance.mjs", import.meta.url));

function invokeCli(baselineValue, observedValue, extraArgs = []) {
  const directory = mkdtempSync(join(tmpdir(), "dowhy-maintenance-cli-"));
  const baselinePath = join(directory, "baseline.json");
  const observedPath = join(directory, "observed.json");
  const toText = value => typeof value === "string" ? value : JSON.stringify(value);
  writeFileSync(baselinePath, toText(baselineValue));
  writeFileSync(observedPath, toText(observedValue));
  let result;
  try {
    result = spawnSync(process.execPath, [
      CLI_PATH,
      "--baseline", baselinePath,
      "--observed", observedPath,
      ...extraArgs
    ], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return result;
}

function observedSnapshot(source = baseline) {
  return {
    toolId: "dowhy",
    identity: structuredClone(source.identity)
  };
}

function completeSyntheticBaseline() {
  const result = structuredClone(baseline);
  for (const field of IDENTITY_FIELDS) {
    if (result.identity[field] === null) {
      result.identity[field] = "synthetic-known:" + field;
    }
  }
  result.openBlockers = [];
  result.gateStatus = {
    T0: "PASS_SCOPED",
    T1: "PASS_SCOPED",
    T2: "PASS_SCOPED",
    T3: "PASS_SCOPED",
    T4: "PASS_SCOPED",
    T5: "PASS_SCOPED",
    T6: "PASS_SCOPED"
  };
  return result;
}

test("the real DoWhy baseline is incomplete, never silently FRESH or qualified", () => {
  const result = assessDoWhyMaintenance(baseline, observedSnapshot());
  assert.equal(result.status, "INCOMPLETE_OBSERVATION");
  assert.ok(result.baselineUnknownFields.length > 0);
  assert.ok(result.unknownFields.length > 0);
  assert.equal(result.qualificationGranted, false);
  assert.deepEqual(result.changedFields, []);
  assert.equal(baseline.identity.canonicalArchiveManifestMatch, false);
  assert.ok(result.baselineOpenBlockers.some(x =>
    x.includes("9c3b0b164e5f9ad5edd3928614feb61f67ce9409acbdbf9fade558b626b20d61") &&
    x.includes("2058d3df35f69b51e235eba0108087646d60c09400391f93849dadcfbcd51cb2")
  ));
});

test("documentation-only observations do not create identity drift", () => {
  const observed = observedSnapshot();
  observed.documentationNote = "updated prose only";
  const result = assessDoWhyMaintenance(baseline, observed);
  assert.deepEqual(result.changedFields, []);
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.qualificationGranted, false);
});

test("the canonical archive mismatch remains an explicit blocker and does not stale the alternate wheelhouse route", () => {
  const result = assessDoWhyMaintenance(baseline, observedSnapshot());
  assert.ok(result.baselineOpenBlockers.some(x => x.includes("9c3b0b164e5f9ad5")));
  assert.ok(result.baselineOpenBlockers.some(x => x.includes("2058d3df35f69b51")));
  assert.ok(result.baselineUnknownFields.includes("sourceSdistSha256"));
  assert.equal(baseline.identity.canonicalArchiveManifestMatch, false);
  assert.equal(baseline.gateRoutes.T2, "ALTERNATE_WHEELHOUSE_R4_WRITER_REPORTED_ONLY");
  assert.equal(baseline.gateRoutes.T3, "ALTERNATE_WHEELHOUSE_R4_WRITER_REPORTED_ONLY");
});

test("canonical archive byte drift invalidates T0 only, not alternate-wheelhouse T2/T3", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.canonicalArchiveObservedSha256 = "f".repeat(64);
  const result = assessDoWhyMaintenance(complete, observed);
  assert.equal(result.status, "STALE_REVERIFY_REQUIRED");
  assert.deepEqual(result.staleGates, ["T0", "T6"]);
  assert.deepEqual(result.revalidationGates, ["T0", "T6"]);
});

test("alternate wheelhouse drift invalidates its scoped install, fixture and integration evidence", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.alternateWheelhouseSha256 = "0".repeat(64);
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T2", "T3", "T4", "T6"]);
  assert.deepEqual(result.revalidationGates, ["T2", "T3", "T4", "T6"]);
});

test("wheelhouse byte-verification state change invalidates only dependent gates", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.alternateWheelhouseBytesVerified = true;
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T2", "T3", "T4", "T6"]);
});

test("builder, build-tool, meta generator and packager drift invalidate T1", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.builderBlob = "changed-builder";
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T1", "T6"]);
  assert.deepEqual(result.revalidationGates, ["T1", "T6"]);
});

test("fixture drift invalidates native verification, integration and semantic-use evidence", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.positiveFixtureBlob = "changed-positive-fixture";
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T3", "T4", "T5", "T6"]);
});

test("Runner and gateway source drift invalidates T4 without changing T0-T3", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.portfolioGatewayBlob = "changed-gateway";
  observed.identity.runnerBlob = "changed-runner";
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T4", "T6"]);
});

test("Oracle drift invalidates T5 only and never grants a new semantic qualification", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.oracleId = "independent-oracle-v1";
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T5", "T6"]);
  assert.equal(result.qualificationGranted, false);
});

test("version drift requests revalidation across every lifecycle gate", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.version = "0.15";
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);
});

test("newly supplied source-sdist bytes resolve UNKNOWN but require T0/T1 revalidation", () => {
  const observed = observedSnapshot();
  observed.identity.sourceSdistSha256 = "a".repeat(64);
  observed.identity.sourceSdistBytesVerified = true;
  const result = assessDoWhyMaintenance(baseline, observed);
  assert.ok(result.changedFields.some(x => x.field === "sourceSdistSha256" && x.resolvedPreviouslyUnknown));
  assert.ok(result.revalidationGates.includes("T0"));
  assert.ok(result.revalidationGates.includes("T1"));
  assert.equal(result.qualificationGranted, false);
});

test("missing identity fields are incomplete and revalidate only dependent gates", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  delete observed.identity.alternateWheelhouseSha256;
  const result = assessDoWhyMaintenance(complete, observed);
  assert.equal(result.status, "INCOMPLETE_OBSERVATION");
  assert.deepEqual(result.missingFields, ["alternateWheelhouseSha256"]);
  assert.deepEqual(result.revalidationGates, ["T2", "T3", "T4", "T6"]);
});

test("host Python runtime drift invalidates semantic-use T5 evidence", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.hostPythonVersion = "3.14.0";
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T2", "T3", "T4", "T5", "T6"]);
  assert.deepEqual(result.revalidationGates, ["T2", "T3", "T4", "T5", "T6"]);
});

test("runtime image drift invalidates semantic-use T5 evidence", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.runtimeImageDigest = "sha256:" + "a".repeat(64);
  const result = assessDoWhyMaintenance(complete, observed);
  assert.deepEqual(result.staleGates, ["T2", "T4", "T5", "T6"]);
  assert.deepEqual(result.revalidationGates, ["T2", "T4", "T5", "T6"]);
});

test("explicit null observations remain UNKNOWN rather than FRESH", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  observed.identity.runtimeImageDigest = null;
  const result = assessDoWhyMaintenance(complete, observed);
  assert.equal(result.status, "INCOMPLETE_OBSERVATION");
  assert.deepEqual(result.unknownFields, ["runtimeImageDigest"]);
  assert.deepEqual(result.revalidationGates, ["T2", "T4", "T5", "T6"]);
});

test("wrong tool identity is rejected", () => {
  const observed = observedSnapshot();
  observed.toolId = "sympy";
  assert.throws(() => assessDoWhyMaintenance(baseline, observed), /toolId/);
});

test("baseline must explicitly carry every identity field", () => {
  const incomplete = structuredClone(baseline);
  delete incomplete.identity.nativeAdapterBlob;
  assert.throws(() => assessDoWhyMaintenance(incomplete, observedSnapshot()), /nativeAdapterBlob/);
});

test("baseline must explicitly contain a valid openBlockers array", () => {
  const missing = structuredClone(baseline);
  delete missing.openBlockers;
  assert.throws(() => assessDoWhyMaintenance(missing, observedSnapshot()), /openBlockers/);

  const malformed = structuredClone(baseline);
  malformed.openBlockers = {};
  assert.throws(() => assessDoWhyMaintenance(malformed, observedSnapshot()), /openBlockers/);

  const invalidEntry = structuredClone(baseline);
  invalidEntry.openBlockers = [null];
  assert.throws(() => assessDoWhyMaintenance(invalidEntry, observedSnapshot()), /openBlockers/);
});

test("baseline gate dependency declarations match the executable dependency map", () => {
  for (const gate of ["T0", "T1", "T2", "T3", "T4", "T5", "T6"]) {
    assert.deepEqual(baseline.gateDependencies[gate], GATE_DEPENDENCIES[gate]);
  }
  assert.deepEqual(GATE_DEPENDENCIES.T6, IDENTITY_FIELDS);
});

test("an observation with no baseline blockers can be FRESH but still never grants qualification", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  const result = assessDoWhyMaintenance(complete, observed);
  assert.equal(result.status, "FRESH");
  assert.equal(result.qualificationGranted, false);
  assert.deepEqual(result.changedFields, []);
  assert.deepEqual(result.revalidationGates, []);
});


test("CLI emits FRESH JSON and exits zero without granting qualification", () => {
  const complete = completeSyntheticBaseline();
  const result = invokeCli(complete, observedSnapshot(complete));
  assert.equal(result.status, 0, result.stderr);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.status, "FRESH");
  assert.equal(assessment.qualificationGranted, false);
});

test("CLI emits FRESH_UNQUALIFIED JSON and exits zero while retaining blockers", () => {
  const complete = completeSyntheticBaseline();
  complete.openBlockers = ["synthetic known blocker"];
  const result = invokeCli(complete, observedSnapshot(complete));
  assert.equal(result.status, 0, result.stderr);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.status, "FRESH_UNQUALIFIED");
  assert.deepEqual(assessment.baselineOpenBlockers, ["synthetic known blocker"]);
  assert.equal(assessment.qualificationGranted, false);
});

test("CLI exits two for STALE and INCOMPLETE observations and emits fail-closed JSON", () => {
  const complete = completeSyntheticBaseline();
  const stale = observedSnapshot(complete);
  stale.identity.version = "0.15";
  const staleResult = invokeCli(complete, stale);
  assert.equal(staleResult.status, 2, staleResult.stderr);
  const staleAssessment = JSON.parse(staleResult.stdout);
  assert.equal(staleAssessment.status, "STALE_REVERIFY_REQUIRED");
  assert.equal(staleAssessment.qualificationGranted, false);

  const incomplete = observedSnapshot(complete);
  delete incomplete.identity.runtimeImageDigest;
  const incompleteResult = invokeCli(complete, incomplete);
  assert.equal(incompleteResult.status, 2, incompleteResult.stderr);
  const incompleteAssessment = JSON.parse(incompleteResult.stdout);
  assert.equal(incompleteAssessment.status, "INCOMPLETE_OBSERVATION");
  assert.equal(incompleteAssessment.qualificationGranted, false);
});

test("CLI exits one for missing or unknown arguments, invalid JSON, and invalid schema", () => {
  const complete = completeSyntheticBaseline();
  const observed = observedSnapshot(complete);
  const missingArgs = spawnSync(process.execPath, [CLI_PATH], { encoding: "utf8" });
  assert.equal(missingArgs.status, 1);
  assert.match(missingArgs.stderr, /both --baseline and --observed are required/);

  const unknownArgs = invokeCli(complete, observed, ["--unknown"]);
  assert.equal(unknownArgs.status, 1);
  assert.match(unknownArgs.stderr, /unknown argument/);

  const invalidJson = invokeCli("{", observed);
  assert.equal(invalidJson.status, 1);
  assert.ok(invalidJson.stderr.length > 0);

  const invalidSchema = structuredClone(complete);
  invalidSchema.schema = "wrong/schema";
  const invalidSchemaResult = invokeCli(invalidSchema, observed);
  assert.equal(invalidSchemaResult.status, 1);
  assert.match(invalidSchemaResult.stderr, /baseline schema/);
});
