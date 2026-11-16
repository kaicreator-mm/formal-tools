import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const builder = readFileSync("portable/builders/tools/apache-jena.sh", "utf8");

const OFFICIAL_URL = "https://archive.apache.org/dist/jena/binaries/apache-jena-5.5.0.tar.gz";
const OFFICIAL_SHA512 = "f9ae68a748e642c6a8175ee25afdfa37ce057ed37e7caf279a8a46ad93284bea808cf14d96bf30b6e4e6a4ddaf30cf5ee9d441f48a9a3d3c9e647a9b71645e0c";
const EVIL_URL = "https://evil.invalid/apache-jena-5.5.0.tar.gz";
const EVIL_SHA512 = "0".repeat(128);

// Static layer 1: exactly one plain static literal assignment per pin. Any
// assignment-shaped write (duplicate, leading whitespace, export/readonly/
// declare/declare -g/typeset/local prefix, +=, :=, indexed) changes the count
// or fails the literal shape.
const uniqueValue = (source, name) => {
  const assignmentPattern = new RegExp(`\\b${name}(?:\\[[^\\]]+\\])?\\s*(?:\\+|:)?=`);
  const lines = source.split(/\r?\n/).filter(line => assignmentPattern.test(line));
  assert.equal(lines.length, 1, name + " must be assigned exactly once");

  const literalPattern = new RegExp(`^${name}=(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([A-Za-z0-9._:/+-]+))$`);
  const match = lines[0].match(literalPattern);
  assert.ok(match, name + " must use one plain static literal assignment");
  return match[1] ?? match[2] ?? match[3];
};

const literalLinePattern = (name) =>
  new RegExp(`^${name}=(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([A-Za-z0-9._:/+-]+))$`);

// Static layer 2 (fail-closed): outside the single static literal assignment,
// the pin name may only occur as a $NAME or ${NAME...} read reference. Any
// other textual occurrence — printf -v NAME, read -r NAME, eval "NAME=...",
// declare -n ref=NAME, for NAME in, NAME materialised into an indirect write —
// is rejected even when no assignment-shaped line exists. This is what closes
// the R94 P1-01 class: Bash builtins write variables without any `NAME=`.
const assertNoBarePinMentions = (source, name) => {
  const readReference = new RegExp(`\\$\\{${name}[^}]*\\}|\\$${name}\\b`, "g");
  const bareMention = new RegExp(`\\b${name}\\b`);
  const literalLine = literalLinePattern(name);
  let assignments = 0;
  source.split(/\r?\n/).forEach((line, index) => {
    if (literalLine.test(line)) {
      assignments += 1;
      return;
    }
    const residual = line.replace(readReference, "");
    if (bareMention.test(residual)) {
      throw new Error(
        `${name} appears outside its single static literal assignment at line ${index + 1}: ${line}`
      );
    }
  });
  assert.equal(assignments, 1, name + " must appear as exactly one static literal assignment");
};

// Combined static gate: both layers must hold for a source text to be trusted.
const assertPinContract = (source, name) => {
  uniqueValue(source, name);
  assertNoBarePinMentions(source, name);
};

