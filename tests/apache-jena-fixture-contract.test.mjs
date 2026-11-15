import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const contract = readFileSync("portable/verification/cases/apache-jena/expect.sh", "utf8");
const negativeFixture = readFileSync("portable/verification/cases/apache-jena/neg.ttl", "utf8");

const EXPECTED_KEYS = [
  "EXPECT_TIMEOUT",
  "EXPECT_POS_ARGS", "EXPECT_POS_EXIT", "EXPECT_POS_REGEX", "EXPECT_POS_LABEL",
  "EXPECT_NEG_ARGS", "EXPECT_NEG_EXIT", "EXPECT_NEG_REGEX", "EXPECT_NEG_LABEL",
  "EXPECT_ERR_ARGS", "EXPECT_ERR_EXIT", "EXPECT_ERR_REGEX", "EXPECT_ERR_LABEL"
];

function parseContract(source) {
  const values = new Map();
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;

    const match = line.match(/^(EXPECT_[A-Z0-9_]+)=([^\r\n]*)$/);
    assert.ok(match, `line ${index + 1} must be a plain static EXPECT_* assignment`);
    const [, name, value] = match;
    assert.ok(EXPECTED_KEYS.includes(name), `line ${index + 1} uses an unsupported key: ${name}`);
    assert.equal(values.has(name), false, `${name} must be assigned exactly once`);

    if (name === "EXPECT_TIMEOUT" || name.endsWith("_EXIT")) {
      assert.match(value, /^[0-9]+$/, `${name} must be an unquoted integer`);
    } else if (name.endsWith("_LABEL")) {
      assert.match(value, /^[A-Z0-9_]+$/, `${name} must be a static token`);
    } else {
      assert.match(value, /^'[^'\r\n]*'$/, `${name} must be a single-quoted static string`);
    }
    values.set(name, value);
  }

  assert.deepEqual(
    [...values.keys()].sort(),
    [...EXPECTED_KEYS].sort(),
    "the contract must contain every allowlisted key exactly once"
  );
  return values;
}

const field = (name, source = contract) => {
  const values = parseContract(source);
  assert.ok(values.has(name), name + " is required");
  const value = values.get(name);
  return value.startsWith("'") ? value.slice(1, -1) : value;
};

function bashSource(source) {
  const directory = mkdtempSync(join(tmpdir(), "apache-jena-expect-"));
  const sourcePath = join(directory, "expect.sh");
  writeFileSync(sourcePath, source, "utf8");
  try {
    return spawnSync(
      "bash",
      ["-c", 'set -euo pipefail; source "$1"; printf "%s,%s,%s\\n" "$EXPECT_POS_EXIT" "$EXPECT_NEG_EXIT" "$EXPECT_ERR_EXIT"', "bash", sourcePath],
      { encoding: "utf8" }
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("Apache Jena POS/NEG/ERR fixture contract pins exact native exit codes", () => {
  for (const name of EXPECTED_KEYS) field(name);
  assert.equal(field("EXPECT_POS_EXIT"), "0");
  assert.equal(field("EXPECT_NEG_EXIT"), "1");
  assert.equal(field("EXPECT_ERR_EXIT"), "2");
  assert.equal(field("EXPECT_POS_LABEL"), "RDF_VALID");
  assert.equal(field("EXPECT_NEG_LABEL"), "MALFORMED_RDF_SYNTAX_REJECTED");
  assert.equal(field("EXPECT_ERR_LABEL"), "ERROR");
  assert.equal(field("EXPECT_NEG_REGEX"), "Triples not terminated properly in \\[\\]-list");
  assert.match(field("EXPECT_POS_ARGS"), /--validate tests\/apache-jena\/pos\.ttl/);
  assert.match(field("EXPECT_NEG_ARGS"), /--validate tests\/apache-jena\/neg\.ttl/);
  assert.match(field("EXPECT_ERR_ARGS"), /--validate tests\/apache-jena\/does-not-exist\.ttl/);
});

test("Apache Jena fixture contract rejects shell-valid overrides for every phase exit", () => {
  const controls = [
    { label: "ordinary duplicate", line: "KEY=77" },
    { label: "leading space", line: " KEY=77" },
    { label: "tab indentation", line: "\tKEY=77" },
    { label: "export", line: "export KEY=77" },
    { label: "readonly", line: "readonly KEY=77" },
    { label: "declare", line: "declare KEY=77" },
    { label: "declare -g", line: "declare -g KEY=77" },
    { label: "typeset", line: "typeset KEY=77" },
    { label: "local", line: "local KEY=77" },
    { label: "command substitution", line: "KEY=$(printf 77)" },
    { label: "wildcard", line: "KEY=*" },
    { label: "quoted value", line: "KEY='77'" }
  ];

  for (const phase of ["POS", "NEG", "ERR"]) {
    const key = `EXPECT_${phase}_EXIT`;
    for (const control of controls) {
      const injected = control.line.replaceAll("KEY", key);
      assert.throws(
        () => parseContract(`${contract}\n${injected}\n`),
        `${phase} ${control.label}`
      );
    }
    const missing = contract.split(/\r?\n/).filter(line => !line.startsWith(key + "=")).join("\n");
    assert.throws(() => parseContract(missing), `${phase} missing assignment`);
  }
});

test("Bash source regression: readonly exit override changes shell state but fails the contract gate", (t) => {
  const valid = bashSource(contract);
  if (valid.error?.code === "ENOENT") {
    t.skip("Bash is unavailable on this host; Debian CI executes this regression");
    return;
  }
  assert.equal(valid.error, undefined, valid.stderr);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, "0,1,2\n");

  const injected = `${contract}\nreadonly EXPECT_NEG_EXIT=77\n`;
  const shell = bashSource(injected);
  assert.equal(shell.error, undefined, shell.stderr);
  assert.equal(shell.status, 0, shell.stderr);
  assert.equal(shell.stdout, "0,77,2\n", "Bash must demonstrate that readonly override is executable");
  assert.throws(() => parseContract(injected), /plain static EXPECT_\* assignment/);
});

test("Apache Jena NEG fixture reaches malformed RDF syntax, not an undeclared-prefix error", () => {
  assert.match(negativeFixture, /^@prefix rdfs: <http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#> \.$/m);
  assert.match(negativeFixture, /rdfs:label \[ "unclosed"$/m);
  assert.doesNotMatch(negativeFixture, /Undefined prefix: rdfs/);
  assert.equal(field("EXPECT_NEG_REGEX"), "Triples not terminated properly in \\[\\]-list");
});
