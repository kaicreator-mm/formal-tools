import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessElkMaintenance,
  gitBlobSha1,
  readCurrentElkState,
  validateBaseline
} from "../scripts/tool-portfolio/elk-maintenance.mjs";

const gates = ["T0", "T1", "T2", "T3", "T4", "T5", "T6"];
const sha1 = char => char.repeat(40);
const sha256 = char => char.repeat(64);

const paths = [
  "portable/builders/tools/elk.sh",
  "portable/verification/cases/elk/expect.sh",
  "portable/verification/cases/elk/pos.ofn",
  "portable/verification/cases/elk/neg.ofn",
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
  "docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json"
];

const sourceGates = [
  ["T1", "T2", "T3", "T6"],
  ["T3", "T4", "T5", "T6"],
  ["T3", "T4", "T5", "T6"],
  ["T3", "T4", "T5", "T6"],
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
  ["T0", "T4", "T6"]
];

function baseline() {
  return {
    schema: "formal-tools/elk-t6-maintenance-baseline/1",
    snapshot_head: "069444c176bbacc804f107482f356dbc2eb95736",
    tool: { id: "elk", version: "0.6.0" },
    version_source: "portable/builders/tools/elk.sh",
    asset_pins: {
      portable_package_sha256: sha256("c"),
      upstream_source_archive_sha256: sha256("d"),
      binary_sha256: sha256("b"),
      bundled_jar_sha256: sha256("e"),
      java21_runtime_sha256: sha256("f"),
      oracle_sha256: sha256("a")
    },
    source_files: Object.fromEntries(paths.map((path, index) => [
      path,
      { git_blob_sha1: sha1(String(index + 1).slice(-1)), gates: sourceGates[index] }
    ])),
    component_applicability: {
      native_adapter: "NOT_APPLICABLE_JAVA_BUNDLE",
      runner: "APPLICABLE",
      gateway: "APPLICABLE",
      cli: "APPLICABLE",
      sdk: "APPLICABLE",
      mcp: "APPLICABLE"
    },
    gate_revalidation: Object.fromEntries(gates.map(gate => [
      gate,
      ["Revalidate ELK " + gate + " using exact current source and immutable evidence."]
    ])),
    qualification_boundary: {
      T0: "PASS_SCOPED_ORIGINAL_PORTABLE_ARCHIVE_SHA_AND_PRODUCER_MANIFEST_ONLY",
      T1: "NOT_QUALIFIED_REPRODUCIBLE_SOURCE_BUILD",
      T2: "PASS_SCOPED_R3_SAFE_NONROOT_INSTALL",
      T3: "PASS_SCOPED_R9_NATIVE_POS_NEG_ERR_TECHNICAL_REVIEW; NOT_AN_INDEPENDENT_DOMAIN_ORACLE",
      T4: "NOT_ACCEPTED_ORIGINAL_PACKAGE_CURRENT_MAIN_RUNNER_CLI_SDK_MCP",
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
    const content = path === base.version_source ? "FT_TOOL_VERSION=0.6.0\n" : "fixture:" + path + "\n";
    await writeFile(full, content);
    base.source_files[path].git_blob_sha1 = gitBlobSha1(Buffer.from(content));
  }
}

test("unchanged exact source and asset pins produce CURRENT", () => {
  const base = baseline();
  const report = assessElkMaintenance(base, currentFrom(base));
  assert.equal(report.status, "CURRENT");
  assert.deepEqual(report.stale_gates, []);
  assert.deepEqual(report.unknown_gates, []);
});

test("untracked documentation changes do not stale ELK gates", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.untracked_docs_change = true;
  const report = assessElkMaintenance(base, current);
  assert.equal(report.status, "CURRENT");
  assert.deepEqual(report.stale_gates, []);
});

test("tool version drift stales all lifecycle gates", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.version = "0.7.0";
  const report = assessElkMaintenance(base, current);
  assert.equal(report.status, "STALE");
  assert.deepEqual(report.stale_gates, gates);
});

test("builder drift stales build, install, verify and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["portable/builders/tools/elk.sh"] = sha1("f");
  const report = assessElkMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T1", "T2", "T3", "T6"]);
});

test("fixture drift stales verify, integrate, use and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["portable/verification/cases/elk/neg.ofn"] = sha1("f");
  const report = assessElkMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T3", "T4", "T5", "T6"]);
});

test("Runner drift stales install, verify, integrate and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["portable/packaging/bundle-template/bin/tool-runner"] = sha1("f");
  const report = assessElkMaintenance(base, current);
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
    const report = assessElkMaintenance(base, current);
    assert.deepEqual(report.stale_gates, ["T4", "T6"], path);
  }
});

test("original portable package drift stales every lifecycle gate", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.portable_package_sha256 = sha256("e");
  const report = assessElkMaintenance(base, current);
  assert.deepEqual(report.stale_gates, gates);
});

