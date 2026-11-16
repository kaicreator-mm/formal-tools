import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessTlaTlcMaintenance,
  gitBlobSha1,
  readCurrentTlaTlcState,
  validateBaseline
} from "../scripts/tool-portfolio/tla-tlc-maintenance.mjs";

const gates = ["T0", "T1", "T2", "T3", "T4", "T5", "T6"];
const sha1 = char => char.repeat(40);
const sha256 = char => char.repeat(64);

const paths = [
  "portable/builders/tools/tla-tlc.sh",
  "portable/verification/cases/tla-tlc/expect.sh",
  "portable/verification/cases/tla-tlc/pos.tla",
  "portable/verification/cases/tla-tlc/pos.cfg",
  "portable/verification/cases/tla-tlc/neg.tla",
  "portable/verification/cases/tla-tlc/neg.cfg",
  "tests/tla-tlc-source-fixture-contract.test.mjs",
  "portable/builders/make_meta.py",
  "portable/packaging/bundle-template/bin/tool-runner",
  "portable/packaging/pack.sh",
  "portable/packaging/make-manifest.py",
  "portable/packaging/unpack-template/unpack.sh",
  "packages/runner/js/tool-portfolio-t4.mjs",
  "packages/runner/js/cli.mjs",
  "packages/runner/js/sdk.mjs",
  "packages/runner/js/mcp.mjs",
  "registry/PROBLEM_CAPABILITIES.json",
  "docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json",
  "portable/status/receipts/build-tla-tlc.json",
  "portable/status/receipts/verify-tla-tlc.json",
  "docs/tool-portfolio/r20/TLA_TLC_SOURCE_PIN_FIXTURE_CONTRACT.json"
];

const sourceGates = [
  ["T1", "T2", "T3", "T6"],
  ["T3", "T4", "T5", "T6"],
  ["T3", "T4", "T5", "T6"],
  ["T3", "T4", "T5", "T6"],
  ["T3", "T4", "T5", "T6"],
  ["T3", "T4", "T5", "T6"],
  ["T3", "T6"],
  ["T0", "T1", "T2", "T6"],
  ["T2", "T3", "T4", "T6"],
  ["T0", "T1", "T2", "T6"],
  ["T0", "T1", "T2", "T6"],
  ["T2", "T3", "T4", "T6"],
  ["T4", "T6"],
  ["T4", "T6"],
  ["T4", "T6"],
  ["T4", "T6"],
  ["T4", "T5", "T6"],
  ["T0", "T4", "T6"],
  ["T1", "T6"],
  ["T3", "T6"],
  ["T0", "T1", "T3", "T6"]
];

function baseline() {
  return {
    schema: "formal-tools/tla-tlc-t6-maintenance-baseline/1",
    snapshot_head: "8c0811a7baa5f79953a85a190595995f2463f7d0",
    build_source_head: "0faaa8f693106280bd4f63ddb0a47b8267db4a5b",
    tool: { id: "tla-tlc", version: "1.8.0" },
    version_source: "portable/builders/tools/tla-tlc.sh",
    asset_pins: {
      portable_package_sha256: sha256("c"),
      upstream_jar_sha256: sha256("d"),
      bundled_jar_sha256: sha256("d"),
      java21_runtime_sha256: sha256("e"),
      oracle_sha256: sha256("a")
    },
    source_files: Object.fromEntries(paths.map((path, index) => [
      path,
      { git_blob_sha1: sha1(String(index + 1).slice(-1)), gates: sourceGates[index] }
    ])),
    component_applicability: {
      native_adapter: "NOT_APPLICABLE_JAVA_JAR",
      runner: "APPLICABLE",
      gateway: "APPLICABLE",
      cli: "APPLICABLE",
      sdk: "APPLICABLE",
      mcp: "APPLICABLE"
    },
    gate_revalidation: Object.fromEntries(gates.map(gate => [
      gate,
      ["Revalidate TLA-TLC " + gate + " using exact current source and immutable evidence."]
    ])),
    qualification_boundary: {
      T0: "PASS_SCOPED_GITHUB_RELEASE_API_JAR_DIGEST_AND_SIZE_AT_OBSERVATION; MUTABLE_ROLLING_PRERELEASE; NO_PUBLISHER_SIGNATURE",
      T1: "ACCEPTED_SCOPED_PREBUILT_OFFICIAL_JAR_BUILD_AND_SINGLE_TOOL_PACK; NOT_REPRODUCIBLE_SOURCE_BUILD",
      T2: "HISTORICAL_R3_SCOPED_INSTALL_ONLY",
      T3: "ACCEPTED_SCOPED_R48_POS_NEG_ONLY; ERR_ABSENT",
      T4: "NOT_ACCEPTED",
      T5: "NOT_QUALIFIED_INDEPENDENT_SEMANTIC_ORACLE",
      T6: "ASSESSOR_IMPLEMENTATION_PENDING_INDEPENDENT_REVIEW",
      product_or_release: "NOT_GRANTED"
    }
  };
}

