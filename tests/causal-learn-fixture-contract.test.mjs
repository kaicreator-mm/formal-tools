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

test("causal-learn T3 POS/NEG/ERR fixtures are distinct and correctly classified", () => {
  assert.match(expect, /EXPECT_POS_ARGS='tests\/causal-learn\/pos\.py'/);
  assert.match(expect, /EXPECT_NEG_ARGS='tests\/causal-learn\/neg\.py'/);
  assert.match(expect, /EXPECT_ERR_ARGS='tests\/causal-learn\/err\.py'/);
  assert.match(expect, /EXPECT_POS_REGEX='PYVERIFY: OK PC_CHAIN'/);
  assert.match(expect, /EXPECT_NEG_REGEX='PYVERIFY: OK INDEPENDENT_GAUSSIAN_NO_EDGE'/);
  assert.match(expect, /EXPECT_ERR_REGEX='PYVERIFY: OK INVALID_INPUT_REJECTED'/);

  assert.match(pos, /marginally dependent/);
  assert.match(pos, /conditionally independent given Y/);
  assert.match(pos, /np\.corrcoef/);
  assert.match(neg, /np\.random\.default_rng\(19\)/);
  assert.match(neg, /np\.random\.default_rng\(23\)/);
  assert.match(neg, /p_value > 0\.05/);
  assert.match(neg, /INDEPENDENT_GAUSSIAN_NO_EDGE/);
  assert.doesNotMatch(neg, /np\.linalg\.qr|ragged|expected exception|except Exception/);

  assert.match(err, /np\.array\(\[\[1\.0, 2\.0\], \[3\.0\]\]\)/);
  assert.match(err, /except \(ValueError, TypeError\)/);
  assert.match(err, /INVALID_INPUT_REJECTED/);
  assert.notEqual(neg, err);
});
