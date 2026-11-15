import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../docs/tool-portfolio/r27/raw/cvc5/", import.meta.url));
const receiptPath = fileURLToPath(new URL("../docs/tool-portfolio/r27/CVC5_NATIVE_REPLAY.json", import.meta.url));
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (dir, name) => readFileSync(join(root, dir, name));

for (const dir of ["portable", "adapter"]) {
  test(`cvc5 ${dir} raw replay checksum manifest is complete`, () => {
    const lines = read(dir, "SHA256SUMS").toString("utf8").trim().split(/\r?\n/);
    assert.ok(lines.length > 0);
    for (const line of lines) {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      assert.ok(match, `invalid checksum line: ${line}`);
      assert.equal(sha256(read(dir, match[2])), match[1], `${dir}/${match[2]}`);
    }
  });
}

test("original package POS/NEG/ERR exits and outputs match the committed portable fixtures", () => {
  const cases = receipt.portable_verification_replay.fixtures;
  for (const [name, expected] of Object.entries(cases)) {
    assert.equal(read("portable", `${name}.exit`).toString("utf8").trim(), String(expected.exit));
    assert.equal(sha256(read("portable", `${name}.stdout`)), expected.stdout_sha256);
    assert.equal(sha256(read("portable", `${name}.stderr`)), expected.stderr_sha256);
  }
  assert.equal(read("portable", "pos.stdout").toString("utf8"), "sat\n");
  assert.equal(read("portable", "neg.stdout").toString("utf8"), "unsat\n");
  assert.match(read("portable", "err.stdout").toString("utf8"), /Parse Error/);
});

test("current-main native adapter fixture direct replay matches its SAT/UNSAT parser contract", () => {
  const cases = receipt.current_main_native_adapter_fixture_direct_replay.fixtures;
  assert.equal(read("adapter", "positive.stdout").toString("utf8"), "unsat\n");
  assert.equal(read("adapter", "negative.stdout").toString("utf8"), "sat\n");
  for (const [name, expected] of Object.entries(cases)) {
    assert.equal(read("adapter", `${name}.exit`).toString("utf8").trim(), String(expected.exit));
    assert.equal(sha256(read("adapter", `${name}.stdout`)), expected.stdout_sha256);
    assert.equal(sha256(read("adapter", `${name}.stderr`)), expected.stderr_sha256);
  }
});

test("archive member manifest rejects links, special entries and unsafe paths", () => {
  const manifest = JSON.parse(read("portable", "archive-members.json").toString("utf8"));
  assert.equal(manifest.member_count, 6);
  assert.equal(manifest.regular_files, 4);
  assert.equal(manifest.directories, 2);
  assert.equal(manifest.symlinks + manifest.hardlinks + manifest.special_entries, 0);
  assert.equal(manifest.absolute_paths + manifest.traversal_paths + manifest.duplicate_paths, 0);
  for (const item of manifest.members) {
    assert.equal(item.path.startsWith("/"), false);
    assert.equal(item.path.split("/").includes(".."), false);
    assert.ok(["directory", "regular_file"].includes(item.type));
  }
});

test("current-main source pins and qualification boundaries remain explicit", () => {
  assert.equal(receipt.repo_main_sha, "0f2141dc4dcecacd5a6db72b22c28af447b50b23");
  assert.equal(receipt.current_main_source_pins.native_mjs, "2e0e669e4fa66cb27654644705e76794c0727004");
  assert.equal(receipt.current_main_source_pins.native_catalog_mjs, "02f628947be3e5c270d802be150ab220e14fc2b8");
  assert.equal(receipt.qualification.T3, "PASS_SCOPED_DIRECT_NATIVE_POS_NEG_ERR_REPLAY_ONLY");
  assert.equal(receipt.qualification.T4, "NOT_QUALIFIED_NODE_RUNNER_CLI_SDK_MCP_EXECUTION_NOT_PERFORMED");
  assert.equal(receipt.qualification.T5, "NOT_QUALIFIED_NO_BUSINESS_CASE_OR_INDEPENDENT_ORACLE");
});
