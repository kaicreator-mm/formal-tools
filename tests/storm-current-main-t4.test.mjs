import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const fixture = await readFile(new URL("../portable/verification/cases/storm/expect.sh", import.meta.url), "utf8");
const model = await readFile(new URL("../portable/verification/cases/storm/pos.pm", import.meta.url), "utf8");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const stormExpectKeys = [
  "EXPECT_TIMEOUT",
  "EXPECT_POS_ARGS", "EXPECT_POS_EXIT", "EXPECT_POS_REGEX", "EXPECT_POS_LABEL",
  "EXPECT_NEG_ARGS", "EXPECT_NEG_EXIT", "EXPECT_NEG_REGEX", "EXPECT_NEG_LABEL",
  "EXPECT_ERR_VIA", "EXPECT_ERR_ARGS", "EXPECT_ERR_EXIT", "EXPECT_ERR_REGEX", "EXPECT_ERR_LABEL"
];
const requiredStormExpectKeys = [
  "EXPECT_POS_ARGS", "EXPECT_POS_EXIT", "EXPECT_POS_REGEX", "EXPECT_POS_LABEL",
  "EXPECT_NEG_ARGS", "EXPECT_NEG_EXIT", "EXPECT_NEG_REGEX", "EXPECT_NEG_LABEL",
  "EXPECT_ERR_ARGS", "EXPECT_ERR_EXIT", "EXPECT_ERR_REGEX", "EXPECT_ERR_LABEL"
];

function uniqueNumericExitAssignments(source) {
  const values = {};
  const assignments = new Map();
  const lines = source.split(/\r?\n/);
  // This is the exact Storm fixture contract. Timeout and ERR_VIA retain
  // their Runner-supported optional semantics; every other phase key is required.
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const assignment = line.match(/^[\t ]*(?:export[\t ]+)?(EXPECT_[A-Z0-9_]+)=(.*)$/);
    assert.ok(assignment, "unsupported shell command in sourced expect.sh at line " + (index + 1));
    const [, name, raw] = assignment;
    assert.ok(stormExpectKeys.includes(name), "unknown Storm EXPECT key " + name + " at line " + (index + 1));
    assert.equal(assignments.has(name), false, "duplicate EXPECT assignment " + name + " at line " + (index + 1));
    const inner = raw.slice(1, -1);
    const singleQuoted = raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'") && !inner.includes("'");
    const doubleQuoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') &&
      !inner.includes('"') && !inner.includes("$") &&
      !inner.includes(String.fromCharCode(96)) && !inner.includes("\\");
    const unquotedLiteral = /^[A-Za-z0-9_./:*?+-]+$/.test(raw);
    assert.ok(singleQuoted || doubleQuoted || unquotedLiteral,
      "unsafe shell assignment value in sourced expect.sh at line " + (index + 1));
    assignments.set(name, { raw, line: index + 1 });
  }
  for (const name of requiredStormExpectKeys) {
    assert.ok(assignments.has(name), name + " must have exactly one assignment");
  }
  for (const phase of ["POS", "NEG", "ERR"]) {
    const name = "EXPECT_" + phase + "_EXIT";
    const raw = assignments.get(name).raw.replace(/[ \t]+#.*$/, "").trim();
    assert.match(raw, /^[0-9]+$/, name + " must be an unquoted numeric exit assignment");
    const value = Number(raw);
    assert.ok(Number.isSafeInteger(value), name + " must be a safe integer");
    values[phase] = value;
  }
  return values;
}

test("Storm current-main fixture pins exactly one numeric POS/NEG/ERR exit assignment", () => {
  assert.deepEqual(uniqueNumericExitAssignments(fixture), { POS: 0, NEG: 0, ERR: 1 });
  assert.match(fixture, /EXPECT_POS_ARGS=.*P>=0\.1/);
  assert.match(fixture, /EXPECT_NEG_ARGS=.*P<=0\.5/);
  assert.match(fixture, /EXPECT_POS_LABEL=PROPERTY_HOLDS/);
  assert.match(fixture, /EXPECT_NEG_LABEL=PROPERTY_FAILS/);
});

