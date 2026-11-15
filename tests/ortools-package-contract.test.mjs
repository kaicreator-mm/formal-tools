import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const embed = read("portable/packaging/embed-pylib.sh");
const builder = read("portable/builders/tools/ortools.sh");
const expect = read("portable/verification/cases/ortools/expect.sh");
const err = read("portable/verification/cases/ortools/err.py");

test("OR-Tools private wheel libraries are embedded and loaded by the tool shim", () => {
  assert.ok(embed.includes('if tid == "ortools"'));
  assert.ok(embed.includes('SITE, "ortools.libs"'));
  assert.ok(embed.includes("shutil.copytree(libs_src, libs_dst, symlinks=True)"));
  assert.ok(embed.includes("embedded OR-Tools CP-SAT import failed"));
  assert.ok(builder.includes('LD_LIBRARY_PATH="$TOOL_DIR/pylib/ortools.libs'));
  assert.ok(builder.includes("$TOOL_DIR/pylib/ortools/.libs"));

  assert.ok(expect.includes("EXPECT_POS_VIA=run"));
  assert.ok(expect.includes("EXPECT_NEG_VIA=run"));
  assert.ok(expect.includes("EXPECT_ERR_VIA=run"));
  assert.ok(!/EXPECT_(POS|NEG|ERR)_VIA=py/.test(expect));

  assert.ok(err.includes('new_int_var(3, 2, "invalid_domain")'));
  assert.ok(err.includes("cp_model.MODEL_INVALID"));
  assert.ok(err.includes('m2.add("not a constraint")'));
  assert.ok(err.includes("except TypeError"));
  assert.ok(err.includes("MODEL_INVALID_AND_TYPE_REJECTED"));
});
