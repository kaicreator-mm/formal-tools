import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessAflppMaintenance,
  gitBlobSha1,
  readCurrentAflppState,
  validateBaseline
} from "../scripts/tool-portfolio/aflpp-maintenance.mjs";

const gates = ["T0", "T1", "T2", "T3", "T4", "T5", "T6"];
const sha1 = char => char.repeat(40);
const sha256 = char => char.repeat(64);

function baseline() {
  return {
    schema: "formal-tools/aflpp-t6-maintenance-baseline/1",
    snapshot_head: "0f2141dc4dcecacd5a6db72b22c28af447b50b23",
    tool: { id: "aflpp", version: "5.03c" },
    version_source: "portable/builders/tools/aflpp.sh",
    asset_pins: {
      portable_package_sha256: sha256("a"),
      upstream_source_archive_sha256: sha256("d"),
      binary_sha256: sha256("b"),
      oracle_sha256: sha256("c")
    },
    source_files: {
      "portable/builders/tools/aflpp.sh": { git_blob_sha1: sha1("1"), gates: ["T1", "T2", "T3", "T6"] },
      "portable/verification/cases/aflpp/expect.sh": { git_blob_sha1: sha1("2"), gates: ["T3", "T4", "T5", "T6"] },
      "portable/packaging/bundle-template/bin/tool-runner": { git_blob_sha1: sha1("3"), gates: ["T2", "T3", "T4", "T6"] },
      "packages/runner/js/tool-portfolio-t4.mjs": { git_blob_sha1: sha1("4"), gates: ["T4", "T6"] },
      "packages/runner/js/cli.mjs": { git_blob_sha1: sha1("5"), gates: ["T4", "T6"] },
      "packages/runner/js/sdk.mjs": { git_blob_sha1: sha1("6"), gates: ["T4", "T6"] },
      "packages/runner/js/mcp.mjs": { git_blob_sha1: sha1("7"), gates: ["T4", "T6"] }
    },
    component_applicability: {
      native_adapter: "NOT_APPLICABLE_CANDIDATE_PORTFOLIO_ROUTE",
      gateway: "APPLICABLE",
      cli: "APPLICABLE",
      sdk: "APPLICABLE",
      mcp: "APPLICABLE"
    },
    gate_revalidation: Object.fromEntries(gates.map(gate => [gate, ["Revalidate " + gate + " using exact current source and immutable evidence."]])),
    qualification_boundary: {
      T0: "PASS_SCOPED_PRODUCER_MANIFEST_ONLY",
      T1: "NOT_QUALIFIED",
      T2: "PASS_SCOPED_NONROOT_INSTALL",
      T3: "PASS_SCOPED_R8_R9_FIXTURE_REVIEWED",
      T4: "NOT_ACCEPTED_FULL_CURRENT_MAIN_GATE",
      T5: "NOT_QUALIFIED",
      T6: "ASSESSOR_PENDING_INDEPENDENT_REVIEW"
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

test("unchanged exact pins produce CURRENT with no stale or unknown gates", () => {
  const base = baseline();
  const report = assessAflppMaintenance(base, currentFrom(base));
  assert.equal(report.status, "CURRENT");
  assert.deepEqual(report.stale_gates, []);
  assert.deepEqual(report.unknown_gates, []);
});

test("docs-only changes outside the pinned write set do not stale AFL++ gates", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.untracked_docs_change = true;
  const report = assessAflppMaintenance(base, current);
  assert.equal(report.status, "CURRENT");
  assert.deepEqual(report.stale_gates, []);
});

test("version drift stales all lifecycle gates", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.version = "5.04";
  const report = assessAflppMaintenance(base, current);
  assert.equal(report.status, "STALE");
  assert.deepEqual(report.stale_gates, gates);
});

test("portable package drift stales source, install, verify, integrate and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.portable_package_sha256 = sha256("e");
  const report = assessAflppMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T0", "T2", "T3", "T4", "T6"]);
});

test("upstream source archive drift stales source, build and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.upstream_source_archive_sha256 = sha256("e");
  const report = assessAflppMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T0", "T1", "T6"]);
});

test("binary drift stales build, install, verify, integrate, use and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.binary_sha256 = sha256("d");
  const report = assessAflppMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
});

test("fixture drift stales verify, integrate, use and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["portable/verification/cases/aflpp/expect.sh"] = sha1("d");
  const report = assessAflppMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T3", "T4", "T5", "T6"]);
});

test("Runner drift stales install, verify, integrate and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["portable/packaging/bundle-template/bin/tool-runner"] = sha1("d");
  const report = assessAflppMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T2", "T3", "T4", "T6"]);
});

test("gateway drift stales only integrate and maintain", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.source_blobs["packages/runner/js/tool-portfolio-t4.mjs"] = sha1("d");
  const report = assessAflppMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T4", "T6"]);
});

test("CLI, SDK and MCP drift each stale integrate and maintain", () => {
  for (const path of ["packages/runner/js/cli.mjs", "packages/runner/js/sdk.mjs", "packages/runner/js/mcp.mjs"]) {
    const base = baseline();
    const current = currentFrom(base);
    current.source_blobs[path] = sha1("d");
    const report = assessAflppMaintenance(base, current);
    assert.deepEqual(report.stale_gates, ["T4", "T6"], path);
  }
});

