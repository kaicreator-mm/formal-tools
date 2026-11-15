import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

test("the exact EXPECT_NEG_ARGS path is the fixture whose bytes the test inspects", () => {
  const negativePath = uniqueValue(contract, "EXPECT_NEG_ARGS");
  assert.equal(negativePath, "tests/souffle/badtypes.dl");
  const negativeBytes = readFileSync(new URL("../" + negativePath, import.meta.url), "utf8");
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