// Dynamic layer: source the builder in real Bash and observe the live pin
// values. Static scanning cannot see writes whose target name is assembled at
// runtime; executing the source and comparing live state against the parsed
// pins closes that gap and proves the core invariant: the Bash-observed
// FT_UPSTREAM_URL / FT_UPSTREAM_SHA512 equal the official static pins exactly.
function bashSourcePins(source) {
  const directory = mkdtempSync(join(tmpdir(), "apache-jena-builder-"));
  const sourcePath = join(directory, "apache-jena.sh");
  writeFileSync(sourcePath, source, "utf8");
  try {
    return spawnSync(
      "bash",
      ["-c", 'source "$1"; printf "%s\\n" "$FT_UPSTREAM_URL" "$FT_UPSTREAM_SHA512"', "bash", sourcePath],
      { encoding: "utf8" }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const bashUnavailable = (shell) => Boolean(shell.error && shell.error.code === "ENOENT");

const livePins = (shell) => {
  const [url, sha512] = shell.stdout.split(/\r?\n/);
  return { url, sha512 };
};

// Shell-valid non-assignment writes that mutate a pin without any `NAME=`
// assignment-shaped line. Each entry's `live` records the Bash-observed state
// after sourcing builder + line, proving the mutation is semantically real and
// not a strawman string.
const NON_ASSIGNMENT_MUTANTS = [
  {
    name: "FT_UPSTREAM_URL",
    line: `printf -v FT_UPSTREAM_URL '%s' '${EVIL_URL}'`,
    live: { url: EVIL_URL, sha512: OFFICIAL_SHA512 }
  },
  {
    name: "FT_UPSTREAM_SHA512",
    line: `printf -v FT_UPSTREAM_SHA512 '%s' '${EVIL_SHA512}'`,
    live: { url: OFFICIAL_URL, sha512: EVIL_SHA512 }
  },
  {
    name: "FT_UPSTREAM_URL",
    line: `read -r FT_UPSTREAM_URL <<< '${EVIL_URL}'`,
    live: { url: EVIL_URL, sha512: OFFICIAL_SHA512 }
  },
  {
    name: "FT_UPSTREAM_SHA512",
    line: `read -r FT_UPSTREAM_SHA512 <<< '${EVIL_SHA512}'`,
    live: { url: OFFICIAL_URL, sha512: EVIL_SHA512 }
  },
  {
    name: "FT_UPSTREAM_URL",
    line: `eval "FT_UPSTREAM_URL='${EVIL_URL}'"`,
    live: { url: EVIL_URL, sha512: OFFICIAL_SHA512 }
  },
  {
    name: "FT_UPSTREAM_SHA512",
    line: `eval "FT_UPSTREAM_SHA512='${EVIL_SHA512}'"`,
    live: { url: OFFICIAL_URL, sha512: EVIL_SHA512 }
  },
  {
    name: "FT_UPSTREAM_URL",
    line: `__jena_pin=FT_UPSTREAM_URL; printf -v "$__jena_pin" '%s' '${EVIL_URL}'`,
    live: { url: EVIL_URL, sha512: OFFICIAL_SHA512 }
  },
  {
    name: "FT_UPSTREAM_SHA512",
    line: `__jena_pin=FT_UPSTREAM_SHA512; eval "$__jena_pin='${EVIL_SHA512}'"`,
    live: { url: OFFICIAL_URL, sha512: EVIL_SHA512 }
  },
  {
    name: "FT_UPSTREAM_URL",
    line: `declare -n __jena_ref=FT_UPSTREAM_URL; __jena_ref='${EVIL_URL}'`,
    live: { url: EVIL_URL, sha512: OFFICIAL_SHA512 }
  }
];

test("Apache Jena builder pins the official 5.5.0 archive and publisher SHA512", () => {
  assert.equal(uniqueValue(builder, "FT_TOOL_VERSION"), "5.5.0");
  assert.equal(uniqueValue(builder, "FT_UPSTREAM_URL"), OFFICIAL_URL);
  assert.equal(uniqueValue(builder, "FT_UPSTREAM_SHA512"), OFFICIAL_SHA512);
  assertPinContract(builder, "FT_UPSTREAM_URL");
  assertPinContract(builder, "FT_UPSTREAM_SHA512");
});

test("Jena builder live Bash source state equals the pinned URL and SHA512", (t) => {
  const shell = bashSourcePins(builder);
  if (bashUnavailable(shell)) {
    t.skip("Bash is unavailable on this host; Debian CI executes this check");
    return;
  }
  assert.equal(shell.error, undefined, shell.stderr);
  assert.equal(shell.status, 0, shell.stderr);
  assert.deepEqual(livePins(shell), { url: OFFICIAL_URL, sha512: OFFICIAL_SHA512 });
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
      ? `"${EVIL_URL}"`
      : `"${EVIL_SHA512}"`;
    for (const makeLine of controls) {
      const injected = makeLine(value).replaceAll("KEY", name);
      assert.throws(
        () => assertPinContract(builder + `\n${injected}\n`, name),
        `${name} override ${injected}`
      );
    }
  }
});

test("Jena source pins reject non-assignment shell writes for URL and SHA512", () => {
  for (const mutant of NON_ASSIGNMENT_MUTANTS) {
    const injected = `${builder}\n${mutant.line}\n`;
    assert.throws(
      () => assertPinContract(injected, mutant.name),
      `${mutant.name} non-assignment write must be rejected: ${mutant.line}`
    );
  }
});

test("Bash source regression: non-assignment pin writes mutate live values but the gate rejects them", (t) => {
  const probe = bashSourcePins(builder);
  if (bashUnavailable(probe)) {
    t.skip("Bash is unavailable on this host; Debian CI executes this regression");
    return;
  }
  for (const mutant of NON_ASSIGNMENT_MUTANTS) {
    const injected = `${builder}\n${mutant.line}\n`;
    const shell = bashSourcePins(injected);
    assert.equal(shell.error, undefined, shell.stderr);
    assert.equal(shell.status, 0, `${mutant.line}\n${shell.stderr}`);
    assert.deepEqual(
      livePins(shell),
      mutant.live,
      `${mutant.line} must change the live sourced value`
    );
    assert.throws(
      () => assertPinContract(injected, mutant.name),
      `${mutant.name} gate must reject: ${mutant.line}`
    );
  }
});

test("Bash source regression: readonly upstream digest override is executable but rejected", (t) => {
  const injected = `${builder}\nreadonly FT_UPSTREAM_SHA512="${EVIL_SHA512}"\n`;
  const shell = bashSourcePins(injected);
  if (bashUnavailable(shell)) {
    t.skip("Bash is unavailable on this host; Debian CI executes this regression");
    return;
  }
  assert.equal(shell.error, undefined, shell.stderr);
  assert.equal(shell.status, 0, shell.stderr);
  assert.deepEqual(
    livePins(shell),
    { url: OFFICIAL_URL, sha512: EVIL_SHA512 },
    "readonly override must change the live sourced digest"
  );
  assert.throws(() => assertPinContract(injected, "FT_UPSTREAM_SHA512"));
});