test("Storm exit parser recognizes ordinary, leading-space, tab, and export assignments", () => {
  const forms = [
    { label: "ordinary", format: (name, value) => name + "=" + value },
    { label: "leading space", format: (name, value) => " " + name + "=" + value },
    { label: "leading tab", format: (name, value) => "\t" + name + "=" + value },
    { label: "export", format: (name, value) => "export " + name + "=" + value },
    { label: "indented export with tab separator", format: (name, value) => " \texport\t" + name + "=" + value }
  ];
  for (const form of forms) {
    let source = fixture;
    for (const phase of ["POS", "NEG", "ERR"]) {
      const name = "EXPECT_" + phase + "_EXIT";
      const original = new RegExp("^" + name + "=([0-9]+)$", "m");
      source = source.replace(original, form.format(name, phase === "ERR" ? "1" : "0"));
    }
    assert.deepEqual(uniqueNumericExitAssignments(source), { POS: 0, NEG: 0, ERR: 1 }, form.label);
  }
});

test("Storm parser rejects duplicate assignments in every shell-valid syntax for every phase", () => {
  const forms = [
    { label: "ordinary", format: name => name + "=77" },
    { label: "leading space", format: name => " " + name + "=77" },
    { label: "leading tab", format: name => "\t" + name + "=77" },
    { label: "export", format: name => "export " + name + "=77" },
    { label: "indented export with tab separator", format: name => " \texport\t" + name + "=77" }
  ];
  for (const phase of ["POS", "NEG", "ERR"]) {
    const name = "EXPECT_" + phase + "_EXIT";
    for (const form of forms) {
      assert.throws(() => uniqueNumericExitAssignments(fixture + "\n" + form.format(name) + "\n"),
        /duplicate EXPECT assignment/, phase + " " + form.label);
    }
  }
});

test("Storm exit parser rejects missing, wildcard, quoted, and malformed values for every phase", () => {
  for (const phase of ["POS", "NEG", "ERR"]) {
    const name = "EXPECT_" + phase + "_EXIT";
    const original = new RegExp("^" + name + "=[^\\r\\n]*$", "m");
    const missing = fixture.replace(original, "");
    assert.throws(() => uniqueNumericExitAssignments(missing), /exactly one assignment/, phase + " missing");
    for (const value of ["*", "'0'", "\"0\""]) {
      const malformed = fixture.replace(original, name + "=" + value);
      assert.throws(() => uniqueNumericExitAssignments(malformed), /numeric exit assignment/, phase + " " + value);
    }
    for (const value of ["*", "'77'"]) {
      const duplicate = fixture + "\n\t" + name + "=" + value + "\n";
      assert.throws(() => uniqueNumericExitAssignments(duplicate), /exactly one assignment/, phase + " malformed duplicate " + value);
    }
  }
});

test("Storm sourced expect.sh rejects shell override commands for every exit phase", () => {
  const overrides = [
    name => "readonly " + name + "=77",
    name => "declare " + name + "=77",
    name => "typeset " + name + "=77",
    name => "local " + name + "=77",
    name => "declare -g " + name + "=77"
  ];
  for (const phase of ["POS", "NEG", "ERR"]) {
    const name = "EXPECT_" + phase + "_EXIT";
    for (const override of overrides) {
      assert.throws(
        () => uniqueNumericExitAssignments(fixture + "\n" + override(name) + "\n"),
        /unsupported shell command/,
        phase + " " + override(name)
      );
    }
  }
});

test("Storm exit parser rejects shell expansion and command chaining in EXPECT assignments", () => {
  const backtick = String.fromCharCode(96);
  for (const value of ["$(id)", backtick + "id" + backtick, "\${HOME}", "0; echo invalid", "0 && true"]) {
    const source = fixture.replace(/^EXPECT_TIMEOUT=.*$/m, "EXPECT_TIMEOUT=" + value);
    assert.throws(() => uniqueNumericExitAssignments(source), /unsafe shell assignment value/, value);
  }
});

