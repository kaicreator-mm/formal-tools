import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const builder = readFileSync("portable/builders/tools/vampire.sh", "utf8");
const contract = readFileSync("portable/verification/cases/vampire/expect.sh", "utf8");
const field = name => {
  const match = contract.match(new RegExp("^" + name + "=(.*)$", "m"));
  assert.ok(match, name + " must be declared");
  return match[1].replace(/^['"]|['"]$/g, "");
};

test("Vampire 5.1.0 builder pins the official Linux X64 release asset", () => {
  assert.match(builder, /^FT_TOOL_VERSION=5\.1\.0$/m);
  assert.match(builder, /^FT_UPSTREAM_URL="https:\/\/github\.com\/vprover\/vampire\/releases\/download\/v5\.1\.0\/vampire-Linux-X64\.zip"$/m);
  assert.match(builder, /^FT_UPSTREAM_SHA256="495828dc76cb17a27080d62dedce755e46de96f47f06f5f0ad4be9cdaf6f968f"$/m);
  assert.match(builder, /^FT_UPSTREAM_SIZE_BYTES=21664799$/m);
  assert.match(builder, /zip=\$\(ft::fetch "\$FT_UPSTREAM_URL" "\$FT_UPSTREAM_SHA256"\)/);
  // The per-tool check is intentional: the shared cache helper returns a .ok
  // hit before checking a newly supplied expected SHA256.
  assert.match(builder, /got=\$\(sha256sum "\$zip" \| cut -d' ' -f1\)/);
  assert.match(builder, /\[ "\$got" = "\$FT_UPSTREAM_SHA256" \] \|\| ft::die/);
  assert.match(builder, /size=\$\(wc -c < "\$zip" \| tr -d '[:space:]'\)/);
  assert.match(builder, /\[ "\$size" = "\$FT_UPSTREAM_SIZE_BYTES" \] \|\| ft::die/);
});

test("Vampire POS/NEG/ERR fixture contract pins historical exit codes and typed markers", () => {
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_NEG_EXIT"), "0");
  assert.equal(field("EXPECT_ERR_EXIT"), "4");
  assert.equal(field("EXPECT_POS_REGEX"), "Refutation found");
  assert.equal(field("EXPECT_NEG_REGEX"), "Termination reason: Saturation");
  assert.equal(field("EXPECT_ERR_REGEX"), "parse error in");
  assert.equal(field("EXPECT_NEG_LABEL"), "NOT_PROVED");
  assert.equal(field("EXPECT_ERR_LABEL"), "ERROR");
  assert.doesNotMatch(contract, /^EXPECT_(?:NEG|ERR)_EXIT=['"]?\*['"]?$/m);
  const malformed = readFileSync("portable/verification/cases/vampire/err.p", "utf8");
  assert.ok((malformed.match(/\(/g) || []).length > (malformed.match(/\)/g) || []).length);
});
