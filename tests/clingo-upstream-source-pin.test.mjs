import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BUILDER_PATH = fileURLToPath(new URL("../portable/builders/tools/clingo.sh", import.meta.url));
const builder = readFileSync(BUILDER_PATH, "utf8");
const VERSION = "5.8.3";
const TAG_COMMIT = "2ef91640ed3355c3211e9995edecdb20b16b0e38";

const buildHarness = String.raw`
set -uo pipefail
FT_TOOL_DIR="$MOCK_WORK/tools/clingo"
FT_LOG="$MOCK_WORK/build.log"
mkdir -p "$FT_TOOL_DIR/bin"
cat > "$FT_TOOL_DIR/bin/clingo" <<'BIN'
#!/bin/sh
if [ "${"$"}{MOCK_VERSION_EXIT:-0}" != 0 ]; then exit "$MOCK_VERSION_EXIT"; fi
printf 'clingo version %s\n' "${"$"}{MOCK_VERSION_OUTPUT:-5.8.3}"
BIN
chmod +x "$FT_TOOL_DIR/bin/clingo"
ft::die() { printf '%s\n' "FATAL: $*" >&2; exit 3; }
ft::note() { printf '%s\t%s\n' "$1" "$2" >> "$MOCK_WORK/notes"; }
ft::fetch() {
  if [ "${"$"}{MOCK_FETCH_FAIL:-0}" = 1 ]; then return 42; fi
  printf '%s\n' "$MOCK_WORK/clingo.tar.gz"
}
ft::extract() {
  local dest="$2"
  printf '%s\n' "$dest" >> "$MOCK_WORK/staged-roots"
  if [ "${"$"}{MOCK_EXTRACT_FAIL:-0}" = 1 ]; then return 43; fi
  if [ "${"$"}{MOCK_NO_SOURCE:-0}" = 1 ]; then return 0; fi
  local candidate="$dest/clingo-$FT_UPSTREAM_COMMIT"
  mkdir -p "$candidate/libclingo"
  if [ "${"$"}{MOCK_HEADER:-valid}" != absent ]; then
    printf '#define CLINGO_VERSION "%s"\n' "${"$"}{MOCK_HEADER_VERSION:-5.8.3}" > "$candidate/libclingo/clingo.h"
  fi
  if [ "${"$"}{MOCK_SECOND_SOURCE:-0}" = 1 ]; then mkdir -p "$dest/clingo-second"; fi
  if [ "${"$"}{MOCK_SYMLINK_ONLY:-0}" = 1 ]; then
    rm -rf -- "$candidate"
    ln -s "$MOCK_WORK/old-source" "$candidate"
  fi
  return 0
}
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
    const stageLog = join(work, "staged-roots");
    const stagedRoots = existsSync(stageLog)
      ? readFileSync(stageLog, "utf8").trim().split("\n").filter(Boolean)
      : [];
    return {
      stagedRoots,
      cleaned: stagedRoots.length > 0 && stagedRoots.every(root => !existsSync(dirname(root))),
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

test("fresh private source/build/install stages are unique and cleaned after successful builds", () => {
  const first = runMockBuild();
  const second = runMockBuild();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stagedRoots.length, 1);
  assert.equal(second.stagedRoots.length, 1);
  assert.match(first.stagedRoots[0], /^\/tmp\/ft-clingo\.[^\/\n]+\/source$/);
  assert.match(second.stagedRoots[0], /^\/tmp\/ft-clingo\.[^\/\n]+\/source$/);
  assert.notEqual(first.stagedRoots[0], second.stagedRoots[0]);
  assert.equal(first.cleaned, true, "first successful build left temporary inputs behind");
  assert.equal(second.cleaned, true, "second successful build left temporary inputs behind");
  assert.match(builder, /trap 'rm -rf -- "\$work_dir"' EXIT/);
  assert.ok(!builder.includes('ft::extract "$tgz" /tmp/clingox'));
});

test("missing, duplicate and symlinked extraction roots cannot select stale source", () => {
  for (const [mode, error] of [
    [{ MOCK_NO_SOURCE: "1" }, /source dir not found in fresh stage/],
    [{ MOCK_SECOND_SOURCE: "1" }, /source dirs ambiguous in fresh stage/],
    [{ MOCK_SYMLINK_ONLY: "1" }, /source dir not found in fresh stage/]
  ]) {
    const run = runMockBuild(mode);
    assert.equal(run.status, 3, run.stderr);
    assert.match(run.stderr, error);
    assert.equal(run.stagedRoots.length, 1);
    assert.equal(run.cleaned, true, "failed discovery retained temporary directory");
    assert.equal(run.notes, "");
  }
});

test("failed extraction, source identity, and packaged executable also clean private stages", () => {
  for (const [mode, error] of [
    [{ MOCK_EXTRACT_FAIL: "1" }, /source extraction failed/],
    [{ MOCK_HEADER_VERSION: "6.0.0" }, /source version does not match/],
    [{ MOCK_VERSION_OUTPUT: "6.0.0" }, /packaged clingo version does not match/]
  ]) {
    const run = runMockBuild(mode);
    assert.equal(run.status, 3, run.stderr);
    assert.match(run.stderr, error);
    assert.equal(run.stagedRoots.length, 1);
    assert.equal(run.cleaned, true, "failed build retained temporary directory");
  }
});
