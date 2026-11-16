import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("portable/verification/cases/causal-learn");
const read = (name) => readFileSync(resolve(root, name), "utf8");
const expect = read("expect.sh");
const pos = read("pos.py");
const neg = read("neg.py");
const err = read("err.py");

function field(name) {
  const matches = [...expect.matchAll(new RegExp("^" + name + "=(.*)$", "gm"))];
  assert.equal(matches.length, 1, name + " must be declared exactly once");
  return matches[0][1].replace(/^['"]|['"]$/g, "");
}

test("causal-learn T3 POS/NEG/ERR fixtures pin exact exits and distinct outcomes", () => {
  assert.match(field("EXPECT_POS_ARGS"), /tests\/causal-learn\/pos\.py/);
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_POS_REGEX"), "PYVERIFY: OK PC_CHAIN");

  assert.match(field("EXPECT_NEG_ARGS"), /tests\/causal-learn\/neg\.py/);
  assert.equal(field("EXPECT_NEG_EXIT"), "0");
  assert.equal(field("EXPECT_NEG_REGEX"), "PYVERIFY: OK INDEPENDENT_GAUSSIAN_NO_EDGE");

  assert.match(field("EXPECT_ERR_ARGS"), /tests\/causal-learn\/err\.py/);
  assert.equal(field("EXPECT_ERR_EXIT"), "0");
  assert.equal(field("EXPECT_ERR_REGEX"), "PYVERIFY: OK INVALID_INPUT_REJECTED");
  assert.doesNotMatch(expect, /^EXPECT_(?:POS|NEG|ERR)_EXIT=['"]?\*['"]?$/m);

  assert.match(pos, /marginally dependent/);
  assert.match(pos, /conditionally independent given Y/);
  assert.match(pos, /np\.corrcoef/);
  assert.match(neg, /np\.random\.default_rng\(19\)/);
  assert.match(neg, /np\.random\.default_rng\(23\)/);
  assert.match(neg, /p_value > 0\.05/);
  assert.match(neg, /INDEPENDENT_GAUSSIAN_NO_EDGE/);
  assert.doesNotMatch(neg, /np\.linalg\.qr|ragged|expected exception|except Exception/);

  assert.match(err, /invoke_pc\(np\.empty\(\(0, 2\), dtype=np\.float64\)\)/);
  assert.match(err, /from causallearn\.search\.ConstraintBased\.PC import pc/);
  assert.match(err, /pc_invoked = True/);
  assert.match(err, /assert pc_invoked/);
  const invokeBody = err.match(/def invoke_pc\(data\):([\s\S]*?)\n\ntry:/);
  assert.ok(invokeBody, "ERR fixture must define the package-call wrapper");
  assert.match(invokeBody[1], /return pc\(data, alpha=0\.05, indep_test="fisherz"\)/);
  assert.match(err, /except ValueError as exc/);
  assert.match(err, /INVALID_INPUT_REJECTED/);
  assert.doesNotMatch(err, /np\.array\(\[\[1\.0, 2\.0\], \[3\.0\]\]\)/);
  assert.notEqual(neg, err);
});
