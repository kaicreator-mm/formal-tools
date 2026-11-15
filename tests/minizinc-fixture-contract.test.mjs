import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = readFileSync("portable/verification/cases/minizinc/expect.sh", "utf8");

function field(name) {
  const matches = [...contract.matchAll(new RegExp("^" + name + "=(.*)$", "gm"))];
  assert.equal(matches.length, 1, name + " must be declared exactly once");
  return matches[0][1].replace(/^['"]|['"]$/g, "");
}

test("MiniZinc POS/NEG/ERR fixture contract pins exact exits and outcomes", () => {
  assert.match(field("EXPECT_POS_ARGS"), /tests\/minizinc\/pos\.mzn --solver Chuffed/);
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_POS_REGEX"), "x = [0-9]+");
  assert.equal(field("EXPECT_POS_LABEL"), "SATISFIED");

  assert.match(field("EXPECT_NEG_ARGS"), /tests\/minizinc\/neg\.mzn --solver Chuffed/);
  assert.equal(field("EXPECT_NEG_EXIT"), "0");
  assert.equal(field("EXPECT_NEG_REGEX"), "=====UNSATISFIABLE=====");
  assert.equal(field("EXPECT_NEG_LABEL"), "UNSATISFIABLE");

  assert.match(field("EXPECT_ERR_ARGS"), /tests\/minizinc\/err\.mzn/);
  assert.equal(field("EXPECT_ERR_EXIT"), "1");
  assert.equal(field("EXPECT_ERR_REGEX"), "(Error|error|undefined|not defined)");
  assert.equal(field("EXPECT_ERR_LABEL"), "ERROR");

  assert.doesNotMatch(contract, /^EXPECT_(?:POS|NEG|ERR)_EXIT=['"]?\*['"]?$/m);
});
