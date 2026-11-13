import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(
  new URL("../docs/tool-portfolio/r3/APP_CANONICAL_CATALOG.json", import.meta.url),
  "utf8"
));

test("App source file IDs and duplicate-file IDs are disjoint", () => {
  assert.equal(catalog.schema, "formal-tools/app-canonical-asset-catalog/v3");
  const source = [
    ...catalog.canonical.native,
    ...catalog.canonical.runtimes,
    ...catalog.canonical.python_wheelhouses,
    ...catalog.canonical.portable_top_level
  ];
  const known = new Set(source.map(x => x.id));
  assert.equal(source.length, known.size);
  const copies = catalog.duplicate_cleanup.candidates;
  assert.equal(copies.length, 33);
  assert.equal(new Set(copies.map(x => x.copy_id)).size, copies.length);
  assert.equal(new Set(copies.map(x => x.canonical_id)).size, copies.length);
  for (const x of copies) {
    assert.ok(known.has(x.canonical_id), x.copy_title);
    assert.ok(!known.has(x.copy_id), x.copy_title);
    assert.ok(x.size_bytes > 0, x.copy_title);
    assert.equal(x.disposition, "ELIMINATE_REDUNDANT_COPY");
  }
  assert.equal(catalog.duplicate_cleanup.bytes_redundant,
    copies.reduce((n,x) => n + x.size_bytes,0));
});

test("App preserves source hash manifests, significant alternate versions and highspy exception", () => {
  assert.equal(catalog.duplicate_cleanup.whitelist_verified_aliases.length, 1);
  const highspy = catalog.duplicate_cleanup.whitelist_verified_aliases[0];
  assert.ok(highspy.copy_title.includes("highspy-wheelhouse-1.16.0-"));
  assert.equal(highspy.disposition, "PRESERVE_VERSION_ALIAS");
  assert.ok(catalog.canonical.python_wheelhouses.some(x => x.name === "SHA256SUMS-ZIPS"));
  assert.ok(catalog.canonical.portable_top_level.some(x => x.name === "SHA256SUMS"));
  assert.ok(catalog.canonical.native.some(x => x.name.endsWith(".part-04")));
  assert.ok(catalog.canonical.native.some(x => x.name === "why3-1.8.0-linux-x86_64.tar.zst"));
  assert.equal(catalog.rules.product.includes("NOT"), true);
});
