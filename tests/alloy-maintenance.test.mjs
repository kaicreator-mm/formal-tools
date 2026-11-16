import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessAlloyMaintenance,
  GATE_DEPENDENCIES,
  IDENTITY_FIELDS,
  SOURCE_PIN_FIELDS
} from "../scripts/tool-portfolio/alloy-maintenance.mjs";

const baseline = JSON.parse(readFileSync(
  new URL("../docs/tool-portfolio/r105/ALLOY_T6_MAINTENANCE.json", import.meta.url),
  "utf8"
));
const CLI_PATH = fileURLToPath(new URL(
  "../scripts/tool-portfolio/alloy-maintenance.mjs",
  import.meta.url
));

function observedSnapshot(source = baseline) {
  return {
    toolId: "alloy",
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

function invokeCli(baselineValue, observedValue, extraArgs = []) {
  const directory = mkdtempSync(join(tmpdir(), "alloy-maintenance-cli-"));
  const baselinePath = join(directory, "baseline.json");
  const observedPath = join(directory, "observed.json");
  const toText = value => typeof value === "string" ? value : JSON.stringify(value);
  writeFileSync(baselinePath, toText(baselineValue));
  writeFileSync(observedPath, toText(observedValue));
  try {
    return spawnSync(process.execPath, [
      CLI_PATH,
      "--baseline", baselinePath,
      "--observed", observedPath,
      ...extraArgs
    ], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the real Alloy baseline binds current main and every source pin but remains unqualified", () => {
  assert.equal(baseline.toolId, "alloy");
  assert.equal(baseline.identity.version, "6.2.0");
  assert.equal(baseline.snapshotMain, "6991c7aae1026ea9bda9d49f43139e92437f0493");
  assert.equal(baseline.currentMainSnapshot.mainPushStatus, "SUCCESS");
  assert.equal(baseline.currentMainSnapshot.sourcePinVerification, "24_OF_24_MATCH_AT_6991");
  assert.equal(Object.keys(baseline.sourcePins).length, Object.keys(SOURCE_PIN_FIELDS).length);
  for (const [path, field] of Object.entries(SOURCE_PIN_FIELDS)) {
    assert.match(baseline.sourcePins[path], /^[a-f0-9]{40}$/);
    assert.equal(baseline.identity[field], baseline.sourcePins[path], path);
  }

  const result = assessAlloyMaintenance(baseline, observedSnapshot());
  assert.equal(result.status, "FRESH_UNQUALIFIED");
  assert.deepEqual(result.changedFields, []);
  assert.deepEqual(result.staleGates, []);
  assert.equal(result.qualificationGranted, false);
  assert.ok(result.baselineUnknownFields.includes("upstreamCommit"));
  assert.ok(result.baselineOpenBlockers.length > 0);
});

test("documentation-only observations do not create identity drift", () => {
  const observed = observedSnapshot();
  observed.documentationNote = "updated prose only";
  const result = assessAlloyMaintenance(baseline, observed);
  assert.deepEqual(result.changedFields, []);
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(result.unknownFields, []);
  assert.deepEqual(result.revalidationGates, []);
  assert.equal(result.qualificationGranted, false);
});

test("original archive byte drift invalidates only dependent lifecycle evidence", () => {
  const observed = observedSnapshot();
  observed.identity.canonicalArchiveSha256 = "f".repeat(64);
  const result = assessAlloyMaintenance(baseline, observed);
  assert.equal(result.status, "STALE_REVERIFY_REQUIRED");
  assert.deepEqual(result.revalidationGates, ["T0", "T2", "T3", "T4", "T5", "T6"]);
  assert.deepEqual(result.staleGates, ["T0", "T2", "T3"]);
  assert.equal(result.qualificationGranted, false);
});

test("builder and source-toolchain drift requests T1 without claiming it was previously qualified", () => {
  const observed = observedSnapshot();
  observed.identity.builderBlob = "a".repeat(40);
  const result = assessAlloyMaintenance(baseline, observed);
  assert.deepEqual(result.revalidationGates, ["T1", "T6"]);
  assert.deepEqual(result.staleGates, []);
  assert.equal(result.qualificationGranted, false);
});

test("fixture and exit-contract drift invalidates scoped T3 and dependent T4/T5 evidence", () => {
  const observed = observedSnapshot();
  observed.identity.errorFixtureBlob = "b".repeat(40);
  const result = assessAlloyMaintenance(baseline, observed);
  assert.deepEqual(result.revalidationGates, ["T3", "T4", "T5", "T6"]);
  assert.deepEqual(result.staleGates, ["T3"]);
  assert.equal(result.qualificationGranted, false);
});

test("R77 audit evidence mutation invalidates the scoped T3 native verification provenance", () => {
  const changed = observedSnapshot();
  changed.identity.auditEvidenceBlob = "f".repeat(40);
  const changedResult = assessAlloyMaintenance(baseline, changed);
  assert.equal(changedResult.status, "STALE_REVERIFY_REQUIRED");
  assert.deepEqual(changedResult.revalidationGates, ["T3", "T4", "T5", "T6"]);
  assert.deepEqual(changedResult.staleGates, ["T3"]);
  assert.equal(changedResult.qualificationGranted, false);

  const missing = observedSnapshot();
  delete missing.identity.auditEvidenceBlob;
  const missingResult = assessAlloyMaintenance(baseline, missing);
  assert.equal(missingResult.status, "INCOMPLETE_OBSERVATION");
  assert.deepEqual(missingResult.missingFields, ["auditEvidenceBlob"]);
  assert.deepEqual(missingResult.revalidationGates, ["T3", "T4", "T5", "T6"]);
  assert.deepEqual(missingResult.staleGates, ["T3"]);

  const nullObservation = observedSnapshot();
  nullObservation.identity.auditEvidenceBlob = null;
  const nullResult = assessAlloyMaintenance(baseline, nullObservation);
  assert.equal(nullResult.status, "INCOMPLETE_OBSERVATION");
  assert.deepEqual(nullResult.unknownFields, ["auditEvidenceBlob"]);
  assert.deepEqual(nullResult.revalidationGates, ["T3", "T4", "T5", "T6"]);
  assert.deepEqual(nullResult.staleGates, ["T3"]);
});

test("manifest generator drift revalidates T1 packaging without pretending build qualification", () => {
  const observed = observedSnapshot();
  observed.identity.manifestGeneratorBlob = "e".repeat(40);
  const result = assessAlloyMaintenance(baseline, observed);
  assert.equal(result.status, "STALE_REVERIFY_REQUIRED");
  assert.deepEqual(result.revalidationGates, ["T1", "T6"]);
  assert.deepEqual(result.staleGates, []);
  assert.equal(result.qualificationGranted, false);
});

test("every gate dependency is a unique tracked identity field and T3 binds the real R77 Git Blob", () => {
  const allowed = new Set(IDENTITY_FIELDS);
  for (const [gate, dependencies] of Object.entries(GATE_DEPENDENCIES)) {
    assert.ok(dependencies.length > 0, gate);
    assert.equal(new Set(dependencies).size, dependencies.length, gate);
    for (const field of dependencies) {
      assert.ok(allowed.has(field), gate + " has an untracked dependency " + field);
    }
    assert.deepEqual(baseline.gateDependencies[gate], dependencies, gate);
  }
  assert.ok(GATE_DEPENDENCIES.T3.includes("auditEvidenceBlob"));
  assert.ok(GATE_DEPENDENCIES.T4.includes("auditEvidenceBlob"));
  assert.ok(GATE_DEPENDENCIES.T5.includes("auditEvidenceBlob"));
  assert.ok(!GATE_DEPENDENCIES.T3.includes("nativeAcceptanceEvidenceBlob"));
  assert.equal(baseline.identity.auditEvidenceBlob, baseline.sourcePins[
    "docs/tool-portfolio/r77/ALLOY_EXIT_CONTRACT.json"
  ]);
  assert.equal(baseline.currentMainSnapshot.changedPaths, 44);
  assert.equal(baseline.currentMainSnapshot.otherToolAndG4Paths, 41);
});

test("Runner, gateway and registry drift requests T4 revalidation without promoting T4", () => {
  const observed = observedSnapshot();
  observed.identity.runnerBlob = "c".repeat(40);
  observed.identity.portfolioGatewayBlob = "d".repeat(40);
  observed.identity.registryBlob = "e".repeat(40);
  const result = assessAlloyMaintenance(baseline, observed);
  assert.deepEqual(result.revalidationGates, ["T4", "T6"]);
  assert.deepEqual(result.staleGates, []);
  assert.equal(result.qualificationGranted, false);
});

test("Oracle identity drift affects T5 only and never grants semantic qualification", () => {
  const observed = observedSnapshot();
  observed.identity.oracleId = "independent-alloy-oracle-v1";
  const result = assessAlloyMaintenance(baseline, observed);
  assert.deepEqual(result.revalidationGates, ["T5", "T6"]);
  assert.deepEqual(result.staleGates, []);
  assert.equal(result.qualificationGranted, false);
});

test("version drift requests every applicable gate and stales only scoped qualified gates", () => {
  const observed = observedSnapshot();
  observed.identity.version = "6.3.0";
  const result = assessAlloyMaintenance(baseline, observed);
  assert.deepEqual(result.revalidationGates, ["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);
  assert.deepEqual(result.staleGates, ["T0", "T2", "T3"]);
  assert.equal(result.qualificationGranted, false);
});

test("missing and null observations are incomplete, not FRESH", () => {
  const missing = observedSnapshot();
  delete missing.identity.errorFixtureBlob;
  const missingResult = assessAlloyMaintenance(baseline, missing);
  assert.equal(missingResult.status, "INCOMPLETE_OBSERVATION");
  assert.deepEqual(missingResult.missingFields, ["errorFixtureBlob"]);
  assert.deepEqual(missingResult.revalidationGates, ["T3", "T4", "T5", "T6"]);
  assert.deepEqual(missingResult.staleGates, ["T3"]);

  const unknown = observedSnapshot();
  unknown.identity.observedHostJavaVersion = null;
  const unknownResult = assessAlloyMaintenance(baseline, unknown);
  assert.equal(unknownResult.status, "INCOMPLETE_OBSERVATION");
  assert.deepEqual(unknownResult.unknownFields, ["observedHostJavaVersion"]);
  assert.deepEqual(unknownResult.revalidationGates, ["T2", "T3", "T4", "T5", "T6"]);
  assert.deepEqual(unknownResult.staleGates, ["T2", "T3"]);
});

test("a newly supplied value resolves baseline UNKNOWN but requires dependent revalidation", () => {
  const observed = observedSnapshot();
  observed.identity.upstreamCommit = "0123456789abcdef0123456789abcdef01234567";
  const result = assessAlloyMaintenance(baseline, observed);
  assert.ok(result.changedFields.some(item =>
    item.field === "upstreamCommit" && item.resolvedPreviouslyUnknown
  ));
  assert.deepEqual(result.revalidationGates, ["T0", "T1", "T6"]);
  assert.deepEqual(result.staleGates, ["T0"]);
  assert.equal(result.qualificationGranted, false);
});

test("wrong tool identity is rejected", () => {
  const observed = observedSnapshot();
  observed.toolId = "sympy";
  assert.throws(() => assessAlloyMaintenance(baseline, observed), /toolId/);
});

test("baseline must explicitly carry every identity field and a valid source-pin map", () => {
  const missing = structuredClone(baseline);
  delete missing.identity.nativeAdapterBlob;
  assert.throws(() => assessAlloyMaintenance(missing, observedSnapshot()), /nativeAdapterBlob/);

  const badPin = structuredClone(baseline);
  badPin.sourcePins["portable/builders/tools/alloy.sh"] = "not-a-git-blob";
  assert.throws(() => assessAlloyMaintenance(badPin, observedSnapshot()), /Git Blob SHA-1/);

  const mismatchedPin = structuredClone(baseline);
  mismatchedPin.sourcePins["portable/builders/tools/alloy.sh"] = "f".repeat(40);
  assert.throws(() => assessAlloyMaintenance(mismatchedPin, observedSnapshot()), /does not match identity field/);
});

test("baseline gate dependencies and blocker records are strict", () => {
  const badDependencies = structuredClone(baseline);
  badDependencies.gateDependencies.T3.push("untrackedField");
  assert.throws(() => assessAlloyMaintenance(badDependencies, observedSnapshot()), /unknown or duplicate identity field/);

  const duplicateDependencies = structuredClone(baseline);
  duplicateDependencies.gateDependencies.T3.push("auditEvidenceBlob");
  assert.throws(() => assessAlloyMaintenance(duplicateDependencies, observedSnapshot()), /unknown or duplicate identity field/);

  const missingDependencies = structuredClone(baseline);
  delete missingDependencies.gateDependencies.T3;
  assert.throws(() => assessAlloyMaintenance(missingDependencies, observedSnapshot()), /missing array for T3/);

  const missingBlockers = structuredClone(baseline);
  delete missingBlockers.openBlockers;
  assert.throws(() => assessAlloyMaintenance(missingBlockers, observedSnapshot()), /openBlockers/);

  const malformedBlockers = structuredClone(baseline);
  malformedBlockers.openBlockers = [null];
  assert.throws(() => assessAlloyMaintenance(malformedBlockers, observedSnapshot()), /openBlockers/);
});

test("a complete synthetic identity can be FRESH but still never grants qualification", () => {
  const complete = completeSyntheticBaseline();
  const result = assessAlloyMaintenance(complete, observedSnapshot(complete));
  assert.equal(result.status, "FRESH");
  assert.deepEqual(result.changedFields, []);
  assert.deepEqual(result.revalidationGates, []);
  assert.equal(result.qualificationGranted, false);
});

test("CLI emits FRESH_UNQUALIFIED JSON and exits zero while retaining blockers", () => {
  const result = invokeCli(baseline, observedSnapshot());
  assert.equal(result.status, 0, result.stderr);
  const assessment = JSON.parse(result.stdout);
  assert.equal(assessment.status, "FRESH_UNQUALIFIED");
  assert.ok(assessment.baselineOpenBlockers.length > 0);
  assert.equal(assessment.qualificationGranted, false);
});

test("CLI exits two for STALE and INCOMPLETE observations", () => {
  const stale = observedSnapshot();
  stale.identity.version = "6.3.0";
  const staleResult = invokeCli(baseline, stale);
  assert.equal(staleResult.status, 2, staleResult.stderr);
  assert.equal(JSON.parse(staleResult.stdout).status, "STALE_REVERIFY_REQUIRED");

  const incomplete = observedSnapshot();
  incomplete.identity.observedHostJavaVersion = null;
  const incompleteResult = invokeCli(baseline, incomplete);
  assert.equal(incompleteResult.status, 2, incompleteResult.stderr);
  assert.equal(JSON.parse(incompleteResult.stdout).status, "INCOMPLETE_OBSERVATION");
});

test("CLI exits one for missing arguments, unknown arguments, invalid JSON and invalid baseline", () => {
  const missingArgs = spawnSync(process.execPath, [CLI_PATH], { encoding: "utf8" });
  assert.equal(missingArgs.status, 1);
  assert.match(missingArgs.stderr, /both --baseline and --observed are required/);

  const unknownArgs = invokeCli(baseline, observedSnapshot(), ["--unknown"]);
  assert.equal(unknownArgs.status, 1);
  assert.match(unknownArgs.stderr, /unknown argument/);

  const invalidJson = invokeCli("{", observedSnapshot());
  assert.equal(invalidJson.status, 1);
  assert.ok(invalidJson.stderr.length > 0);

  const invalidSchema = structuredClone(baseline);
  invalidSchema.schema = "wrong/schema";
  const invalidSchemaResult = invokeCli(invalidSchema, observedSnapshot());
  assert.equal(invalidSchemaResult.status, 1);
  assert.match(invalidSchemaResult.stderr, /baseline schema/);
});

test("CLI help is available without loading a baseline", () => {
  const result = spawnSync(process.execPath, [CLI_PATH, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: node scripts\/tool-portfolio\/alloy-maintenance[.]mjs/);
});