function currentFrom(base) {
  return {
    version: base.tool.version,
    source_blobs: Object.fromEntries(Object.entries(base.source_files).map(([path, pin]) => [path, pin.git_blob_sha1])),
    asset_pins: { ...base.asset_pins }
  };
}

async function writeMatchingSourceTree(root, base) {
  for (const path of Object.keys(base.source_files)) {
    const full = join(root, path);
    await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    const content = path === base.version_source ? "FT_TOOL_VERSION=1.8.0\n" : "fixture:" + path + "\n";
    await writeFile(full, content);
    base.source_files[path].git_blob_sha1 = gitBlobSha1(Buffer.from(content));
  }
}

test("unchanged exact source and asset pins produce CURRENT", () => {
  const base = baseline();
  const report = assessTlaTlcMaintenance(base, currentFrom(base));
  assert.equal(report.status, "CURRENT");
  assert.deepEqual(report.stale_gates, []);
  assert.deepEqual(report.unknown_gates, []);
});

test("untracked documentation changes do not stale TLA-TLC gates", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.untracked_docs_change = true;
  const report = assessTlaTlcMaintenance(base, current);
  assert.equal(report.status, "CURRENT");
});

test("tool version drift stales all lifecycle gates", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.version = "1.9.0";
  const report = assessTlaTlcMaintenance(base, current);
  assert.equal(report.status, "STALE");
  assert.deepEqual(report.stale_gates, gates);
});

test("builder drift stales build, install, verify and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["portable/builders/tools/tla-tlc.sh"] = sha1("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T1", "T2", "T3", "T6"]);
});

test("fixture drift stales verify, integrate, use and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["portable/verification/cases/tla-tlc/neg.tla"] = sha1("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T3", "T4", "T5", "T6"]);
});

test("static fixture contract test drift stales verify and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["tests/tla-tlc-source-fixture-contract.test.mjs"] = sha1("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T3", "T6"]);
});

test("Runner drift stales install, verify, integrate and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["portable/packaging/bundle-template/bin/tool-runner"] = sha1("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T2", "T3", "T4", "T6"]);
});

test("gateway, CLI, SDK and MCP drift each stale integrate and maintain", () => {
  for (const path of [
    "packages/runner/js/tool-portfolio-t4.mjs",
    "packages/runner/js/cli.mjs",
    "packages/runner/js/sdk.mjs",
    "packages/runner/js/mcp.mjs"
  ]) {
    const base = baseline();
    const current = currentFrom(base);
    current.source_blobs[path] = sha1("f");
    const report = assessTlaTlcMaintenance(base, current);
    assert.deepEqual(report.stale_gates, ["T4", "T6"], path);
  }
});

test("portable package drift stales source, build, install, verify, integrate and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.portable_package_sha256 = sha256("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T0", "T1", "T2", "T3", "T4", "T6"]);
});

test("official upstream JAR drift stales source, build and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.upstream_jar_sha256 = sha256("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T0", "T1", "T6"]);
});

test("bundled JAR drift stales build, install, verify, integrate, use and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.bundled_jar_sha256 = sha256("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
});

test("Java21 runtime drift stales install, verify, integrate and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.java21_runtime_sha256 = sha256("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T2", "T3", "T4", "T6"]);
});

test("independent Oracle drift stales use and maintain only", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.oracle_sha256 = sha256("f");
  const report = assessTlaTlcMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T5", "T6"]);
});

test("missing tracked fixture becomes UNKNOWN rather than CURRENT", () => {
  const base = baseline();
  const current = currentFrom(base);
  delete current.source_blobs["portable/verification/cases/tla-tlc/neg.cfg"];
  const report = assessTlaTlcMaintenance(base, current);
  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(report.unknown_gates, ["T3", "T4", "T5", "T6"]);
  assert.deepEqual(report.stale_gates, []);
});

test("missing independent Oracle pin remains UNKNOWN", () => {
  const base = baseline();
  base.asset_pins.oracle_sha256 = null;
  const report = assessTlaTlcMaintenance(base, currentFrom(base));
  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(report.unknown_gates, ["T5", "T6"]);
});

test("malformed current JAR hash maps to UNKNOWN, not a fabricated change", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.bundled_jar_sha256 = "not-a-sha256";
  const report = assessTlaTlcMaintenance(base, current);
  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(report.unknown_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
  assert.deepEqual(report.stale_gates, []);
  assert.deepEqual(report.changes, []);
});

