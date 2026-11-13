import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = new URL("../docs/tool-portfolio/", import.meta.url);
const old = JSON.parse(readFileSync(new URL("r1/TOOL_PORTFOLIO_DAG.json", base), "utf8"));
const current = JSON.parse(readFileSync(new URL("r2/ASSET_LANES.json", base), "utf8"));
const expected = {
  ORIGINAL_TAR_RUNNER_PASS_R3: 16,
  ORIGINAL_TAR_RUNNER_PASS_R4: 3,
  HOST_PYTHON313_RUNNER_PASS_R4: 1,
  LOCAL_PATCHED_FIXTURE_RUNNER_PASS_R4: 2,
  ALTERNATE_CLI_SMOKE_PASS_R4: 1,
  ALTERNATE_WHEELHOUSE_SCOPED_PASS_R4: 11,
  BLOCKED_R4: 2,
};

test("tool R2: preserve R1 issue/version authority and all 36 tool identities", () => {
  assert.equal(current.schema, "formal-tools/tool-asset-lanes/2.0");
  assert.equal(current.authorizations.tool_portfolio_issue, 24);
  assert.equal(current.authorizations.product_issue, 11);
  assert.equal(current.authorizations.excluded_issue, 7);
  assert.equal(current.tools.length, 36);
  assert.deepEqual(current.tools.map((t) => t.id), old.tools.map((t) => t.id));
  assert.deepEqual(current.tools.map((t) => t.slug), old.tools.map((t) => t.slug));
  assert.deepEqual(current.tools.map((t) => t.issue), old.tools.map((t) => t.issue));
  assert.deepEqual(current.tools.map((t) => t.catalog_version), old.tools.map((t) => t.version));
  assert.equal(new Set(current.tools.map((t) => t.slug)).size, 36);
  for (const tool of current.tools) {
    assert.equal(tool.product_gates, "NOT_QUALIFIED");
    assert.ok(!/G[3456]_PASS|T5_PASS|REUSABLE/.test(tool.route));
  }
  assert.equal(current.counts.fully_qualified_semantic_consumers, 0);
});

test("tool R2: route counts must remain disjoint, scoped and exhaust 36", () => {
  const found = {};
  for (const tool of current.tools) found[tool.route] = (found[tool.route] ?? 0) + 1;
  assert.deepEqual(found, Object.fromEntries(Object.entries(expected).filter(([k]) => k in found)));
  for (const [key, n] of Object.entries(expected)) {
    assert.equal(found[key], n, key);
    assert.equal(current.counts[key], n, key);
  }
  assert.equal(current.counts.total, 36);
  assert.equal(Object.values(expected).reduce((a, b) => a + b, 0), 36);
  assert.equal(current.counts.original_tar_runner_scoped_total, 19);
  assert.equal(current.counts.scoped_invokable_with_alternates_including_patched, 34);
  assert.equal(current.tools.filter((t) => t.route === "BLOCKED_R4").length, 2);
});

test("tool R2: normalized wheelhouses retain unchanged raw SHA and actual versions", () => {
  const w = current.tools.filter((t) => t.route === "ALTERNATE_WHEELHOUSE_SCOPED_PASS_R4");
  assert.equal(w.length, 11);
  const seen = new Set();
  for (const tool of w) {
    const e = tool.evidence;
    assert.equal(e.verified_name,
      `${e.wheel_distribution}-wheelhouse-${e.wheel_actual_version}-py313-debian13-x86_64.zip`);
    assert.match(e.sha256, /^[a-f0-9]{64}$/);
    assert.match(e.verified_drive_file_id, /^[\w-]+$/);
    assert.ok(!seen.has(e.verified_name));
    seen.add(e.verified_name);
    if (tool.slug !== "highs") assert.equal(e.catalog_tar_version, e.wheel_actual_version);
  }
  const highs = current.tools.find((t) => t.slug === "highs");
  assert.equal(highs.catalog_version, "1.15.1");
  assert.equal(highs.evidence.wheel_actual_version, "1.16.0");
  assert.ok(highs.evidence.source_name.startsWith("highspy-whl-1.15.1-"));
  assert.equal(highs.evidence.version_alias_only, true);
  assert.equal(current.wheelhouse.original_zip_and_sha256_manifests_preserved, true);
  assert.equal(current.wheelhouse.no_zip_bytes_changed, true);
});

test("tool R2: original native, patched-workspace and transport-block states cannot be conflated", () => {
  for (const tool of current.tools) {
    const e = tool.evidence;
    if (tool.route === "ORIGINAL_TAR_RUNNER_PASS_R4") {
      assert.match(e.sha256, /^[a-f0-9]{64}$/);
      assert.match(e.tsv_sha256, /^[a-f0-9]{64}$/);
    }
    if (tool.route === "LOCAL_PATCHED_FIXTURE_RUNNER_PASS_R4") {
      assert.equal(e.source_core_unchanged, true);
      assert.match(e.tsv_sha256, /^[a-f0-9]{64}$/);
      assert.equal(tool.original_portable_t3, "NOT_QUALIFIED");
    }
    if (tool.route === "ALTERNATE_CLI_SMOKE_PASS_R4") {
      assert.equal(e.python_original_runner, "NOT_RUN_MISSING_BINDINGS");
    }
  }
  assert.deepEqual(
    current.tools.filter((t) => t.route === "BLOCKED_R4").map((t) => t.slug).sort(),
    ["lean4", "why3"]
  );
  const why3 = current.tools.find((t) => t.slug === "why3");
  assert.equal(why3.evidence.preflight_external_symlinks, 27);
  assert.equal(why3.evidence.diagnostic_setup_exit, 1);
});
