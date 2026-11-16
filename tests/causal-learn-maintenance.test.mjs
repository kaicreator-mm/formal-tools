import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ASSET_GATE_DEPENDENCIES,
  assessCausalLearnMaintenance,
  gitBlobSha1,
  readCurrentCausalLearnState,
  validateBaseline
} from "../scripts/tool-portfolio/causal-learn-maintenance.mjs";

const sha1 = char => char.repeat(40);
const sha256 = char => char.repeat(64);
const gates = ["T0", "T1", "T2", "T3", "T4", "T5", "T6"];

function makeBaseline() {
  return {
    schema: "formal-tools/causal-learn-t6-maintenance-baseline/1",
    snapshot_head: "a229566c14a0d00b9b05a4a3d5e018b487cf1c73",
    tool: { id: "causal-learn", version: "0.1.4.8" },
    version_source: "portable/status/receipts/build-causal-learn.json",
    source_files: {
      "portable/builders/tools/causal-learn.sh": {
        git_blob_sha1: sha1("a"), gates: ["T0", "T1", "T2", "T6"]
      },
      "portable/status/receipts/build-causal-learn.json": {
        git_blob_sha1: sha1("b"), gates: ["T1", "T2", "T3", "T6"]
      },
      "portable/verification/cases/causal-learn/pos.py": {
        git_blob_sha1: sha1("c"), gates: ["T3", "T4", "T5", "T6"]
      }
    },
    asset_pins: {
      tool_archive_sha256: sha256("a"),
      python313_runtime_sha256: sha256("b"),
      portable_core_archive_sha256: sha256("c"),
      upstream_source_sdist_sha256: sha256("d"),
      independent_oracle_sha256: sha256("e")
    },
    gate_revalidation: Object.fromEntries(gates.map(gate => [
      gate, ["Revalidate " + gate + " from exact causal-learn source and evidence."]
    ])),
    qualification_boundary: {
      T0: "PASS_SCOPED_ARCHIVE_HASH_MATCH_ONLY",
      T1: "NOT_QUALIFIED_REPRODUCIBLE_BUILD",
      T2: "NOT_QUALIFIED_CANONICAL_PORTABLE_RUNTIME_NOT_REPLAYED",
      T3: "HOST_PYTHON_SUBSTITUTE_ONLY; CANONICAL_RUNNER_REPLAY_NOT_RUN",
      T4: "NOT_ACCEPTED_CURRENT_MAIN_RUNNER_CLI_SDK_MCP",
      T5: "NOT_QUALIFIED_INDEPENDENT_CAUSAL_ORACLE",
      T6: "ASSESSOR_IMPLEMENTATION_PENDING_REVIEW",
      product_or_release: "NOT_GRANTED"
    }
  };
}

function currentFrom(baseline) {
  return {
    version: baseline.tool.version,
    source_blobs: Object.fromEntries(Object.entries(baseline.source_files)
      .map(([path, pin]) => [path, pin.git_blob_sha1])),
    asset_pins: structuredClone(baseline.asset_pins),
    missing_source_paths: [],
    missing_version_source: false
  };
}

