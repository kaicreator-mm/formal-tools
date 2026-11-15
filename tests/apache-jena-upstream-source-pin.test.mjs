import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const builder = readFileSync("portable/builders/tools/apache-jena.sh", "utf8");

test("Apache Jena builder pins the official 5.5.0 archive and publisher SHA512", () => {
  assert.match(builder, /FT_TOOL_VERSION=5\.5\.0/);
  assert.match(builder, /FT_UPSTREAM_URL="https:\/\/archive\.apache\.org\/dist\/jena\/binaries\/apache-jena-5\.5\.0\.tar\.gz"/);
  assert.match(builder, /FT_UPSTREAM_SHA512="f9ae68a748e642c6a8175ee25afdfa37ce057ed37e7caf279a8a46ad93284bea808cf14d96bf30b6e4e6a4ddaf30cf5ee9d441f48a9a3d3c9e647a9b71645e0c"/);
});

test("Jena fetched or cached bytes are checked before extraction", () => {
  const fetch = builder.indexOf('tgz=$(ft::fetch "$FT_UPSTREAM_URL")');
  const hash = builder.indexOf('actual_sha512=$(sha512sum "$tgz"');
  const guard = builder.indexOf('[ "$actual_sha512" = "$FT_UPSTREAM_SHA512" ] || ft::die');
  const extract = builder.indexOf('ft::extract "$tgz" /tmp/jena');
  assert.ok(fetch >= 0 && hash >= 0 && guard >= 0 && extract >= 0);
  assert.ok(fetch < hash && hash < guard && guard < extract);
});

test("Jena source pin fails closed and removes silent version/mirror fallback", () => {
  assert.match(builder, /ft::die "Apache Jena 5\.5\.0 upstream archive fetch failed/);
  assert.match(builder, /ft::die "Apache Jena 5\.5\.0 upstream archive SHA512 could not be computed/);
  assert.match(builder, /ft::die "Apache Jena 5\.5\.0 upstream archive SHA512 mismatch:/);
  assert.doesNotMatch(builder, /for\s+ver\s+in/);
  assert.doesNotMatch(builder, /for\s+host\s+in/);
  assert.doesNotMatch(builder, /ft::set_version/);
});
