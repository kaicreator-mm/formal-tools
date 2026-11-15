import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = readFileSync("portable/verification/cases/apache-jena/expect.sh", "utf8");
const field = (name, source = contract) => {
  const lines = source.split(/\r?\n/).filter((line) => line.startsWith(name + "="));
  assert.equal(lines.length, 1, name + " must be assigned exactly once");
  return lines[0].slice(name.length + 1).replace(/^['"]|['"]$/g, "");
};

test("Apache Jena POS/NEG/ERR fixture contract pins exact native exit codes", () => {
  for (const name of [
    "EXPECT_TIMEOUT",
    "EXPECT_POS_ARGS", "EXPECT_POS_EXIT", "EXPECT_POS_REGEX", "EXPECT_POS_LABEL",
    "EXPECT_NEG_ARGS", "EXPECT_NEG_EXIT", "EXPECT_NEG_REGEX", "EXPECT_NEG_LABEL",
    "EXPECT_ERR_ARGS", "EXPECT_ERR_EXIT", "EXPECT_ERR_REGEX", "EXPECT_ERR_LABEL",
  ]) field(name);
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_NEG_EXIT"), "1");
  assert.equal(field("EXPECT_ERR_EXIT"), "2");
  assert.equal(field("EXPECT_POS_LABEL"), "RDF_VALID");
  assert.equal(field("EXPECT_NEG_LABEL"), "RDF_INVALID");
  assert.equal(field("EXPECT_ERR_LABEL"), "ERROR");
  assert.match(field("EXPECT_POS_ARGS"), /--validate tests\/apache-jena\/pos\.ttl/);
  assert.match(field("EXPECT_NEG_ARGS"), /--validate tests\/apache-jena\/neg\.ttl/);
  assert.match(field("EXPECT_ERR_ARGS"), /--validate tests\/apache-jena\/does-not-exist\.ttl/);
  assert.doesNotMatch(contract, /^EXPECT_(?:POS|NEG|ERR)_EXIT=['"]?\*['"]?$/m);
});

test("Apache Jena fixture contract rejects duplicate exit-code overrides", () => {
  const duplicate = contract + "\nEXPECT_NEG_EXIT=77\n";
  assert.throws(() => field("EXPECT_NEG_EXIT", duplicate), /assigned exactly once/);
});
