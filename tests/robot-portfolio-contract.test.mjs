import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const contract = readFileSync(new URL("../portable/verification/cases/robot/expect.sh", import.meta.url), "utf8");

const EXPECTED_KEYS = [
  "EXPECT_TIMEOUT",
  "EXPECT_POS_VIA",
  "EXPECT_POS_ARGS",
  "EXPECT_POS_EXIT",
  "EXPECT_POS_REGEX",
  "EXPECT_POS_LABEL",
  "EXPECT_NEG_ARGS",
  "EXPECT_NEG_EXIT",
  "EXPECT_NEG_REGEX",
  "EXPECT_NEG_LABEL",
  "EXPECT_ERR_ARGS",
  "EXPECT_ERR_EXIT",
  "EXPECT_ERR_REGEX",
  "EXPECT_ERR_LABEL"
];

function parseStaticContract(source) {
  const values = new Map();
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;

    const match = line.match(/^(EXPECT_[A-Z0-9_]+)=([^\r\n]*)$/);
    assert.ok(match, `line ${index + 1} must be a plain EXPECT_* assignment`);
    const [, key, value] = match;
    assert.ok(EXPECTED_KEYS.includes(key), `line ${index + 1} uses an unsupported key: ${key}`);
    assert.equal(values.has(key), false, `${key} must appear exactly once`);

    if (key.endsWith("_EXIT") || key === "EXPECT_TIMEOUT") {
      assert.match(value, /^[0-9]+$/, `${key} must be an unquoted integer`);
    } else if (key === "EXPECT_POS_VIA" || key.endsWith("_LABEL")) {
      assert.match(value, /^[A-Za-z0-9_-]+$/, `${key} must be a static token`);
    } else {
      assert.match(value, /^'[^'\r\n]*'$/, `${key} must be a single-quoted static string`);
    }
    values.set(key, value);
  }

  assert.deepEqual(
    [...values.keys()].sort(),
    [...EXPECTED_KEYS].sort(),
    "the contract must contain every allowed assignment exactly once"
  );

  return {
    POS: Number(values.get("EXPECT_POS_EXIT")),
    NEG: Number(values.get("EXPECT_NEG_EXIT")),
    ERR: Number(values.get("EXPECT_ERR_EXIT"))
  };
}

function bashSource(source) {
  const directory = mkdtempSync(join(tmpdir(), "robot-contract-"));
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

test("Robot fixture is a fail-closed static shell contract with exact phase exit codes", () => {
  assert.deepEqual(parseStaticContract(contract), { POS: 0, NEG: 1, ERR: 1 });
  assert.match(contract, /^EXPECT_TIMEOUT=180$/m);
});

test("Robot contract rejects duplicate, wildcard, missing, quoted and shell-valid exit overrides for every phase", () => {
  const malformed = [
    { label: "duplicate", line: "EXPECT_PHASE_EXIT=77" },
    { label: "leading-space", line: " EXPECT_PHASE_EXIT=77" },
    { label: "tab-indented", line: "\tEXPECT_PHASE_EXIT=77" },
    { label: "export", line: "export EXPECT_PHASE_EXIT=77" },
    { label: "readonly", line: "readonly EXPECT_PHASE_EXIT=77" },
    { label: "declare", line: "declare EXPECT_PHASE_EXIT=77" },
    { label: "declare-global", line: "declare -g EXPECT_PHASE_EXIT=77" },
    { label: "typeset", line: "typeset EXPECT_PHASE_EXIT=77" },
    { label: "local", line: "local EXPECT_PHASE_EXIT=77" },
    { label: "command-substitution", line: "EXPECT_PHASE_EXIT=$(printf 77)" },
    { label: "wildcard", line: "EXPECT_PHASE_EXIT=*" },
    { label: "quoted", line: "EXPECT_PHASE_EXIT='77'" }
  ];

  for (const phase of ["POS", "NEG", "ERR"]) {
    for (const control of malformed) {
      const key = `EXPECT_${phase}_EXIT`;
      const line = control.line.replaceAll("EXPECT_PHASE_EXIT", key);
      const source = `${contract}\n${line}\n`;
      assert.throws(() => parseStaticContract(source), `${phase} ${control.label}`);
    }
  }

  for (const phase of ["POS", "NEG", "ERR"]) {
    const key = `EXPECT_${phase}_EXIT`;
    const missing = contract.replace(new RegExp(`^${key}=[0-9]+\\r?\\n?`, "m"), "");
    assert.throws(() => parseStaticContract(missing), `${phase} missing`);
  }
});

test("Bash source regression: an export override changes shell state but the contract gate rejects it", () => {
  const valid = bashSource(contract);
  assert.equal(valid.error, undefined, valid.stderr);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, "0,1,1\n");

  const injected = `${contract}\nexport EXPECT_NEG_EXIT=77\n`;
  const shell = bashSource(injected);
  assert.equal(shell.error, undefined, shell.stderr);
  assert.equal(shell.status, 0, shell.stderr);
  assert.equal(shell.stdout, "0,77,1\n", "Bash must demonstrate that the override is executable");
  assert.throws(() => parseStaticContract(injected), /plain EXPECT_\* assignment/);
});

test("Robot POS requires a generated reasoning artifact and keeps its exact command and label", () => {
  assert.match(contract, /^EXPECT_POS_VIA=sh$/m);
  assert.match(contract, /^EXPECT_POS_ARGS='"\$BUNDLE\/tools\/robot\/run" reason --reasoner ELK --input "\$BUNDLE\/tests\/robot\/pos\.ttl" --output "\$FT_TMP\/reasoned\.ttl" && test -s "\$FT_TMP\/reasoned\.ttl" && grep -q "ex:alice" "\$FT_TMP\/reasoned\.ttl" && echo ROBOT_REASONED_OUTPUT_OK'$/m);
  assert.match(contract, /^EXPECT_POS_EXIT=0$/m);
  assert.match(contract, /^EXPECT_POS_REGEX='ROBOT_REASONED_OUTPUT_OK'$/m);
  assert.match(contract, /^EXPECT_POS_LABEL=CONSISTENT$/m);
});

test("Robot NEG and ERR keep their exact native exit codes, commands, regexes and labels", () => {
  assert.match(contract, /^EXPECT_NEG_ARGS='reason --reasoner ELK --input tests\/robot\/neg\.ttl'$/m);
  assert.match(contract, /^EXPECT_NEG_EXIT=1$/m);
  assert.match(contract, /^EXPECT_NEG_REGEX='The ontology is inconsistent'$/m);
  assert.match(contract, /^EXPECT_NEG_LABEL=INCONSISTENT$/m);
  assert.match(contract, /^EXPECT_ERR_ARGS='reason --reasoner ELK --input tests\/robot\/err\.ttl'$/m);
  assert.match(contract, /^EXPECT_ERR_EXIT=1$/m);
  assert.match(contract, /^EXPECT_ERR_REGEX='INVALID ONTOLOGY FILE ERROR'$/m);
  assert.match(contract, /^EXPECT_ERR_LABEL=ERROR$/m);
});
