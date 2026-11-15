import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = readFileSync("portable/verification/cases/apache-jena/expect.sh", "utf8");
const negativeFixture = readFileSync("portable/verification/cases/apache-jena/neg.ttl", "utf8");
const field = (name, source = contract) => {
  const lines = source.split(/\r?\n/)
    .map((line) => line.trim().replace(/^export\s+/, ""))
    .filter((line) => line.startsWith(name + "="));
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
  assert.equal(field("EXPECT_NEG_LABEL"), "MALFORMED_RDF_SYNTAX_REJECTED");
  assert.equal(field("EXPECT_ERR_LABEL"), "ERROR");
  assert.equal(field("EXPECT_NEG_REGEX"), "Triples not terminated properly in \\[\\]-list");
  assert.match(field("EXPECT_POS_ARGS"), /--validate tests\/apache-jena\/pos\.ttl/);
  assert.match(field("EXPECT_NEG_ARGS"), /--validate tests\/apache-jena\/neg\.ttl/);
  assert.match(field("EXPECT_ERR_ARGS"), /--validate tests\/apache-jena\/does-not-exist\.ttl/);
});

test("Apache Jena fixture contract rejects duplicate, whitespace, and export exit-code overrides", () => {
  const overrides = [
    "EXPECT_NEG_EXIT=77",
    " EXPECT_NEG_EXIT=77",
    "\tEXPECT_NEG_EXIT=77",
    " export EXPECT_NEG_EXIT=77",
    "\t export EXPECT_NEG_EXIT=77",
  ];
  for (const override of overrides) {
    assert.throws(() => field("EXPECT_NEG_EXIT", contract + "\n" + override + "\n"), /assigned exactly once/);
  }
});

test("Apache Jena NEG fixture reaches malformed RDF syntax, not an undeclared-prefix error", () => {
  assert.match(negativeFixture, /^@prefix rdfs: <http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#> \.$/m);
  assert.match(negativeFixture, /rdfs:label \[ "unclosed"$/m);
  assert.doesNotMatch(negativeFixture, /Undefined prefix: rdfs/);
  assert.equal(field("EXPECT_NEG_REGEX"), "Triples not terminated properly in \\[\\]-list");
});