test("Oracle drift stales use and maintain only", () => {
  const base = baseline();
  const current = currentFrom(base);
  current.asset_pins.oracle_sha256 = sha256("d");
  const report = assessAflppMaintenance(base, current);
  assert.deepEqual(report.stale_gates, ["T5", "T6"]);
});

test("missing tracked files produce UNKNOWN, never a false CURRENT or fabricated change", () => {
  const base = baseline();
  const current = currentFrom(base);
  delete current.source_blobs["packages/runner/js/mcp.mjs"];
  const report = assessAflppMaintenance(base, current);
  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(report.unknown_gates, ["T4", "T6"]);
  assert.deepEqual(report.stale_gates, []);
});

test("unestablished binary and Oracle baselines remain UNKNOWN, not PASS", () => {
  const base = baseline();
  base.asset_pins.upstream_source_archive_sha256 = null;
  base.asset_pins.binary_sha256 = null;
  base.asset_pins.oracle_sha256 = null;
  const current = currentFrom(base);
  const report = assessAflppMaintenance(base, current);
  assert.equal(report.status, "UNKNOWN");
  assert.ok(report.unknown_gates.includes("T0"));
  assert.ok(report.unknown_gates.includes("T1"));
  assert.ok(report.unknown_gates.includes("T5"));
});

test("native adapter is explicitly not applicable to this candidate gateway route", () => {
  const base = baseline();
  assert.equal(base.component_applicability.native_adapter, "NOT_APPLICABLE_CANDIDATE_PORTFOLIO_ROUTE");
  assert.ok(!Object.keys(base.source_files).some(path => path.includes("native.mjs")));
});

test("malformed or unsafe baselines fail closed", () => {
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
});

test("current state reader rejects symlinked pinned source files", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "aflpp-maintenance-link-"));
  try {
    const outside = join(root, "outside.sh");
    await writeFile(outside, "FT_TOOL_VERSION=5.03c\\n");
    const builder = join(root, base.version_source);
    await mkdir(builder.slice(0, builder.lastIndexOf("/")), { recursive: true });
    await symlink(outside, builder);
    await assert.rejects(
      readCurrentAflppState(root, base),
      /regular non-symlink file/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("external asset pins keep all four fields and map invalid or missing values to UNKNOWN", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "aflpp-maintenance-external-pins-"));
  try {
    const withoutExternal = await readCurrentAflppState(root, base);
    assert.deepEqual(withoutExternal.asset_pins, {
      portable_package_sha256: null,
      upstream_source_archive_sha256: null,
      binary_sha256: null,
      oracle_sha256: null
    });

    const externalPath = join(root, "external.json");
    await writeFile(externalPath, JSON.stringify({
      portable_package_sha256: sha256("A"),
      upstream_source_archive_sha256: "not-a-sha256",
      binary_sha256: 17
    }));
    const current = await readCurrentAflppState(root, base, externalPath);
    assert.deepEqual(current.asset_pins, {
      portable_package_sha256: sha256("a"),
      upstream_source_archive_sha256: null,
      binary_sha256: null,
      oracle_sha256: null
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Git blob hashing uses the canonical blob header and byte length", () => {
  const bytes = Buffer.from("hello\n", "utf8");
  assert.equal(gitBlobSha1(bytes), "ce013625030ba8dba906f756967f9e9ca394464a");
});

test("current state reader hashes exact repository bytes and extracts the pinned builder version", async () => {
  const base = baseline();
  const root = await mkdtemp(join(tmpdir(), "aflpp-maintenance-"));
  try {
    for (const path of Object.keys(base.source_files)) {
      const full = join(root, path);
      await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
      const content = path === base.version_source ? "FT_TOOL_VERSION=5.03c\n" : "fixture:" + path + "\n";
      await writeFile(full, content);
      base.source_files[path].git_blob_sha1 = gitBlobSha1(Buffer.from(content));
    }
    const externalPath = join(root, "external.json");
    await writeFile(externalPath, JSON.stringify({
      portable_package_sha256: base.asset_pins.portable_package_sha256,
      upstream_source_archive_sha256: base.asset_pins.upstream_source_archive_sha256,
      binary_sha256: base.asset_pins.binary_sha256,
      oracle_sha256: base.asset_pins.oracle_sha256
    }));
    const current = await readCurrentAflppState(root, base, externalPath);
    assert.equal(current.version, "5.03c");
    assert.equal(current.source_blobs["portable/builders/tools/aflpp.sh"], base.source_files["portable/builders/tools/aflpp.sh"].git_blob_sha1);
    assert.equal(current.asset_pins.portable_package_sha256, base.asset_pins.portable_package_sha256);
    assert.equal(current.asset_pins.upstream_source_archive_sha256, base.asset_pins.upstream_source_archive_sha256);
    assert.equal(current.asset_pins.binary_sha256, base.asset_pins.binary_sha256);
    assert.equal(current.asset_pins.oracle_sha256, base.asset_pins.oracle_sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
