import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const builder = readFileSync("portable/builders/tools/apache-jena.sh", "utf8");
const uniqueValue = (source, name) => {
  const lines = source.split(/\r?\n/).filter((line) => line.startsWith(name + "="));
  assert.equal(lines.length, 1, name + " must be assigned exactly once");
  return lines[0].slice(name.length + 1).replace(/^['"]|['"]$/g, "");
};

test("Apache Jena builder pins the official 5.5.0 archive and publisher SHA512", () => {
  assert.equal(uniqueValue(builder, "FT_TOOL_VERSION"), "5.5.0");
  assert.equal(uniqueValue(builder, "FT_UPSTREAM_URL"), "https://archive.apache.org/dist/jena/binaries/apache-jena-5.5.0.tar.gz");
  assert.equal(uniqueValue(builder, "FT_UPSTREAM_SHA512"), "f9ae68a748e642c6a8175ee25afdfa37ce057ed37e7caf279a8a46ad93284bea808cf14d96bf30b6e4e6a4ddaf30cf5ee9d441f48a9a3d3c9e647a9b71645e0c");
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

test("Jena run shim uses the bundled Java 21 runtime", () => {
  const javaHome = 'export JAVA_HOME="$FT_ROOT/runtimes/java21"';
  const javaPath = 'export PATH="$JAVA_HOME/bin:$TOOL_DIR/bin:$PATH"';
  const shimExec = 'exec "$TOOL_DIR/bin/riot" "$@"';
  const javaHomeAt = builder.indexOf(javaHome);
  const javaPathAt = builder.indexOf(javaPath);
  const execAt = builder.indexOf(shimExec);
  assert.ok(javaHomeAt >= 0 && javaPathAt >= 0 && execAt >= 0);
  assert.ok(javaHomeAt < javaPathAt && javaPathAt < execAt);
});

test("Jena source pin rejects duplicate overrides of the upstream digest", () => {
  const duplicate = builder + '\nFT_UPSTREAM_SHA512="' + "0".repeat(128) + '"\n';
  assert.throws(() => uniqueValue(duplicate, "FT_UPSTREAM_SHA512"), /assigned exactly once/);
});
