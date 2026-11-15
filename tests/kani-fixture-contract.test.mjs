import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = readFileSync("portable/verification/cases/kani/expect.sh", "utf8");

function field(name) {
  const matches = [...contract.matchAll(new RegExp("^" + name + "=(.*)$", "gm"))];
  assert.equal(matches.length, 1, name + " must be declared exactly once");
  return matches[0][1].replace(/^['"]|['"]$/g, "");
}

test("Kani POS/NEG fixture contract pins exact exit codes and typed outcomes", () => {
  assert.match(field("EXPECT_POS_ARGS"), /\$BUNDLE\/tests\/kani\/pos\b/);
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_POS_REGEX"), "VERIFICATION:- SUCCESSFUL");
  assert.equal(field("EXPECT_POS_LABEL"), "VERIFIED");

  assert.match(field("EXPECT_NEG_ARGS"), /\$BUNDLE\/tests\/kani\/neg\b/);
  assert.equal(field("EXPECT_NEG_EXIT"), "1");
  assert.equal(field("EXPECT_NEG_REGEX"), "VERIFICATION:- FAILED");
  assert.equal(field("EXPECT_NEG_LABEL"), "VIOLATION");

  assert.doesNotMatch(contract, /^EXPECT_(?:POS|NEG)_EXIT=['"]?\*['"]?$/m);
});
