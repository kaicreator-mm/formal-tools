import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const builder = readFileSync("portable/builders/tools/minizinc.sh", "utf8");

test("MiniZincIDE 2.10.1 builder pins the exact official release asset", () => {
  assert.match(builder, /FT_UPSTREAM_URL="https:\/\/github\.com\/MiniZinc\/MiniZincIDE\/releases\/download\/2\.10\.1\/MiniZincIDE-2\.10\.1-x86_64-linux-gnu\.tgz"/);
  assert.match(builder, /FT_UPSTREAM_SHA256="b63dd88491d47b05d0eb0ff4aa1112d1e6f77292c023800b20b98851458ce01c"/);
  assert.match(builder, /FT_UPSTREAM_SIZE=80669849/);
});

test("fetched/cached upstream bytes are SHA256 and size checked before extraction", () => {
  const sha = builder.indexOf('actual_sha256=$(sha256sum "$tgz"');
  const size = builder.indexOf('actual_size=$(stat -c \'%s\' "$tgz")');
  const shaGuard = builder.indexOf('[ "$actual_sha256" = "$FT_UPSTREAM_SHA256" ] || ft::die');
  const sizeGuard = builder.indexOf('[ "$actual_size" = "$FT_UPSTREAM_SIZE" ] || ft::die');
  const extract = builder.indexOf('ft::extract "$tgz" /tmp/mznx');
  assert.ok(sha >= 0 && size >= 0 && shaGuard >= 0 && sizeGuard >= 0 && extract >= 0);
  assert.ok(sha < shaGuard && size < sizeGuard);
  assert.ok(shaGuard < extract && sizeGuard < extract);
});

test("MiniZinc upstream identity mismatches fail closed", () => {
  assert.match(builder, /ft::die "MiniZincIDE 2\.10\.1 upstream archive SHA256 mismatch:/);
  assert.match(builder, /ft::die "MiniZincIDE 2\.10\.1 upstream archive size mismatch:/);
  assert.match(builder, /ft::die "MiniZincIDE 2\.10\.1 upstream archive SHA256 could not be computed/);
  assert.match(builder, /ft::die "MiniZincIDE 2\.10\.1 upstream archive size could not be read/);
});
