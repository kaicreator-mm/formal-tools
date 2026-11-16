import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BUILDER_PATH = fileURLToPath(new URL("../portable/builders/tools/clingo.sh", import.meta.url));
const builder = readFileSync(BUILDER_PATH, "utf8");
const VERSION = "5.8.3";
const TAG_COMMIT = "2ef91640ed3355c3211e9995edecdb20b16b0e38";

const buildHarness = String.raw`
set -uo pipefail
FT_TOOL_DIR="$MOCK_WORK/tools/clingo"
FT_LOG="$MOCK_WORK/build.log"
MOCK_SOURCE_DIR="$MOCK_WORK/src/clingo-source"
mkdir -p "$FT_TOOL_DIR/bin" "$MOCK_SOURCE_DIR/libclingo"
if [ "${MOCK_HEADER:-valid}" != absent ]; then
  printf '#define CLINGO_VERSION "%s"\n' "${MOCK_HEADER_VERSION:-5.8.3}" > "$MOCK_SOURCE_DIR/libclingo/clingo.h"
fi
cat > "$FT_TOOL_DIR/bin/clingo" <<'BIN'
#!/bin/sh
if [ "${MOCK_VERSION_EXIT:-0}" != 0 ]; then exit "$MOCK_VERSION_EXIT"; fi
printf 'clingo version %s\n' "${MOCK_VERSION_OUTPUT:-5.8.3}"
BIN
chmod +x "$FT_TOOL_DIR/bin/clingo"
ft::die() { printf '%s\n' "FATAL: $*" >&2; exit 3; }
ft::note() { printf '%s\t%s\n' "$1" "$2" >> "$MOCK_WORK/notes"; }
ft::fetch() {
  if [ "${MOCK_FETCH_FAIL:-0}" = 1 ]; then return 42; fi
  printf '%s\n' "$MOCK_WORK/clingo.tar.gz"
}
ft::extract() {
  if [ "${MOCK_EXTRACT_FAIL:-0}" = 1 ]; then return 43; fi
  return 0
}
find() { printf '%s\n' "$MOCK_SOURCE_DIR"; }
cmake() { return 0; }
cp() { return 0; }
ft::copy_libs() { return 0; }
patchelf() { return 0; }
ft::make_shim() { return 0; }
source "$1"
ft_tool_build
`;

function runMockBuild(overrides = {}) {
  const work = mkdtempSync(join(tmpdir(), "clingo-source-pin-"));
  try {
    const run = spawnSync("bash", ["-c", buildHarness, "clingo-build", BUILDER_PATH], {
      encoding: "utf8",
      env: { ...process.env, MOCK_WORK: work, ...overrides }
    });
    return {
      status: run.status,
      stderr: run.stderr,
      stdout: run.stdout,
      notes: run.status === 0 ? readFileSync(join(work, "notes"), "utf8") : ""
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("Clingo builder is bound to the independently resolved v5.8.3 Git commit", () => {
  const lines = builder.split(/\r?\n/);
  const commit = lines.find(line => line.startsWith("FT_UPSTREAM_COMMIT="));
  assert.equal(commit, "FT_UPSTREAM_COMMIT=" + TAG_COMMIT);
  assert.equal(
    lines.find(line => line.startsWith("FT_UPSTREAM_URL=")),
    'FT_UPSTREAM_URL="https://github.com/potassco/clingo/archive/${FT_UPSTREAM_COMMIT}.tar.gz"'
  );
  assert.equal(lines.find(line => line.startsWith("FT_TOOL_VERSION=")), "FT_TOOL_VERSION=" + VERSION);
  assert.ok(!builder.includes("archive/refs/tags/"), "mutable tag source URL must not return");
  assert.match(builder, /ft::note "source_archive_sha256_attestation" "NOT_VERIFIED_COMMIT_ADDRESSED_ONLY"/);
});

test("sourcing the actual builder resolves exactly the full pinned commit URL", () => {
  const script = 'set -euo pipefail; source "$1"; printf "%s\n%s\n" "$FT_UPSTREAM_URL" "$FT_UPSTREAM_NOTE"';
  const result = spawnSync("bash", ["-c", script, "clingo-source", BUILDER_PATH], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines[0], "https://github.com/potassco/clingo/archive/" + TAG_COMMIT + ".tar.gz");
  assert.match(lines[1], /source archive SHA256 not independently pinned/);
});

test("mocked tool-owned build records commit provenance and checks both source and binary version", () => {
  const run = runMockBuild();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.notes, /upstream_tag\tv5[.]8[.]3/);
  assert.ok(run.notes.includes("upstream_resolved_commit\t" + TAG_COMMIT));
  assert.match(run.notes, /source_archive_sha256_attestation\tNOT_VERIFIED_COMMIT_ADDRESSED_ONLY/);
});

test("source header version mismatch is fail closed before any claimed build success", () => {
  const mismatches = ["5.8.2", "5.8.4", "6.0.0"];
  for (const version of mismatches) {
    const run = runMockBuild({ MOCK_HEADER_VERSION: version });
    assert.equal(run.status, 3, version + ": " + run.stderr);
    assert.match(run.stderr, /clingo source version does not match v5[.]8[.]3/);
  }
  const absent = runMockBuild({ MOCK_HEADER: "absent" });
  assert.equal(absent.status, 3, absent.stderr);
  assert.match(absent.stderr, /clingo source version header missing/);
});

test("packaged executable must actually report clingo 5.8.3 on the exact output line", () => {
  for (const version of ["5.8.2", "5.8.4", "5.8.30", "6.0.0"]) {
    const run = runMockBuild({ MOCK_VERSION_OUTPUT: version });
    assert.equal(run.status, 3, version + ": " + run.stderr);
    assert.match(run.stderr, /packaged clingo version does not match 5[.]8[.]3/);
  }
  const fail = runMockBuild({ MOCK_VERSION_EXIT: "1" });
  assert.equal(fail.status, 3, fail.stderr);
  assert.match(fail.stderr, /packaged clingo version probe failed/);
});

test("failed source fetch and extraction do not continue to a fake PASS", () => {
  const fetch = runMockBuild({ MOCK_FETCH_FAIL: "1" });
  assert.equal(fetch.status, 3, fetch.stderr);
  assert.match(fetch.stderr, /clingo source download failed/);
  const extract = runMockBuild({ MOCK_EXTRACT_FAIL: "1" });
  assert.equal(extract.status, 3, extract.stderr);
  assert.match(extract.stderr, /clingo source extraction failed/);
});

test("this regression is scoped to source identity, not reproducible-build acceptance", () => {
  assert.match(builder, /source archive SHA256 not independently pinned/);
  assert.match(builder, /ft::fetch "\$FT_UPSTREAM_URL"/);
  assert.match(builder, /FT_UPSTREAM_COMMIT=2ef91640ed3355c3211e9995edecdb20b16b0e38/);
});