test("Storm parser rejects duplicate non-exit keys that Bash would otherwise apply", () => {
  const mutants = [
    { key: "EXPECT_NEG_ARGS", assignment: "EXPECT_NEG_ARGS='--prism tests/storm/missing.pm --prop \"P<=0.5 [F s=7]\"'", index: 3,
      expected: '--prism tests/storm/missing.pm --prop "P<=0.5 [F s=7]"' },
    { key: "EXPECT_ERR_REGEX", assignment: "EXPECT_ERR_REGEX='MUTATED_ERROR_PATTERN'", index: 4, expected: "MUTATED_ERROR_PATTERN" },
    { key: "EXPECT_TIMEOUT", assignment: "EXPECT_TIMEOUT=1", index: 5, expected: "1" },
    { key: "EXPECT_NEG_LABEL", assignment: "EXPECT_NEG_LABEL=UNEXPECTED_LABEL", index: 6, expected: "UNEXPECTED_LABEL" }
  ];
  const directory = mkdtempSync(join(tmpdir(), "storm-expect-source-"));
  const path = join(directory, "expect.sh");
  const sourceWithBash = source => {
    writeFileSync(path, source);
    const command = 'set -euo pipefail; source "$1"; printf "%s\\n" "$EXPECT_POS_EXIT" "$EXPECT_NEG_EXIT" "$EXPECT_ERR_EXIT" "$EXPECT_NEG_ARGS" "$EXPECT_ERR_REGEX" "$EXPECT_TIMEOUT" "$EXPECT_NEG_LABEL"';
    return execFileSync("bash", ["-c", command, "storm-expect-source", path], { encoding: "utf8" }).trimEnd().split("\n");
  };
  try {
    assert.deepEqual(sourceWithBash(fixture), [
      "0", "0", "1",
      '--prism tests/storm/pos.pm --prop "P<=0.5 [F s=7]"',
      "Unable to read from (non-existing )?file", "180", "PROPERTY_FAILS"
    ]);
    for (const mutant of mutants) {
      const changed = fixture + "\n" + mutant.assignment + "\n";
      const bashValues = sourceWithBash(changed);
      assert.equal(bashValues[mutant.index], mutant.expected, mutant.key + " must demonstrate Bash last-assignment semantics");
      assert.throws(() => uniqueNumericExitAssignments(changed), new RegExp("duplicate EXPECT assignment " + mutant.key));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Storm fixture's positive and negative claims use the same committed DTMC model", () => {
  assert.match(model, /^dtmc/m);
  assert.match(model, /label "done" = s=7;/);
  assert.match(model, /\[\] s=0 -> 0\.5 : \(s'=1\) \+ 0\.5 : \(s'=2\);/);
});

test("the actual MCP stdio server initializes, exposes Storm, and fails closed without a pinned bundle", async t => {
  const env = { ...process.env };
  delete env.FORMAL_PORTABLE_ROOT;
  delete env.FORMAL_PORTABLE_RUNNER_SHA256;
  delete env.FORMAL_PORTABLE_META_SHA256;
  delete env.FORMAL_PORTABLE_FIXTURE_SHA256;

  const child = spawn(process.execPath, ["packages/runner/js/mcp.mjs"], {
    cwd: repoRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let buffer = "";
  let stderr = "";
  const pending = new Map();
  const failPending = error => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      pending.delete(id);
    }
  };
  child.stdout.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { failPending(new Error("MCP_STDOUT_NOT_JSON_LINE: " + line)); continue; }
      const waiter = pending.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  child.once("error", error => failPending(error));
  child.once("exit", (code, signal) => {
    failPending(new Error("MCP_SERVER_EXIT:" + code + ":" + signal + ":" + stderr));
  });
  t.after(() => { if (!child.killed) child.kill("SIGTERM"); });

  const request = (id, method, params = {}) => new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("MCP_RESPONSE_TIMEOUT:" + method + ":" + stderr));
    }, 8000);
    pending.set(id, { resolve: resolveResponse, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const notify = (method, params = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  };

  const initialized = await request(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "formal-tools-storm-ci", version: "0.1.0" }
  });
  assert.equal(initialized.jsonrpc, "2.0");
  assert.equal(initialized.result?.serverInfo?.name, "formal-tools-skill");
  notify("notifications/initialized");

  const listing = await request(2, "tools/list");
  const names = new Set((listing.result?.tools ?? []).map(tool => tool.name));
  assert.ok(names.has("list_portfolio_tools"));
  assert.ok(names.has("inspect_portfolio_tool"));
  assert.ok(names.has("verify_portable_fixture"));

  const inspected = await request(3, "tools/call", {
    name: "inspect_portfolio_tool",
    arguments: { tool: "storm" }
  });
  const inspection = JSON.parse(inspected.result?.content?.[0]?.text ?? "{}");
  assert.equal(inspection.id, "storm");
  assert.equal(inspection.status, "NOT_AVAILABLE_FAIL_CLOSED");
  assert.match(inspection.reason, /PORTABLE_ROOT_NOT_CONFIGURED/);

  const attempted = await request(4, "tools/call", {
    name: "verify_portable_fixture",
    arguments: { tool: "storm", timeout_s: 10 }
  });
  assert.equal(attempted.result?.isError, true);
  const failure = JSON.parse(attempted.result?.content?.[0]?.text ?? "{}");
  assert.equal(failure.status, "NOT_RUN_FAIL_CLOSED");
  assert.match(failure.reason, /PORTABLE_ROOT_NOT_CONFIGURED/);
});
