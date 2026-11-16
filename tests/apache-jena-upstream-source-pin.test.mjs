import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const builder = readFileSync("portable/builders/tools/apache-jena.sh", "utf8");

const uniqueValue = (source, name) => {
  const assignmentPattern = new RegExp(`\\b${name}(?:\\[[^\\]]+\\])?\\s*(?:\\+|:)?=`);
  const lines = source.split(/\r?\n/).filter(line => assignmentPattern.test(line));
  assert.equal(lines.length, 1, name + " must be assigned exactly once");

  const literalPattern = new RegExp(`^${name}=(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([A-Za-z0-9._:/+-]+))$`);
  const match = lines[0].match(literalPattern);
  assert.ok(match, name + " must use one plain static literal assignment");
  return match[1] ?? match[2] ?? match[3];
};

function bashSource(source) {
  const directory = mkdtempSync(join(tmpdir(), "apache-jena-builder-"));
  const sourcePath = join(directory, "apache-jena.sh");
  writeFileSync(sourcePath, source, "utf8");
  try {
    return spawnSync(
      "bash",
      ["-c", 'source "$1"; printf "%s\\n" "$FT_UPSTREAM_SHA512"', "bash", sourcePath],
      { encoding: "utf8" }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

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

test("Jena source pins reject shell-valid overrides for URL and SHA512", () => {
  const digest = "0".repeat(128);
  const controls = [
    value => `KEY=${value}`,
    value => ` KEY=${value}`,
    value => `\tKEY=${value}`,
    value => `export KEY=${value}`,
    value => `readonly KEY=${value}`,
    value => `declare KEY=${value}`,
    value => `declare -g KEY=${value}`,
    value => `typeset KEY=${value}`,
    value => `local KEY=${value}`,
    value => `KEY+=${value}`,
    value => `KEY:=${value}`,
    value => `KEY[0]=${value}`
  ];

  for (const name of ["FT_UPSTREAM_URL", "FT_UPSTREAM_SHA512"]) {
    const value = name === "FT_UPSTREAM_URL"
      ? '"https://evil.invalid/apache-jena-5.5.0.tar.gz"'
      : `"${digest}"`;
    for (const makeLine of controls) {
      const injected = makeLine(value).replaceAll("KEY", name);
      assert.throws(
        () => uniqueValue(builder + `\n${injected}\n`, name),
        `${name} override ${injected}`
      );
    }
  }
});

test("Bash source regression: readonly upstream digest override is executable but rejected", (t) => {
  const digest = "0".repeat(128);
  const injected = `${builder}\nreadonly FT_UPSTREAM_SHA512="${digest}"\n`;
  const shell = bashSource(injected);
  if (shell.error && "code" in shell.error && shell.error.code === "ENOENT") {
    t.skip("Bash is unavailable on this host; Debian CI executes this regression");
    return;
  }
  assert.equal(shell.error, undefined, shell.stderr);
  assert.equal(shell.status, 0, shell.stderr);
  assert.equal(shell.stdout, digest + "\n");
  assert.throws(() => uniqueValue(injected, "FT_UPSTREAM_SHA512"));
});
