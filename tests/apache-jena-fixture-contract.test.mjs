import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = readFileSync("portable/verification/cases/apache-jena/expect.sh", "utf8");
const field = (name) => {
  const match = contract.match(new RegExp("^" + name + "=(.*)$", "m"));
  assert.ok(match, name + " must be declared");
  return match[1].replace(/^['\"]|['\"]$/g, "");
};

test("Apache Jena POS/NEG/ERR fixture contract pins exact native exit codes", () => {
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_NEG_EXIT"), "1");
  assert.equal(field("EXPECT_ERR_EXIT"), "2");
  assert.equal(field("EXPECT_POS_LABEL"), "RDF_VALID");
  assert.equal(field("EXPECT_NEG_LABEL"), "RDF_INVALID");
  assert.equal(field("EXPECT_ERR_LABEL"), "ERROR");
  assert.match(field("EXPECT_POS_ARGS"), /--validate tests\/apache-jena\/pos\.ttl/);
  assert.match(field("EXPECT_NEG_ARGS"), /--validate tests\/apache-jena\/neg\.ttl/);
  assert.match(field("EXPECT_ERR_ARGS"), /--validate tests\/apache-jena\/does-not-exist\.ttl/);
  assert.doesNotMatch(contract, /^EXPECT_(?:POS|NEG|ERR)_EXIT=['\"]?\*['\"]?$/m);
});
