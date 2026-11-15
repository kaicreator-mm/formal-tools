import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const expectPath = fileURLToPath(new URL("../portable/verification/cases/souffle/expect.sh", import.meta.url));
const contract = readFileSync(expectPath, "utf8");
const badTypes = readFileSync(new URL("../portable/verification/cases/souffle/badtypes.dl", import.meta.url), "utf8");

const uniqueExit = (source, name) => {
  const matches = [...source.matchAll(new RegExp("^" + name + "=([^\\r\\n]*)$", "gm"))];
  assert.equal(matches.length, 1, name + " must be assigned exactly once");
  const value = matches[0][1].replace(/^['"]|['"]$/g, "");
  assert.match(value, /^(?:0|[1-9][0-9]*)$/, name + " must be a fixed numeric exit code");
  return value;
};

test("Souffle portable fixture pins exactly one POS/NEG/ERR process exit", () => {
  assert.equal(uniqueExit(contract, "EXPECT_POS_EXIT"), "0");
  assert.equal(uniqueExit(contract, "EXPECT_NEG_EXIT"), "1");
  assert.equal(uniqueExit(contract, "EXPECT_ERR_EXIT"), "1");
  assert.match(contract, /EXPECT_POS_REGEX='a=1\.\*b=3\|path'/);
  assert.match(contract, /EXPECT_NEG_REGEX=/);
  assert.match(contract, /EXPECT_ERR_REGEX=/);
  assert.match(contract, /EXPECT_ERR_ARGS=.*does-not-exist\.dl/);
  assert.match(contract, /EXPECT_ERR_LABEL=MISSING_INPUT_REJECTED/);
});

test("duplicate, wildcard and missing exit assignments cannot be hidden after the first valid value", () => {
  assert.throws(() => uniqueExit(contract + "\nEXPECT_POS_EXIT=*\n", "EXPECT_POS_EXIT"));
  assert.throws(() => uniqueExit(contract + "\nEXPECT_NEG_EXIT=1\n", "EXPECT_NEG_EXIT"));
  assert.throws(() => uniqueExit(contract.replace(/^EXPECT_ERR_EXIT=1\n/m, ""), "EXPECT_ERR_EXIT"));
  assert.throws(() => uniqueExit(contract.replace(/^EXPECT_ERR_EXIT=1$/m, "EXPECT_ERR_EXIT=*"), "EXPECT_ERR_EXIT"));
});

test("Bash-sourced effective exit values are exactly POS=0 NEG=1 ERR=1", () => {
  const script = 'set -eu; source "$1"; printf "%s\\n" "$EXPECT_POS_EXIT" "$EXPECT_NEG_EXIT" "$EXPECT_ERR_EXIT"';
  const result = spawnSync("bash", ["-c", script, "bash", expectPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.stdout.trim().split(/\\r?\\n/), ["0", "1", "1"]);
});

test("the NEG fixture is genuinely invalid input, not a valid-but-false model result", () => {
  assert.match(badTypes, /path\(1,notanumber\)/);
});