test("missing external asset file and malformed external values remain UNKNOWN", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "tla-tlc-maintenance-external-"));
  try {
    await writeMatchingSourceTree(root, base);
    const missing = await readCurrentTlaTlcState(root, base, "missing-external.json");
    assert.deepEqual(missing.asset_pins, {
      portable_package_sha256: null,
      upstream_jar_sha256: null,
      bundled_jar_sha256: null,
      java21_runtime_sha256: null,
      oracle_sha256: null
    });
    const missingReport = assessTlaTlcMaintenance(base, missing);
    assert.equal(missingReport.status, "UNKNOWN");
    assert.deepEqual(missingReport.unknown_gates, gates);
    assert.deepEqual(missingReport.stale_gates, []);

    const externalPath = join(root, "external.json");
    await writeFile(externalPath, JSON.stringify({
      portable_package_sha256: sha256("C").toUpperCase(),
      upstream_jar_sha256: sha256("D").toUpperCase(),
      bundled_jar_sha256: "not-a-sha256",
      java21_runtime_sha256: 17
    }));
    const malformed = await readCurrentTlaTlcState(root, base, externalPath);
    assert.deepEqual(malformed.asset_pins, {
      portable_package_sha256: sha256("c"),
      upstream_jar_sha256: sha256("d"),
      bundled_jar_sha256: null,
      java21_runtime_sha256: null,
      oracle_sha256: null
    });
    const malformedReport = assessTlaTlcMaintenance(base, malformed);
    assert.equal(malformedReport.status, "UNKNOWN");
    assert.deepEqual(malformedReport.unknown_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
    assert.deepEqual(malformedReport.stale_gates, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("baseline paths, hashes and gate sets fail closed", () => {
  const base = baseline();
  assert.throws(() => validateBaseline({ ...base, schema: "wrong" }), /schema/);
  assert.throws(() => validateBaseline({
    ...base,
    source_files: { "../escape": { git_blob_sha1: sha1("a"), gates: ["T4"] } }
  }), /unsafe source path/);
  assert.throws(() => validateBaseline({
    ...base,
    source_files: { "\\\\server\\\\share": { git_blob_sha1: sha1("a"), gates: ["T4"] } }
  }), /unsafe source path/);
  assert.throws(() => validateBaseline({
    ...base,
    source_files: { "x": { git_blob_sha1: "bad", gates: ["T4"] } }
  }), /invalid Git blob pin/);
  assert.throws(() => validateBaseline({
    ...base,
    source_files: { "x": { git_blob_sha1: sha1("a"), gates: ["T4", "T4"] } }
  }), /invalid affected gates/);
});

test("current-state reader rejects symlinked pinned source files", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "tla-tlc-maintenance-link-"));
  try {
    const outside = join(root, "outside.sh");
    await writeFile(outside, "FT_TOOL_VERSION=1.8.0\n");
    const builder = join(root, base.version_source);
    await mkdir(builder.slice(0, builder.lastIndexOf("/")), { recursive: true });
    await symlink(outside, builder);
    await assert.rejects(readCurrentTlaTlcState(root, base), /regular non-symlink file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("current-state reader hashes exact source bytes and extracts the builder version", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "tla-tlc-maintenance-"));
  try {
    await writeMatchingSourceTree(root, base);
    const current = await readCurrentTlaTlcState(root, base);
    assert.equal(current.version, "1.8.0");
    for (const path of Object.keys(base.source_files)) {
      assert.equal(current.source_blobs[path], base.source_files[path].git_blob_sha1, path);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Git blob hashing uses canonical header and byte length", () => {
  const bytes = Buffer.from("hello\n", "utf8");
  assert.equal(gitBlobSha1(bytes), "ce013625030ba8dba906f756967f9e9ca394464a");
});

test("qualification boundaries preserve rolling prerelease, two-case and no-promotion limits", () => {
  const base = baseline();
  const report = assessTlaTlcMaintenance(base, currentFrom(base));
  assert.match(report.qualification_boundary.T0, /MUTABLE_ROLLING_PRERELEASE/);
  assert.match(report.qualification_boundary.T1, /NOT_REPRODUCIBLE_SOURCE_BUILD/);
  assert.match(report.qualification_boundary.T3, /ERR_ABSENT/);
  assert.match(report.qualification_boundary.T4, /NOT_ACCEPTED/);
  assert.match(report.qualification_boundary.T5, /NOT_QUALIFIED/);
  assert.equal(report.qualification_boundary.product_or_release, "NOT_GRANTED");
});