test("bundled ELK JAR drift stales build, install, verify, integrate, use and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.bundled_jar_sha256 = sha256("d");
  const report = assessElkMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
});

test("shared Java21 runtime drift stales all execution-dependent gates", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.java21_runtime_sha256 = sha256("d");
  const report = assessElkMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
});

test("upstream release archive drift stales source, build and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.upstream_source_archive_sha256 = sha256("e");
  const report = assessElkMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T0", "T1", "T6"]);
});

test("binary drift stales build, install, verify, integrate, use and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.binary_sha256 = sha256("e");
  const report = assessElkMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
});

test("independent Oracle drift stales use and maintain only", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.oracle_sha256 = sha256("e");
  const report = assessElkMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T5", "T6"]);
});

test("missing observed fixture pin remains UNKNOWN without proof of source deletion", () => {
  const base = baseline();
  const current = currentFrom(base);
  delete current.source_blobs["portable/verification/cases/elk/neg.ofn"];
  const report = assessElkMaintenance(base, current);
  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(report.unknown_gates, ["T3", "T4", "T5", "T6"]);
  assert.deepEqual(report.stale_gates, []);
});

test("unestablished upstream, shared-runtime and Oracle pins remain UNKNOWN", () => {
  const base = baseline();
  base.asset_pins.upstream_source_archive_sha256 = null;
  base.asset_pins.binary_sha256 = null;
  base.asset_pins.java21_runtime_sha256 = null;
  base.asset_pins.oracle_sha256 = null;
  const report = assessElkMaintenance(base, currentFrom(base));
  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(report.unknown_gates, ["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);
  assert.deepEqual(report.stale_gates, []);
});

test("malformed current asset hashes map to UNKNOWN, never fabricated changes", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.binary_sha256 = "not-a-sha256";
  const report = assessElkMaintenance(base, current);
  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(report.unknown_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
  assert.deepEqual(report.stale_gates, []);
  assert.deepEqual(report.changes, []);
});

test("missing external asset file and malformed external values remain UNKNOWN", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "elk-maintenance-external-"));
  try {
    await writeMatchingSourceTree(root, base);
    const missing = await readCurrentElkState(root, base, "missing-external.json");
    assert.deepEqual(missing.asset_pins, {
      portable_package_sha256: null,
      upstream_source_archive_sha256: null,
      binary_sha256: null,
      bundled_jar_sha256: null,
      java21_runtime_sha256: null,
      oracle_sha256: null
    });
    const missingReport = assessElkMaintenance(base, missing);
    assert.equal(missingReport.status, "UNKNOWN");
    assert.deepEqual(missingReport.unknown_gates, gates);
    assert.deepEqual(missingReport.stale_gates, []);

    const externalPath = join(root, "external.json");
    await writeFile(externalPath, JSON.stringify({
      portable_package_sha256: sha256("C").toUpperCase(),
      upstream_source_archive_sha256: "not-a-sha256",
      binary_sha256: 17,
      bundled_jar_sha256: sha256("E").toUpperCase(),
      java21_runtime_sha256: "not-a-sha256"
    }));
    const malformed = await readCurrentElkState(root, base, externalPath);
    assert.deepEqual(malformed.asset_pins, {
      portable_package_sha256: sha256("c"),
      upstream_source_archive_sha256: null,
      binary_sha256: null,
      bundled_jar_sha256: sha256("e"),
      java21_runtime_sha256: null,
      oracle_sha256: null
    });
    const malformedReport = assessElkMaintenance(base, malformed);
    assert.equal(malformedReport.status, "UNKNOWN");
    assert.deepEqual(malformedReport.unknown_gates, gates);
    assert.deepEqual(malformedReport.stale_gates, []);
    await assert.rejects(
      readCurrentElkState(root, base, "../outside-external.json"),
      /safe path inside root|remain inside root/
    );
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
  const root = await mkdtemp(join(tmpdir(), "elk-maintenance-link-"));
  try {
    const outside = join(root, "outside.sh");
    await writeFile(outside, "FT_TOOL_VERSION=0.6.0\n");
    const builder = join(root, base.version_source);
    await mkdir(builder.slice(0, builder.lastIndexOf("/")), { recursive: true });
    await symlink(outside, builder);
    await assert.rejects(readCurrentElkState(root, base), /regular non-symlink file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("a physically missing tracked source file is STALE, not UNKNOWN", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "elk-maintenance-missing-source-"));
  try {
    await writeMatchingSourceTree(root, base);
    const missingPath = "portable/verification/cases/elk/neg.ofn";
    await rm(join(root, missingPath));
    const current = await readCurrentElkState(root, base);
    current.asset_pins = { ...base.asset_pins };
    assert.deepEqual(current.missing_source_paths, [missingPath]);
    const report = assessElkMaintenance(base, current);
    assert.equal(report.status, "STALE");
    assert.deepEqual(report.stale_gates, ["T3", "T4", "T5", "T6"]);
    assert.deepEqual(report.unknown_gates, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a physically missing version source stales all gates", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "elk-maintenance-missing-version-"));
  try {
    await writeMatchingSourceTree(root, base);
    await rm(join(root, base.version_source));
    const current = await readCurrentElkState(root, base);
    current.asset_pins = { ...base.asset_pins };
    assert.equal(current.missing_version_source, true);
    const report = assessElkMaintenance(base, current);
    assert.equal(report.status, "STALE");
    assert.deepEqual(report.stale_gates, gates);
    assert.deepEqual(report.unknown_gates, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("current-state reader rejects symlinked parent directories for tracked source files", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "elk-maintenance-parent-link-"));
  const outside = await mkdtemp(join(tmpdir(), "elk-maintenance-outside-"));
  try {
    await mkdir(join(outside, "builders", "tools"), { recursive: true });
    await writeFile(join(outside, "builders", "tools", "elk.sh"), "FT_TOOL_VERSION=0.6.0\n");
    await symlink(outside, join(root, "portable"), "dir");
    await assert.rejects(readCurrentElkState(root, base), /symlinked parent component/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("current-state reader rejects a symlinked parent of version_source", async () => {
  const base = baseline();
  base.source_files = {
    "docs/pinned.txt": { git_blob_sha1: gitBlobSha1(Buffer.from("pinned\n")), gates: ["T6"] }
  };
  const root = await mkdtemp(join(tmpdir(), "elk-maintenance-version-parent-link-"));
  const outside = await mkdtemp(join(tmpdir(), "elk-maintenance-version-outside-"));
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "pinned.txt"), "pinned\n");
    await mkdir(join(outside, "builders", "tools"), { recursive: true });
    await writeFile(join(outside, "builders", "tools", "elk.sh"), "FT_TOOL_VERSION=0.6.0\n");
    await symlink(outside, join(root, "portable"), "dir");
    await assert.rejects(readCurrentElkState(root, base), /symlinked parent component/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("current-state reader hashes exact source bytes and extracts the builder version", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "elk-maintenance-"));
  try {
    await writeMatchingSourceTree(root, base);
    const current = await readCurrentElkState(root, base);
    assert.equal(current.version, "0.6.0");
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

test("CLI maps CURRENT/STALE/UNKNOWN/input error to 0/2/3/64 and emits no-grant JSON", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "elk-maintenance-cli-"));
  try {
    await writeMatchingSourceTree(root, base);
    const baselineDir = join(root, "docs", "tool-portfolio", "r82");
    await mkdir(baselineDir, { recursive: true });
    await writeFile(join(baselineDir, "ELK_T6_MAINTENANCE.json"), JSON.stringify(base));
    await writeFile(join(baselineDir, "external.json"), JSON.stringify(base.asset_pins));
    const scriptPath = fileURLToPath(new URL("../scripts/tool-portfolio/elk-maintenance.mjs", import.meta.url));
    const baselineArg = "docs/tool-portfolio/r82/ELK_T6_MAINTENANCE.json";
    const externalArg = "docs/tool-portfolio/r82/external.json";
    const run = (external = externalArg, baselinePath = baselineArg) => {
      const args = [scriptPath, "--root", root, "--baseline", baselinePath];
      if (external !== null) args.push("--external", external);
      return spawnSync(process.execPath, args, { encoding: "utf8" });
    };

    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "CURRENT");
    assert.equal(JSON.parse(result.stdout).qualification_granted, false);

    await writeFile(join(root, "portable", "verification", "cases", "elk", "neg.ofn"), "drift\n");
    result = run();
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "STALE");

    await writeFile(join(root, "portable", "verification", "cases", "elk", "neg.ofn"), "fixture:portable/verification/cases/elk/neg.ofn\n");
    result = run("docs/tool-portfolio/r82/missing-external.json");
    assert.equal(result.status, 3, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "UNKNOWN");

    await writeFile(join(root, "invalid-baseline.json"), "{");
    result = run(externalArg, "invalid-baseline.json");
    assert.equal(result.status, 64);
    assert.match(result.stderr, /ELK_MAINTENANCE_ERROR/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("qualification boundaries remain scoped and non-promoting", () => {
  const base = baseline();
  const report = assessElkMaintenance(base, currentFrom(base));
  assert.equal(report.qualification_granted, false);
  assert.match(report.qualification_boundary.T3, /NOT_AN_INDEPENDENT_DOMAIN_ORACLE/);
  assert.match(report.qualification_boundary.T4, /NOT_ACCEPTED/);
  assert.match(report.qualification_boundary.T5, /NOT_QUALIFIED/);
  assert.equal(report.qualification_boundary.product_or_release, "NOT_GRANTED");
});
