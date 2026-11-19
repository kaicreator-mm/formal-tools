import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Parity between the FORMAL_RESULT registry contract and the fixture results
 * the existing Runner actually emits (packages/runner/js/native.mjs
 * runFixture, surfaced unchanged through CLI run/suite and MCP
 * run_formal_fixture). No native tool, subprocess or network is used here:
 * documents are synthesized in the exact producer shape, and the producer
 * source is only read as text to anchor the parity.
 */
const schema = JSON.parse(readFileSync(new URL("../registry/FORMAL_RESULT.schema.json", import.meta.url), "utf8"));
const runnerSource = readFileSync(new URL("../packages/runner/js/native.mjs", import.meta.url), "utf8");

/** Minimal JSON Schema (2020-12) subset validator covering every keyword used
 * by FORMAL_RESULT.schema.json: type (incl. union with null), enum, const,
 * required, properties, additionalProperties (boolean or schema), items,
 * pattern, minLength, minimum. Returns a list of human-readable issues. */
/** @type {(schemaPart: any, value: any, path?: string) => string[]} */
function validate(schemaPart, value, path = "$") {
  const issues = [];
  if (schemaPart.const !== undefined && value !== schemaPart.const)
    return [`${path}: expected const ${JSON.stringify(schemaPart.const)}`];
  if (Array.isArray(schemaPart.enum) && !schemaPart.enum.includes(value))
    return [`${path}: ${JSON.stringify(value)} not in enum [${schemaPart.enum.join(", ")}]`];
  const types = Array.isArray(schemaPart.type) ? schemaPart.type : schemaPart.type ? [schemaPart.type] : [];
  if (types.length) {
    const actual = value === null ? "null"
      : Array.isArray(value) ? "array"
      : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number")
      : typeof value;
    if (!types.includes(actual)) return [`${path}: expected type ${types.join("|")}, got ${actual}`];
  }
  if (typeof value === "string") {
    if (schemaPart.minLength !== undefined && value.length < schemaPart.minLength)
      issues.push(`${path}: shorter than minLength ${schemaPart.minLength}`);
    if (schemaPart.pattern !== undefined && !new RegExp(schemaPart.pattern).test(value))
      issues.push(`${path}: ${JSON.stringify(value)} does not match ${schemaPart.pattern}`);
  }
  if (typeof value === "number" && schemaPart.minimum !== undefined && value < schemaPart.minimum)
    issues.push(`${path}: below minimum ${schemaPart.minimum}`);
  if (Array.isArray(value) && schemaPart.items) {
    value.forEach((entry, i) => issues.push(...validate(schemaPart.items, entry, `${path}[${i}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schemaPart.required ?? [])
      if (!Object.hasOwn(value, key)) issues.push(`${path}: missing required "${key}"`);
    const declared = new Set(Object.keys(schemaPart.properties ?? {}));
    for (const [key, entry] of Object.entries(value)) {
      if (Object.hasOwn(schemaPart.properties ?? {}, key)) {
        issues.push(...validate(schemaPart.properties[key], entry, `${path}.${key}`));
      } else if (schemaPart.additionalProperties === false) {
        issues.push(`${path}: undeclared additional property "${key}"`);
      } else if (schemaPart.additionalProperties && typeof schemaPart.additionalProperties === "object") {
        issues.push(...validate(schemaPart.additionalProperties, entry, `${path}.${key}`));
      } // else: free-form additional properties are allowed
    }
  }
  return issues;
}

const hex = (seed) => Buffer.from(String(seed).padStart(8, "0").repeat(8), "utf8").subarray(0, 32).toString("hex").padEnd(64, "0");
const step = (over = {}) => ({
  argv: ["z3", "-smt2", "positive.smt2"], exit_code: 0, signal: null, elapsed_ms: 12,
  timed_out: false, stdout: "unsat\n", stderr: "", stdout_sha256: hex("out"),
  stderr_sha256: hex("err"), error: null, output_truncated: false, ...over
});
/** Exact success-path shape of runFixture (native.mjs): spread of interpret()
 * plus claim_verdict, input_sha256, executions and the scope banner. */
const fixtureResult = (over = {}) => ({
  tool: "z3", case: "positive", run_status: "EXECUTED", tool_outcome: "UNSAT",
  test_verdict: "PASS", claim_verdict: "NOT_EVALUATED",
  input_sha256: { "positive.smt2": hex("input") },
  executions: [step()],
  scope: "committed fixture only; not a proof of a project requirement",
  ...over
});

test("FORMAL_RESULT schema declares the scope banner emitted by every successful runFixture", () => {
  // The Runner's success path always carries this field (native.mjs
  // runFixture return); the registry contract must accept it.
  assert.match(runnerSource, /scope:"committed fixture only; not a proof of a project requirement"/);
  assert.ok(Object.hasOwn(schema.properties, "scope"), "registry schema must declare scope");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(validate(schema, fixtureResult()), []);
});

test("combined multi-execution fixture results conform to the registry contract", () => {
  // apache-jena positive runs two allowlisted commands (riot validate, arq
  // query) and only the combined stdout decides the outcome.
  const combined = fixtureResult({
    tool: "apache-jena", tool_outcome: "QUERY_MATCH",
    input_sha256: { "data.ttl": hex("ttl"), "shapes.ttl": hex("shapes"), "query.rq": hex("rq") },
    executions: [
      step({ argv: ["riot", "--validate", "data.ttl"], stdout: "example.org/a\nexample.org/b\n" }),
      step({ argv: ["arq", "--data", "data.ttl", "--query", "query.rq"], stdout: "example.org/a\nexample.org/b\n" })
    ]
  });
  assert.equal(combined.executions.length, 2);
  assert.deepEqual(validate(schema, combined), []);
});

test("inconclusive and NOT_RUN error-path fixture results conform too", () => {
  const unparsed = fixtureResult({ tool: "cvc5", tool_outcome: "UNKNOWN", test_verdict: "INCONCLUSIVE" });
  assert.deepEqual(validate(schema, unparsed), []);
  // native.mjs early-return path when command planning fails.
  const launchFailure = {
    tool: "alloy", case: "positive", run_status: "NOT_RUN", tool_outcome: "ERROR",
    test_verdict: "INCONCLUSIVE", claim_verdict: "NOT_EVALUATED",
    error: "Configure FORMAL_ALLOY_JAR or FORMAL_ALLOY_BIN for Alloy Analyzer"
  };
  assert.deepEqual(validate(schema, launchFailure), []);
});

test("frozen 24x2 ADS observation class stays representable by the contract", () => {
  // The committed freeze (validation/ads24-native-2026-11-13/NATIVE_PAIR.json)
  // records sat/unsat, exit 0, empty stderr per solver; each observation is a
  // FORMAL_RESULT-shaped document. Reused as frozen evidence; never re-run.
  for (const outcome of [["SAT", "INCONCLUSIVE"], ["UNSAT", "PASS"]]) {
    const doc = fixtureResult({ tool_outcome: outcome[0], test_verdict: outcome[1] });
    assert.deepEqual(validate(schema, doc), []);
  }
});

test("registry contract still fails closed on undeclared or invalid documents", () => {
  assert.ok(validate(schema, { ...fixtureResult(), business_truth: "PROVED" })
    .some(x => x.includes("business_truth")), "undeclared extras must stay rejected");
  const { scope, ...withoutScope } = fixtureResult();
  assert.ok(!("scope" in withoutScope));
  assert.deepEqual(validate(schema, withoutScope), [], "scope stays optional: the NOT_RUN path omits it");
  assert.ok(validate(schema, { ...fixtureResult(), test_verdict: "PROVED" })
    .some(x => x.includes("enum")));
  assert.ok(validate(schema, { ...fixtureResult(), case: "inconclusive" })
    .some(x => x.includes("enum")), "case stays frozen to positive|negative");
  assert.ok(validate(schema, { ...fixtureResult(), executions: [{ ...step(), stdout_sha256: "zz" }] })
    .some(x => x.includes("does not match")));
  const { argv, ...digestOnly } = step();
  assert.ok(validate(schema, { ...fixtureResult(), executions: [digestOnly] })
    .some(x => x.includes("missing required")), "execution argv stays required");
  assert.ok(validate(schema, { ...fixtureResult(), input_sha256: { "p.smt2": "short" } })
    .some(x => x.includes("does not match")));
  assert.ok(validate(schema, { ...fixtureResult(), tool: "" })
    .some(x => x.includes("minLength")));
});
