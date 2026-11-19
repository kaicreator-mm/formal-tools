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

// Deferred-function execution layer: the R96 P1 showed that a mutation whose
// target name is assembled at runtime (split prefix/suffix + printf -v) hidden
// inside the deferred ft_tool_build() body evades both the static contract and
// the source-time Bash probe, because the pins are still official when sourcing
// completes. The only faithful gate is to source the real builder file and then
// actually invoke ft_tool_build() in a child Bash. Every upstream capability is
// replaced with an offline stub before invocation:
//   ft::fetch   records the URL it is called with and rejects any URL that is
//               not the official one before any network access (return 72, the
//               builder then routes to ft::die).
//   sha512sum   records the live $FT_UPSTREAM_SHA512 expectation and emits an
//               independent official digest; the real builder guard compares
//               them, so a mutated pin fails the guard before extraction.
//   ft::die     records DIE and exits 73.
//   ft::extract records the archive path and exits 74 without installing
//               anything, so no find/cp ever reaches host paths even for the
//               valid builder.
const MOCK_ARCHIVE = "/mock/jena-offline.tgz";
const FT_TOOL_BUILD_MARKER = "ft_tool_build() {\n";

const REAL_TOOL_BUILD_HARNESS = `
trace="$1"; source_file="$2"; official_url="$3"; official_sha512="$4"
: > "$trace"
ft::fetch() {
  printf 'FETCH:%s\\n' "$1" >> "$trace"
  if [ "$1" != "$official_url" ]; then
    printf 'FETCH_REJECTED\\n' >> "$trace"
    return 72
  fi
  printf '%s\\n' '${MOCK_ARCHIVE}'
}
sha512sum() {
  printf 'GUARD_EXPECT:%s\\n' "$FT_UPSTREAM_SHA512" >> "$trace"
  printf '%s\\n' "$official_sha512"
}
ft::die() {
  printf 'DIE\\n' >> "$trace"
  exit 73
}
ft::extract() {
  printf 'EXTRACT:%s\\n' "$1" >> "$trace"
  exit 74
}
source "$source_file"
ft_tool_build
`;

function runRealToolBuild(source) {
  const directory = mkdtempSync(join(tmpdir(), "apache-jena-tool-build-"));
  const sourcePath = join(directory, "apache-jena.sh").replaceAll("\\", "/");
  const tracePath = join(directory, "trace.log").replaceAll("\\", "/");
  writeFileSync(sourcePath, source, "utf8");
  writeFileSync(tracePath, "", "utf8");
  try {
    const shell = spawnSync(
      "bash",
      ["-c", REAL_TOOL_BUILD_HARNESS, "bash", tracePath, sourcePath, OFFICIAL_URL, OFFICIAL_SHA512],
      { encoding: "utf8" }
    );
    const trace = readFileSync(tracePath, "utf8")
      .split(/\r?\n/)
      .filter(line => line.length > 0);
    return { shell, trace };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

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

// The R96 P1 bypass: mutation materialised inside the deferred ft_tool_build()
// body from a split prefix/suffix variable name. No line of the injected text
// contains the bare pin name, so the static contract cannot see it, and the
// pins are still official when sourcing completes, so the source-time Bash
// probe cannot see it either. Only executing the real deferred function under
// offline stubs exposes it.
const SPLIT_NAME_MUTANTS = [
  {
    label: "split-name printf -v URL rewrite",
    body: `local prefix=FT_UPSTREAM_ suffix=URL
  printf -v "\${prefix}\${suffix}" '%s' '${EVIL_URL}'`,
    status: 73,
    trace: [`FETCH:${EVIL_URL}`, "FETCH_REJECTED", "DIE"]
  },
  {
    label: "split-name printf -v SHA512 rewrite",
    body: `local prefix=FT_UPSTREAM_ suffix=SHA512
  printf -v "\${prefix}\${suffix}" '%s' '${EVIL_SHA512}'`,
    status: 73,
    trace: [`FETCH:${OFFICIAL_URL}`, `GUARD_EXPECT:${EVIL_SHA512}`, "DIE"]
  },
  {
    label: "simultaneous split-name printf -v URL and SHA512 rewrite",
    body: `local prefix=FT_UPSTREAM_
  printf -v "\${prefix}URL" '%s' '${EVIL_URL}'
  printf -v "\${prefix}SHA512" '%s' '${EVIL_SHA512}'`,
    status: 73,
    trace: [`FETCH:${EVIL_URL}`, "FETCH_REJECTED", "DIE"]
  }
];

const injectIntoToolBuild = (body) =>
  builder.replace(FT_TOOL_BUILD_MARKER, `${FT_TOOL_BUILD_MARKER}  ${body}\n`);

test("Real ft_tool_build under offline stubs reaches only the official fetch, guard and mocked extract", (t) => {
  const run = runRealToolBuild(builder);
  if (bashUnavailable(run.shell)) {
    t.skip("Bash is unavailable on this host; Debian CI executes this check");
    return;
  }
  assert.equal(run.shell.error, undefined, run.shell.stderr);
  assert.equal(run.shell.status, 74, `trace: ${run.trace.join(" | ")}`);
  assert.deepEqual(
    run.trace,
    [`FETCH:${OFFICIAL_URL}`, `GUARD_EXPECT:${OFFICIAL_SHA512}`, `EXTRACT:${MOCK_ARCHIVE}`],
    "the real builder must fetch the official URL, guard with the official digest and stop at the mocked extract"
  );
});

test("Real ft_tool_build rejects split-name printf -v pin mutations before unauthorized fetch or extract", (t) => {
  for (const mutant of SPLIT_NAME_MUTANTS) {
    const injected = injectIntoToolBuild(mutant.body);

    // Blindness proof: the static contract passes because no bare pin name
    // occurs, and the source-time probe passes because the pins are still
    // official at source time. Exactly these two layers passed in R96 while
    // the deferred body was corrupted.
    assert.doesNotThrow(
      () => assertPinContract(injected, "FT_UPSTREAM_URL"),
      "static contract must stay blind to the split-name mutant (this is why the execution layer exists)"
    );
    assert.doesNotThrow(
      () => assertPinContract(injected, "FT_UPSTREAM_SHA512"),
      "static contract must stay blind to the split-name mutant (this is why the execution layer exists)"
    );

    const run = runRealToolBuild(injected);
    if (bashUnavailable(run.shell)) {
      t.skip("Bash is unavailable on this host; Debian CI executes this check");
      return;
    }
    assert.equal(run.shell.error, undefined, run.shell.stderr);
    assert.equal(
      run.shell.status,
      mutant.status,
      `${mutant.label} must abort via ft::die before extraction; trace: ${run.trace.join(" | ")}`
    );
    assert.deepEqual(
      run.trace,
      mutant.trace,
      `${mutant.label} trace must show the safe abort with no EXTRACT`
    );
    assert.ok(
      !run.trace.some(line => line.startsWith("EXTRACT:")),
      `${mutant.label} must never reach extraction`
    );
  }
});
