import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("../portable/verification/cases/fast-downward/expect.sh", import.meta.url));
const contract = readFileSync(contractPath, "utf8");
const malformed = readFileSync("portable/verification/cases/fast-downward/err.pddl", "utf8");

// Bash uses the last assignment, so a first-match regex is insufficient.
// Require one numeric assignment per phase before checking its effective value.
const uniqueExit = (source, name) => {
  const matches = [...source.matchAll(new RegExp("^" + name + "=([^\\r\\n]*)$", "gm"))];
  assert.equal(matches.length, 1, name + " must be assigned exactly once");
  const value = matches[0][1].replace(/^['"]|['"]$/g, "");
  assert.match(value, /^(?:0|[1-9][0-9]*)$/, name + " must be a fixed numeric exit code");
  return value;
};

test("Fast Downward portable fixture pins exactly one POS, NEG and malformed-PDDL ERR exit code", () => {
  assert.match(uniqueExit(contract, "EXPECT_POS_EXIT"), /^0$/);
  assert.match(uniqueExit(contract, "EXPECT_NEG_EXIT"), /^11$/);
  assert.match(uniqueExit(contract, "EXPECT_ERR_EXIT"), /^31$/);
  assert.match(contract, /EXPECT_POS_REGEX='Solution found'/);
  assert.match(contract, /EXPECT_NEG_REGEX='([Uu]nsolvable|no solution|Completely explored)'/);
  assert.match(contract, /EXPECT_ERR_REGEX='Could not parse problem file'/);
  assert.match(contract, /EXPECT_ERR_LABEL=INVALID_PDDL_REJECTED/);
  const opens=(malformed.match(/\(/g)||[]).length;
  const closes=(malformed.match(/\)/g)||[]).length;
  assert.ok(opens>closes,"ERR input must remain syntactically malformed");
});

test("duplicate, wildcard and missing exit assignments are rejected even when Bash's last assignment differs", () => {
  assert.throws(() => uniqueExit(contract + "\nEXPECT_POS_EXIT=*\n", "EXPECT_POS_EXIT"));
  assert.throws(() => uniqueExit(contract + "\nEXPECT_NEG_EXIT=11\n", "EXPECT_NEG_EXIT"));
  assert.throws(() => uniqueExit(contract.replace(/^EXPECT_ERR_EXIT=31\n/m, ""), "EXPECT_ERR_EXIT"));
  assert.throws(() => uniqueExit(contract.replace(/^EXPECT_ERR_EXIT=31$/m, "EXPECT_ERR_EXIT=*"), "EXPECT_ERR_EXIT"));
});

test("the effective values after Bash sources the contract are exactly 0/11/31", () => {
  const script = 'set -eu; source "$1"; printf "%s\\n" "$EXPECT_POS_EXIT" "$EXPECT_NEG_EXIT" "$EXPECT_ERR_EXIT"';
  const result = spawnSync("bash", ["-c", script, "bash", contractPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ["0", "11", "31"]);
});
