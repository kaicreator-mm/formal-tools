import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessClingoMaintenance } from "../scripts/tool-portfolio/clingo-maintenance.mjs";

const baseline = JSON.parse(readFileSync(
  new URL("../docs/tool-portfolio/r60/CLINGO_T6_MAINTENANCE.json", import.meta.url),
  "utf8"
));

function observedSnapshot() {
  return {
    toolId: baseline.toolId,
    identity: structuredClone(baseline.identity)
  };
}

test("unchanged Clingo identity is fresh but grants no qualification", () => {
  const result = assessClingoMaintenance(baseline, observedSnapshot());
  assert.equal(result.status, "FRESH");
  assert.deepEqual(result.changedFields, []);
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(result.staleGates, []);
  assert.deepEqual(result.revalidationGates, []);
  assert.equal(result.qualificationGranted, false);
});

test("documentation-only observation changes do not stale execution evidence", () => {
  const observed = observedSnapshot();
  observed.documentationNote = "updated prose; no source or runtime identity changed";
  const result = assessClingoMaintenance(baseline, observed);
  assert.equal(result.status, "FRESH");
  assert.deepEqual(result.revalidationGates, []);
});

test("version drift invalidates all dependent gates and marks only previously scoped passes stale", () => {
  const observed = observedSnapshot();
  observed.identity.version = "5.8.4";
  const result = assessClingoMaintenance(baseline, observed);
  assert.equal(result.status, "STALE_REVERIFY_REQUIRED");
  assert.deepEqual(result.staleGates, ["T0", "T2", "T3", "T4"]);
  assert.deepEqual(result.revalidationGates, ["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);
});

test("binary drift invalidates install, native verify, integration, use and maintenance", () => {
  const observed = observedSnapshot();
  observed.identity.binarySha256 = "0".repeat(64);
  const result = assessClingoMaintenance(baseline, observed);
  assert.deepEqual(result.staleGates, ["T2", "T3", "T4"]);
  assert.deepEqual(result.revalidationGates, ["T2", "T3", "T4", "T5", "T6"]);
});

test("fixture drift invalidates native verify and downstream case evidence", () => {
  const observed = observedSnapshot();
  observed.identity.positiveFixtureBlob = "changed-fixture-blob";
  const result = assessClingoMaintenance(baseline, observed);
  assert.deepEqual(result.staleGates, ["T3", "T4"]);
  assert.deepEqual(result.revalidationGates, ["T3", "T4", "T5", "T6"]);
});

test("Runner and gateway source drift invalidates bounded T4 and downstream use", () => {
  const observed = observedSnapshot();
  observed.identity.nativeAdapterBlob = "changed-native-adapter";
  observed.identity.mcpDriverBlob = "changed-mcp-driver";
  const result = assessClingoMaintenance(baseline, observed);
  assert.deepEqual(result.staleGates, ["T4"]);
  assert.deepEqual(result.revalidationGates, ["T4", "T6"]);
});

test("Oracle drift requests T5 revalidation without pretending the open T5 gate was previously qualified", () => {
  const observed = observedSnapshot();
  observed.identity.oracleId = "independent-oracle-v1";
  const result = assessClingoMaintenance(baseline, observed);
  assert.deepEqual(result.staleGates, []);
  assert.deepEqual(result.revalidationGates, ["T5", "T6"]);
  assert.equal(result.requiredActions[0].previousStatus, "OPEN");
});

test("new source-byte verification invalidates scoped source and build evidence", () => {
  const observed = observedSnapshot();
  observed.identity.sourceSdistBytesVerified = true;
  const result = assessClingoMaintenance(baseline, observed);
  assert.deepEqual(result.staleGates, ["T0"]);
  assert.deepEqual(result.revalidationGates, ["T0", "T1", "T6"]);
});

test("missing identity is incomplete, never fresh", () => {
  const observed = observedSnapshot();
  delete observed.identity.binarySha256;
  const result = assessClingoMaintenance(baseline, observed);
  assert.equal(result.status, "INCOMPLETE_OBSERVATION");
  assert.deepEqual(result.missingFields, ["binarySha256"]);
  assert.ok(result.revalidationGates.includes("T4"));
});

test("wrong tool identity is rejected", () => {
  const observed = observedSnapshot();
  observed.toolId = "z3";
  assert.throws(() => assessClingoMaintenance(baseline, observed), /toolId/);
});

test("baseline must explicitly carry every tracked identity field", () => {
  const incomplete = structuredClone(baseline);
  delete incomplete.identity.nativeAdapterBlob;
  assert.throws(() => assessClingoMaintenance(incomplete, observedSnapshot()), /nativeAdapterBlob/);
});
