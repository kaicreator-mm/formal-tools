import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = readFileSync(new URL("../portable/verification/cases/robot/expect.sh", import.meta.url), "utf8");

test("Robot POS requires a generated reasoning artifact", () => {
  assert.match(contract, /^EXPECT_POS_VIA=sh$/m);
  assert.match(contract, /test -s "\$FT_TMP\/reasoned\.ttl"/);
  assert.match(contract, /grep -q "ex:alice"/);
  assert.match(contract, /^EXPECT_POS_EXIT=0$/m);
  assert.match(contract, /EXPECT_POS_REGEX='ROBOT_REASONED_OUTPUT_OK'/);
});

test("Robot NEG and ERR pin their observed native exit codes and typed outcomes", () => {
  assert.match(contract, /^EXPECT_NEG_EXIT=1$/m);
  assert.match(contract, /EXPECT_NEG_REGEX='The ontology is inconsistent'/);
  assert.match(contract, /^EXPECT_ERR_EXIT=1$/m);
  assert.match(contract, /EXPECT_ERR_REGEX='INVALID ONTOLOGY FILE ERROR'/);
  assert.doesNotMatch(contract, /^EXPECT_(?:NEG|ERR)_EXIT=\*$/m);
});
