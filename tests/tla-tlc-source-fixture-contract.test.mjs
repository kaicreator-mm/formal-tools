import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const builder = readFileSync("portable/builders/tools/tla-tlc.sh", "utf8");
const contract = readFileSync("portable/verification/cases/tla-tlc/expect.sh", "utf8");
const field = name => {
  const match = contract.match(new RegExp("^" + name + "=(.*)$", "m"));
  assert.ok(match, name + " must be declared");
  return match[1].replace(/^['"]|['"]$/g, "");
};

test("TLA+ TLC 1.8.0 builder pins the official tla2tools.jar asset", () => {
  assert.match(builder, /^FT_TOOL_VERSION=1\.8\.0$/m);
  assert.match(builder, /^FT_UPSTREAM_URL="https:\/\/github\.com\/tlaplus\/tlaplus\/releases\/download\/v1\.8\.0\/tla2tools\.jar"$/m);
  assert.match(builder, /^FT_UPSTREAM_SHA256="7e53aa636dac8a3cb0533f343115c0548e03fc0ce5edc7739becf58d3d0fb84f"$/m);
  assert.match(builder, /^FT_UPSTREAM_SIZE_BYTES=4510884$/m);
  assert.match(builder, /zip=\$\(ft::fetch|jar=\$\(ft::fetch/);
  assert.match(builder, /jar=\$\(ft::fetch "\$FT_UPSTREAM_URL" "\$FT_UPSTREAM_SHA256"\)/);
  assert.match(builder, /got=\$\(sha256sum "\$jar" \| cut -d' ' -f1\)/);
  assert.match(builder, /\[ "\$got" = "\$FT_UPSTREAM_SHA256" \] \|\| ft::die/);
  assert.match(builder, /size=\$\(wc -c < "\$jar" \| tr -d '[:space:]'\)/);
  assert.match(builder, /\[ "\$size" = "\$FT_UPSTREAM_SIZE_BYTES" \] \|\| ft::die/);
  assert.match(builder, /FT_PROBE=\(\.\.\/\.\.\/runtimes\/java21\/bin\/java -cp tla2tools\.jar tlc2\.TLC -help\)/);
  assert.doesNotMatch(builder, /ft::gh_url .* latest|tlc2\.TLC -version/);
});

test("TLA+ TLC POS/NEG fixture contract pins observed process exits", () => {
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_NEG_EXIT"), "12");
  assert.equal(field("EXPECT_POS_LABEL"), "PROPERTY_HOLDS");
  assert.equal(field("EXPECT_NEG_LABEL"), "COUNTEREXAMPLE");
  assert.match(field("EXPECT_NEG_REGEX"), /Invariant BadInv is violated/);
  assert.doesNotMatch(contract, /^EXPECT_NEG_EXIT=['"]?\*['"]?$/m);
});
