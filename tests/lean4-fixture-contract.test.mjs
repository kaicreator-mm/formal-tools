import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = "portable/verification/cases/lean4/";
const contract = readFileSync(root + "expect.sh", "utf8");
const field = name => {
  const match = contract.match(new RegExp("^" + name + "=(.*)$", "m"));
  assert.ok(match, name + " must be declared");
  return match[1].replace(/^['"]|['"]$/g, "");
};

test("Lean4 POS/NEG/ERR contract pins exact observed exit codes and typed outcomes", () => {
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_NEG_EXIT"), "1");
  assert.equal(field("EXPECT_ERR_EXIT"), "1");
  assert.equal(field("EXPECT_POS_REGEX"), "PHASE_DONE.*rc=0");
  assert.equal(field("EXPECT_NEG_REGEX"), "error: Type mismatch");
  assert.equal(field("EXPECT_ERR_REGEX"), "Unknown identifier `no_such_tactic`");
  assert.doesNotMatch(contract, /^EXPECT_(?:NEG|ERR)_EXIT=['"]?\*['"]?$/m);
});

test("Lean4 fixtures remain distinct proof, counterexample and invalid-identifier inputs", () => {
  assert.match(readFileSync(root + "pos.lean", "utf8"), /1 \+ 1 = 2 := rfl/);
  assert.match(readFileSync(root + "neg.lean", "utf8"), /1 \+ 1 = 3 := rfl/);
  assert.match(readFileSync(root + "err.lean", "utf8"), /no_such_tactic/);
});
