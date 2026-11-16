import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const builderPath = fileURLToPath(new URL("../portable/builders/tools/prob.sh", import.meta.url));
const source = readFileSync(builderPath, "utf8");
const expectedVersion = "1.16.1-final";

const harness = "set -uo pipefail\nFT_TOOL_DIR=\"$MOCK_ROOT/out/prob\"\nFT_LOG=\"$MOCK_ROOT/build.log\"\nmkdir -p \"$FT_TOOL_DIR\"\nft::fetch() {\n  [ \"$MOCK_FETCH_FAIL\" != \"1\" ] || return 20\n  printf '%s\\n' \"$MOCK_ROOT/ProB.linux64.tar.gz\"\n}\nft::unavailable() { printf 'UNAVAILABLE: %s\\n' \"$*\" >&2; exit 0; }\nft::note() { printf '%s\\t%s\\n' \"$1\" \"$2\" >> \"$MOCK_ROOT/notes\"; }\nft::die() { printf 'FATAL: %s\\n' \"$*\" >&2; exit 3; }\nft::extract() {\n  [ \"$MOCK_EXTRACT_FAIL\" != \"1\" ] || return 7\n  if [ \"$MOCK_WRONG_TOPDIR\" = \"1\" ]; then\n    mkdir -p \"$2/Unrelated-ProB\"\n    return 0\n  fi\n  mkdir -p \"$2/ProB/lib\"\n  if [ \"$MOCK_NO_JAR\" = \"0\" ]; then\n    printf 'not-a-real-jar\\n' > \"$2/ProB/lib/probcliparser.jar\"\n  fi\n  if [ \"$MOCK_NO_BINARY\" = \"0\" ]; then\n    cat > \"$2/ProB/probcli\" <<'BIN'\n#!/bin/sh\n[ \"$MOCK_VERSION_EXIT\" = \"0\" ] || exit \"$MOCK_VERSION_EXIT\"\nprintf 'ProB version %s\\n' \"$MOCK_VERSION_TEXT\"\nBIN\n    chmod +x \"$2/ProB/probcli\"\n  fi\n}\nft::make_shim() { :; }\nsource \"$1\"\nft_tool_build";

function replay(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "formal-prob-build-"));
  try {
    const result = spawnSync("bash", ["-c", harness, "prob-build-test", builderPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        MOCK_ROOT: root,
        MOCK_FETCH_FAIL: "0",
        MOCK_EXTRACT_FAIL: "0",
        MOCK_WRONG_TOPDIR: "0",
        MOCK_NO_JAR: "0",
        MOCK_NO_BINARY: "0",
        MOCK_VERSION_EXIT: "0",
        MOCK_VERSION_TEXT: "1.16.1-final (716929f528b333dd3901a0521fc0d3460a488af7)",
        ...overrides
      }
    });
    const notesPath = join(root, "notes");
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      notes: existsSync(notesPath) ? readFileSync(notesPath, "utf8") : ""
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("ProB builder keeps the official 1.16.1 channel and syntax", () => {
  assert.match(source, /FT_TOOL_ID=prob/);
  assert.match(source, /FT_TOOL_VERSION=1[.]16[.]1/);
  assert.match(source, /stups[.]hhu-hosting[.]de\/downloads\/prob\/tcltk\/releases\/1[.]16[.]1\/ProB[.]linux64[.]tar[.]gz/);
  const syntax = spawnSync("bash", ["-n", builderPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("isolated staging and a real executable version probe record a scoped success", () => {
  const r = replay();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.notes, /prob_version_line\tProB version 1[.]16[.]1-final/);
  assert.match(r.notes, /upstream_archive_sha256_attestation\tUNVERIFIED_OFFICIAL_TAR_GZ/);
  assert.match(source, /mktemp -d \/tmp\/ft-prob-source[.]XXXXXXXX/);
  assert.match(source, /trap "rm -rf -- '\$work_dir'" EXIT/);
  assert.doesNotMatch(source, /ft::extract "\$f" \/tmp\/probx/);
});

test("wrong binary versions cannot pass the builder version gate", () => {
  for (const version of ["1.16.2-final", "1.16.10-final", "1.15.1-final", "0.16.1", "1.16.1-finalX"]) {
    const r = replay({ MOCK_VERSION_TEXT: version });
    assert.equal(r.status, 3, version + " " + r.stderr);
    assert.match(r.stderr, /ProB binary version is not 1[.]16[.]1-final/);
    assert.doesNotMatch(r.notes, /prob_version_line/);
  }
});

test("a failed actual probcli version command is fail closed", () => {
  const r = replay({ MOCK_VERSION_EXIT: "41" });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /ProB version probe failed/);
});

test("missing binary and parser JAR cannot produce a false PASS", () => {
  const missingBinary = replay({ MOCK_NO_BINARY: "1" });
  assert.equal(missingBinary.status, 3);
  assert.match(missingBinary.stderr, /probcli executable missing/);
  const missingJar = replay({ MOCK_NO_JAR: "1" });
  assert.equal(missingJar.status, 3);
  assert.match(missingJar.stderr, /probcliparser[.]jar missing/);
});

test("a stale or incorrectly rooted extracted directory is never selected", () => {
  const r = replay({ MOCK_WRONG_TOPDIR: "1" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /ProB dir not found in tarball/);
});

test("extract failure is not silently ignored", () => {
  const r = replay({ MOCK_EXTRACT_FAIL: "1" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /ProB source extraction failed/);
});

test("an unreachable release is recorded UNAVAILABLE, not a successful tool build", () => {
  const r = replay({ MOCK_FETCH_FAIL: "1" });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /UNAVAILABLE: ProB[.]linux64[.]tar[.]gz unreachable/);
  assert.doesNotMatch(r.notes, /prob_version_line/);
});

test("committed guard does not claim a reproducible source build or signed upstream asset", () => {
  assert.match(source, /UNVERIFIED_OFFICIAL_TAR_GZ/);
  assert.match(source, /historical Drive [.]tar[.]zst hash is for a different derived package/);
  assert.doesNotMatch(source, /ft::fetch "\$FT_UPSTREAM_URL" "[0-9a-f]{64}"/);
});
