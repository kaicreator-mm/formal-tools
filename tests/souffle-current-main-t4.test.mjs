import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const expectPath = fileURLToPath(new URL("../portable/verification/cases/souffle/expect.sh", import.meta.url));
const contract = readFileSync(expectPath, "utf8");
const assignmentLines = (source, name) => source.split(/\r?\n/)
  .map(line => line.trimStart())
  .filter(line => !line.startsWith("#"))
  .map(line => line.replace(/^export\s+/, ""))
  .filter(line => line.startsWith(name + "="));
const uniqueValue = (source, name) => {
  const matches = assignmentLines(source, name);
  assert.equal(matches.length, 1, name + " must be assigned exactly once");
  return matches[0].slice(name.length + 1).replace(/^['"]|['"]$/g, "");
};
const uniqueExit = (source, name) => {
  const value = uniqueValue(source, name);
  assert.match(value, /^(?:0|[1-9][0-9]*)$/, name + " must be a fixed numeric exit code");
  return value;
};

test("Souffle fixture pins exact numeric POS/NEG/ERR exits and source-backed patterns", () => {
  assert.equal(uniqueExit(contract, "EXPECT_POS_EXIT"), "0");
  assert.equal(uniqueExit(contract, "EXPECT_NEG_EXIT"), "1");
  assert.equal(uniqueExit(contract, "EXPECT_ERR_EXIT"), "1");
  assert.equal(uniqueValue(contract, "EXPECT_POS_REGEX"), "^1[[:space:]]+3$");
  assert.equal(uniqueValue(contract, "EXPECT_NEG_REGEX"), "^Error: Undefined relation path in file badtypes\\.dl at line 4$");
  assert.equal(uniqueValue(contract, "EXPECT_ERR_REGEX"), "^cannot open file tests/souffle/does-not-exist\\.dl$");
});

test("the exact EXPECT_NEG_ARGS path maps to the committed source fixture copied by pack.sh", () => {
  const negativeBundlePath = uniqueValue(contract, "EXPECT_NEG_ARGS");
  assert.equal(negativeBundlePath, "tests/souffle/badtypes.dl");
  const sourceFixturePath = new URL("../portable/verification/cases/souffle/badtypes.dl", import.meta.url);
  const packScriptPath = new URL("../portable/packaging/pack.sh", import.meta.url);
  const negativeBytes = readFileSync(sourceFixturePath, "utf8");
  const packScript = readFileSync(packScriptPath, "utf8");
  assert.ok(packScript.includes('cp -a "$HERE/../verification/cases/." "$B/tests/"'),
    "pack.sh must copy the committed verification/cases tree into the bundle tests/ root");
  assert.match(negativeBytes, /path\(1,notanumber\)\./);
  assert.match(contract, /EXPECT_NEG_LABEL=INVALID_REJECTED/);
});

test("generic and unrelated outputs do not satisfy the source-backed native patterns", () => {
  const pos = readFileSync(new URL("../docs/tool-portfolio/r27/raw/pos.stdout", import.meta.url), "utf8");
  const neg = readFileSync(new URL("../docs/tool-portfolio/r27/raw/neg.stderr", import.meta.url), "utf8");
  const err = readFileSync(new URL("../docs/tool-portfolio/r27/raw/err.stderr", import.meta.url), "utf8");
  const grepMatch = (pattern, input) => spawnSync("grep", ["-E", "-q", pattern], { input, encoding: "utf8" }).status === 0;
  assert.equal(grepMatch(uniqueValue(contract, "EXPECT_POS_REGEX"), pos), true);
  assert.equal(grepMatch(uniqueValue(contract, "EXPECT_NEG_REGEX"), neg), true);
  assert.equal(grepMatch(uniqueValue(contract, "EXPECT_ERR_REGEX"), err), true);
  assert.equal(grepMatch(uniqueValue(contract, "EXPECT_POS_REGEX"), "path: generic output"), false);
  assert.equal(grepMatch(uniqueValue(contract, "EXPECT_NEG_REGEX"), "Error: unrelated timeout"), false);
});

test("duplicate, wildcard, missing, leading-space and export overrides are rejected", () => {
  assert.throws(() => uniqueExit(contract + "\nEXPECT_POS_EXIT=2\n", "EXPECT_POS_EXIT"));
  assert.throws(() => uniqueExit(contract + "\nEXPECT_NEG_EXIT=*\n", "EXPECT_NEG_EXIT"));
  assert.throws(() => uniqueExit(contract.replace(/^EXPECT_ERR_EXIT=1\n/m, ""), "EXPECT_ERR_EXIT"));
  assert.throws(() => uniqueExit(contract + "\n EXPECT_NEG_EXIT=77\n", "EXPECT_NEG_EXIT"));
  assert.throws(() => uniqueExit(contract + "\nexport EXPECT_NEG_EXIT=77\n", "EXPECT_NEG_EXIT"));
});

test("Bash-sourced effective exit values are exactly POS=0 NEG=1 ERR=1", () => {
  const script = 'set -eu; source "$1"; printf "%s\\n" "$EXPECT_POS_EXIT" "$EXPECT_NEG_EXIT" "$EXPECT_ERR_EXIT"';
  const result = spawnSync("bash", ["-c", script, "bash", expectPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ["0", "1", "1"]);
});

test("the raw SHA256SUMS manifest has exactly 14 entries and every entry matches the committed raw bytes", () => {
  const rawDir = new URL("../docs/tool-portfolio/r27/raw/", import.meta.url);
  const manifestText = readFileSync(new URL("SHA256SUMS", rawDir), "utf8");
  const lines = manifestText.split("\n").filter(line => line.length > 0);
  assert.equal(lines.length, 14, "SHA256SUMS must list exactly 14 entries");
  const expectedNames = [
    "pos.stdout", "pos.stderr", "pos.exit",
    "neg.stdout", "neg.stderr", "neg.exit",
    "err.stdout", "err.stderr", "err.exit",
    "version.stdout", "version.stderr", "version.exit",
    "receipt.json", "archive-members.json",
  ];
  const entries = lines.map(line => {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    assert.ok(match, `manifest line must match '<sha256>  <name>': ${line}`);
    return { sha256: match[1], name: match[2] };
  });
  assert.deepEqual(entries.map(entry => entry.name).sort(), expectedNames.slice().sort());
  const sha256Of = bytes => createHash("sha256").update(bytes).digest("hex");
  for (const entry of entries) {
    const actual = sha256Of(readFileSync(new URL(entry.name, rawDir)));
    assert.equal(actual, entry.sha256, `SHA256SUMS entry for ${entry.name} must match the committed raw bytes`);
  }
  const receipt = JSON.parse(readFileSync(new URL("../docs/tool-portfolio/r23/SOUFFLE_CURRENT_MAIN_T4.json", import.meta.url), "utf8"));
  assert.equal(receipt.native_shim_replay.raw_file_count, 14);
  assert.equal(receipt.native_shim_replay.raw_checksum_manifest_entries, 14);
});
