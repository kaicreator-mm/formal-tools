import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const embed = read("portable/packaging/embed-pylib.sh");
const builder = read("portable/builders/tools/ortools.sh");
const expect = read("portable/verification/cases/ortools/expect.sh");
const err = read("portable/verification/cases/ortools/err.py");

test("OR-Tools private wheel libraries are embedded and loaded by the tool shim", () => {
  assert.match(embed, /if tid == "ortools"/);
  assert.match(embed, /SITE, "ortools\.libs"/);
  assert.match(embed, /shutil\.copytree\(libs_src, libs_dst, symlinks=True\)/);
  assert.match(embed, /embedded OR-Tools CP-SAT import failed/);
  assert.match(builder, /LD_LIBRARY_PATH=.*ortools\.libs/);
  assert.match(builder, /TOOL_DIR\/pylib\/ortools\/\.libs/);

  assert.match(expect, /EXPECT_POS_VIA=run/);
  assert.match(expect, /EXPECT_NEG_VIA=run/);
  assert.match(expect, /EXPECT_ERR_VIA=run/);
  assert.doesNotMatch(expect, /EXPECT_(POS|NEG|ERR)_VIA=py/);

  assert.match(err, /new_int_var\(3, 2, "invalid_domain"\)/);
  assert.match(err, /cp_model\.MODEL_INVALID/);
  assert.match(err, /m2\.add\("not a constraint"\)/);
  assert.match(err, /except TypeError/);
  assert.match(err, /MODEL_INVALID_AND_TYPE_REJECTED/);
});
