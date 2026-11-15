import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = readFileSync(new URL("../portable/verification/cases/robot/expect.sh", import.meta.url), "utf8");

function uniqueNumericExitAssignments(source) {
  const values = {};
  for (const phase of ["POS", "NEG", "ERR"]) {
    const lines = source.split(/\r?\n/).filter(line => line.startsWith("EXPECT_" + phase + "_EXIT="));
    assert.equal(lines.length, 1, phase + " must have exactly one numeric exit assignment");
    const match = lines[0].match(new RegExp("^EXPECT_" + phase + "_EXIT=([0-9]+)$"));
    assert.ok(match, phase + " exit assignment must be numeric and unquoted");
    values[phase] = Number(match[1]);
  }
  return values;
}

test("Robot fixture pins exactly one numeric POS/NEG/ERR exit assignment", () => {
  assert.deepEqual(uniqueNumericExitAssignments(contract), { POS: 0, NEG: 1, ERR: 1 });
});

test("Robot exit parser rejects duplicate, wildcard, missing and quoted assignments", () => {
  const negativeControls = [
    { label: "duplicate", source: contract + "\nEXPECT_NEG_EXIT=2\n" },
    { label: "wildcard", source: contract.replace(/^EXPECT_NEG_EXIT=1$/m, "EXPECT_NEG_EXIT=*\n") },
    { label: "missing", source: contract.replace(/^EXPECT_ERR_EXIT=1$/m, "") },
    { label: "quoted", source: contract.replace(/^EXPECT_POS_EXIT=0$/m, "EXPECT_POS_EXIT='0'") }
  ];
  for (const control of negativeControls) {
    assert.throws(() => uniqueNumericExitAssignments(control.source), control.label);
  }
});

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