test("Git blob SHA-1 uses Git's blob header and exact UTF-8 bytes", () => {
  assert.equal(gitBlobSha1(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("unchanged fully observed identities are CURRENT and never grant qualification", () => {
  const baseline = makeBaseline();
  const result = assessCausalLearnMaintenance(baseline, currentFrom(baseline));
  assert.equal(result.status, "CURRENT");
  assert.deepEqual(result.stale_gates, []);
  assert.deepEqual(result.unknown_gates, []);
  assert.deepEqual(result.affected_gates, []);
  assert.equal(result.qualification_granted, false);
});

test("fixture Blob drift invalidates T3 and dependent T4/T5/T6 only", () => {
  const baseline = makeBaseline();
  const current = currentFrom(baseline);
  current.source_blobs["portable/verification/cases/causal-learn/pos.py"] = sha1("f");
  const result = assessCausalLearnMaintenance(baseline, current);
  assert.equal(result.status, "STALE");
  assert.deepEqual(result.stale_gates, ["T3", "T4", "T5", "T6"]);
  assert.deepEqual(result.unknown_gates, []);
});

test("tool version drift invalidates all lifecycle gates", () => {
  const baseline = makeBaseline();
  const current = currentFrom(baseline);
  current.version = "0.1.4.9";
  const result = assessCausalLearnMaintenance(baseline, current);
  assert.deepEqual(result.stale_gates, gates);
});

test("missing tracked source is STALE for only the source's dependent gates", () => {
  const baseline = makeBaseline();
  const current = currentFrom(baseline);
  current.missing_source_paths = ["portable/verification/cases/causal-learn/pos.py"];
  const result = assessCausalLearnMaintenance(baseline, current);
  assert.deepEqual(result.stale_gates, ["T3", "T4", "T5", "T6"]);
});

test("missing canonical runtime observation is UNKNOWN, never assumed to match manifest", () => {
  const baseline = makeBaseline();
  const current = currentFrom(baseline);
  current.asset_pins.python313_runtime_sha256 = null;
  const result = assessCausalLearnMaintenance(baseline, current);
  assert.equal(result.status, "UNKNOWN");
  assert.deepEqual(result.stale_gates, []);
  assert.deepEqual(result.unknown_gates, ["T1", "T2", "T3", "T4", "T5", "T6"]);
});

test("unestablished Oracle baseline remains UNKNOWN and cannot complete T5", () => {
  const baseline = makeBaseline();
  baseline.asset_pins.independent_oracle_sha256 = null;
  const current = currentFrom(baseline);
  current.asset_pins.independent_oracle_sha256 = null;
  const result = assessCausalLearnMaintenance(baseline, current);
  assert.ok(result.unknown_gates.includes("T5"));
  assert.ok(result.unknown_gates.includes("T6"));
  assert.equal(result.qualification_granted, false);
});

test("malformed observed hash is UNKNOWN rather than CURRENT or STALE", () => {
  const baseline = makeBaseline();
  const current = currentFrom(baseline);
  current.asset_pins.tool_archive_sha256 = "sha256:not-a-digest";
  const result = assessCausalLearnMaintenance(baseline, current);
  assert.equal(result.status, "UNKNOWN");
  assert.ok(result.unknown_gates.includes("T0"));
});

test("a changed package archive marks only dependent lifecycle gates stale", () => {
  const baseline = makeBaseline();
  const current = currentFrom(baseline);
  current.asset_pins.tool_archive_sha256 = sha256("f");
  const result = assessCausalLearnMaintenance(baseline, current);
  assert.deepEqual(result.stale_gates, ["T0", "T1", "T2", "T3", "T4", "T6"]);
  assert.ok(!result.stale_gates.includes("T5"));
});

test("baseline rejects unsafe source paths, malformed pins and missing qualification boundaries", () => {
  const unsafe = makeBaseline();
  unsafe.source_files["../escape"] = { git_blob_sha1: sha1("a"), gates: ["T1"] };
  assert.throws(() => validateBaseline(unsafe), /unsafe source path/);

  const malformed = makeBaseline();
  malformed.source_files["portable/builders/tools/causal-learn.sh"].git_blob_sha1 = "not-a-blob";
  assert.throws(() => validateBaseline(malformed), /invalid Git blob pin/);

  const incomplete = makeBaseline();
  delete incomplete.qualification_boundary.T5;
  assert.throws(() => validateBaseline(incomplete), /qualification boundary missing T5/);
});

test("asset gate dependency table is explicit and covers every gate", () => {
  const covered = new Set(Object.values(ASSET_GATE_DEPENDENCIES).flat());
  assert.deepEqual([...covered].sort(), gates.slice().sort());
});

test("readCurrentCausalLearnState computes Git Blob pins and version from exact local bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "causal-learn-t6-"));
  try {
    await mkdir(join(root, "portable/builders/tools"), { recursive: true });
    await mkdir(join(root, "portable/status/receipts"), { recursive: true });
    await writeFile(join(root, "portable/builders/tools/causal-learn.sh"), "FT_TOOL_ID=causal-learn\n");
    await writeFile(join(root, "portable/status/receipts/build-causal-learn.json"),
      JSON.stringify({ version: "0.1.4.8" }) + "\n");
    await writeFile(join(root, "observed-assets.json"), JSON.stringify({
      tool_archive_sha256: sha256("a"),
      python313_runtime_sha256: sha256("b"),
      portable_core_archive_sha256: sha256("c"),
      upstream_source_sdist_sha256: sha256("d"),
      independent_oracle_sha256: sha256("e")
    }));
    const baseline = makeBaseline();
    baseline.source_files = {
      "portable/builders/tools/causal-learn.sh": {
        git_blob_sha1: gitBlobSha1("FT_TOOL_ID=causal-learn\n"), gates: ["T0", "T1", "T2", "T6"]
      },
      "portable/status/receipts/build-causal-learn.json": {
        git_blob_sha1: gitBlobSha1(JSON.stringify({ version: "0.1.4.8" }) + "\n"), gates: ["T1", "T2", "T3", "T6"]
      }
    };
    const current = await readCurrentCausalLearnState(root, baseline, "observed-assets.json");
    assert.equal(current.version, "0.1.4.8");
    assert.deepEqual(current.missing_source_paths, []);
    assert.equal(current.source_blobs["portable/builders/tools/causal-learn.sh"],
      baseline.source_files["portable/builders/tools/causal-learn.sh"].git_blob_sha1);
    assert.equal(current.asset_pins.tool_archive_sha256, sha256("a"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing tracked source is reported explicitly for stale assessment", async () => {
  const root = await mkdtemp(join(tmpdir(), "causal-learn-t6-missing-"));
  try {
    const baseline = makeBaseline();
    const current = await readCurrentCausalLearnState(root, baseline);
    assert.ok(current.missing_source_paths.includes("portable/builders/tools/causal-learn.sh"));
    assert.equal(current.missing_version_source, true);
    const result = assessCausalLearnMaintenance(baseline, current);
    assert.equal(result.status, "STALE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readCurrentCausalLearnState rejects symlinked parent components", async () => {
  const root = await mkdtemp(join(tmpdir(), "causal-learn-t6-parent-link-"));
  const outside = await mkdtemp(join(tmpdir(), "causal-learn-t6-outside-"));
  try {
    await writeFile(join(outside, "source.mjs"), "outside\n");
    await symlink(outside, join(root, "linked"));
    const baseline = makeBaseline();
    baseline.version_source = "linked/source.mjs";
    baseline.source_files = {
      "linked/source.mjs": { git_blob_sha1: sha1("a"), gates: ["T1", "T6"] }
    };
    await assert.rejects(
      readCurrentCausalLearnState(root, baseline),
      /symlinked parent component/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("readCurrentCausalLearnState rejects a symlinked final source file", async () => {
  const root = await mkdtemp(join(tmpdir(), "causal-learn-t6-final-link-"));
  const outside = await mkdtemp(join(tmpdir(), "causal-learn-t6-final-outside-"));
  try {
    await writeFile(join(outside, "source.mjs"), "outside\n");
    await mkdir(join(root, "portable"), { recursive: true });
    await symlink(join(outside, "source.mjs"), join(root, "portable/source.mjs"));
    const baseline = makeBaseline();
    baseline.version_source = "portable/source.mjs";
    baseline.source_files = {
      "portable/source.mjs": { git_blob_sha1: sha1("a"), gates: ["T1", "T6"] }
    };
    await assert.rejects(
      readCurrentCausalLearnState(root, baseline),
      /regular non-symlink file/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("external asset path rejects traversal and absolute paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "causal-learn-t6-external-"));
  try {
    const baseline = makeBaseline();
    await assert.rejects(
      readCurrentCausalLearnState(root, baseline, "../outside.json"),
      /safe path/
    );
    await assert.rejects(
      readCurrentCausalLearnState(root, baseline, "/etc/passwd"),
      /safe relative path/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
