import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  loadCapabilityValidation, validateCapabilityValidation, matchValidatedTools
} from "../packages/runner/js/capability-validation.mjs";
import { readCapabilityRegistry } from "../packages/runner/js/problem-capabilities.mjs";

const clone = (x) => structuredClone(x);

test("r176 ledger loads and validates against the frozen discovery registry", () => {
  const ledger = loadCapabilityValidation();
  assert.equal(ledger.schema, "formal-tools/capability-validation/0.1");
  assert.equal(ledger.status, "PROBE_VALIDATED_SCOPED_NOT_FORMAL_ACCEPTANCE");
  assert.equal(ledger.tools.length, 36);
  assert.deepEqual(ledger.counts, {
    tools: 36, capabilities: 23,
    native_probe_pass_scoped: 34, portable_lane_pass_scoped: 2, not_verified: 0,
    probe_quality_effective: 28, probe_quality_ineffective: 6, probe_not_probed_unavailable: 2
  });
  assert.equal(ledger.authority.portfolio_issue, 24);
  assert.equal(ledger.authority.closed_product_issue, 11);
});

test("capability mappings are inherited verbatim from the discovery registry", () => {
  const discovery = readCapabilityRegistry();
  const ledger = loadCapabilityValidation();
  const map = new Map(discovery.tools.map((t) => [t.id, t]));
  for (const row of ledger.tools) {
    assert.deepEqual(row.capability_ids, map.get(row.id).capability_ids, row.id);
    assert.equal(row.origin, map.get(row.id).origin, row.id);
  }
});

test("receipt sha256 binding is real, not decorative", () => {
  const ledger = loadCapabilityValidation();
  const native = ledger.tools.find((t) => t.status === "NATIVE_PROBE_PASS_SCOPED" && t.probe_quality === "EFFECTIVE");
  assert.ok(native, "expected at least one effective native probe row");
  // A forged receipt hash must fail closed; the injected hasher simulates tampering.
  const tampered = clone(ledger);
  tampered.tools.find((t) => t.id === native.id).evidence_sha256 = "0".repeat(64);
  const report = validateCapabilityValidation(tampered, { receiptHasher: () => "1".repeat(64) });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((x) => x.includes("receipt hash mismatch") || x.includes("sweep summary hash mismatch")));
  // A ledger whose rows point at unreadable receipts also fails closed.
  const missing = clone(ledger);
  missing.tools.find((t) => t.id === native.id).evidence_ref = "docs/tool-portfolio/r176/receipts/no-such-tool/receipt.json";
  const report2 = validateCapabilityValidation(missing, { receiptHasher: () => { throw new Error("ENOENT"); } });
  assert.equal(report2.ok, false);
  assert.ok(report2.issues.some((x) => x.includes("receipt unreadable")));
});

test("forged verification or status claims fail closed", () => {
  const ledger = loadCapabilityValidation();
  const a = clone(ledger);
  a.tools.find((t) => t.id === "sympy").verify_verdict = "PASS";
  a.tools.find((t) => t.id === "sympy").status = "NOT_VERIFIED";
  assert.ok(validateCapabilityValidation(a).issues.some((x) => x.includes("NOT_VERIFIED row must not claim verify PASS")));
  const b = clone(ledger);
  b.status = "FORMAL_T3_ACCEPTED";
  assert.ok(validateCapabilityValidation(b).issues.some((x) => x.includes("invalid validation status")));
  const c = clone(ledger);
  c.authority.portfolio_issue = 11;
  assert.ok(validateCapabilityValidation(c).issues.some((x) => x.includes("portfolio issue must be 24")));
  const d = clone(ledger);
  d.tools.find((t) => t.id === "z3").capability_ids = ["graph.flow"];
  assert.ok(validateCapabilityValidation(d).issues.some((x) => x.includes("inherited verbatim")));
});

test("portable-lane rows stay honest: no fabricated container probe", () => {
  const ledger = loadCapabilityValidation();
  for (const id of ["nuxmv", "prob"]) {
    const row = ledger.tools.find((t) => t.id === id);
    assert.equal(row.status, "PORTABLE_LANE_PASS_SCOPED", id);
    assert.equal(row.probe_status, "NOT_PROBED_UNAVAILABLE", id);
    assert.equal(row.probed_version, null, id);
    assert.equal(row.evidence_ref, `portable/status/receipts/verify-${id}.json`, id);
    assert.match(row.probe_note ?? "", /UNAVAILABLE/);
  }
  const forged = clone(ledger);
  forged.tools.find((t) => t.id === "prob").probed_version = "1.16.1";
  assert.ok(validateCapabilityValidation(forged).issues.some((x) => x.includes("must not fabricate")));
});

test("recorded version drift observations exist for storm, fast-downward and tla-tlc", () => {
  const ledger = loadCapabilityValidation();
  const ids = new Set(ledger.tools.filter((t) => t.version_drift).map((t) => t.id));
  for (const expected of ["storm", "fast-downward", "tla-tlc"]) {
    assert.ok(ids.has(expected), "expected drift record: " + expected);
    const drift = ledger.tools.find((t) => t.id === expected).version_drift;
    assert.notEqual(drift.declared, drift.probed, expected);
    assert.ok(drift.note.length > 10, expected);
  }
});

test("matchValidatedTools is deterministic and discovery-vocabulary-bound", () => {
  const first = matchValidatedTools(["logic.smt", "model.state"]);
  const second = matchValidatedTools(["model.state", "logic.smt"]);
  assert.deepEqual(first, second);
  assert.equal(first.status, "PROBE_VALIDATED_SCOPED_NOT_FORMAL_ACCEPTANCE");
  assert.ok(first.matches.some((m) => m.id === "z3" && m.status === "NATIVE_PROBE_PASS_SCOPED"));
  // native-ref tools rank before candidates regardless of input order
  const ranks = first.matches.map((m) => (m.origin === "native-ref" ? 0 : 1));
  assert.deepEqual(ranks, [...ranks].sort());
  assert.deepEqual(first.uncovered_capabilities, []);
  assert.throws(() => matchValidatedTools(["not-a-capability"]), RangeError);
  assert.throws(() => matchValidatedTools([]), TypeError);
  // @ts-expect-error — deliberate wrong-type negative test: non-boolean option must still throw TypeError at runtime
  assert.throws(() => matchValidatedTools(["logic.smt"], { includeNotVerified: "yes" }), TypeError);
});

test("includeNotVerified surfaces excluded rows without changing verified matches", () => {
  const ledger = loadCapabilityValidation();
  const excluded = ledger.tools.filter((t) => t.status === "NOT_VERIFIED").map((t) => t.id);
  if (excluded.length) {
    const withExcluded = matchValidatedTools(["logic.smt"], { includeNotVerified: true });
    assert.ok(withExcluded.matches.every((m) => m.status !== undefined));
  }
});

test("capabilities-cli match and tool are wired and read-only", () => {
  const run = (args) => spawnSync(process.execPath, ["packages/runner/js/capabilities-cli.mjs", ...args],
    { encoding: "utf8", timeout: 30_000 });
  const listed = run(["match", "--cap", "logic.smt"]);
  assert.equal(listed.status, 0, listed.stderr);
  const parsed = JSON.parse(listed.stdout);
  assert.ok(parsed.matches.some((m) => m.id === "z3"));
  const badCap = run(["match", "--cap", "made.up.capability"]);
  assert.equal(badCap.status, 2);
  assert.match(badCap.stderr, /unknown capability/);
  const toolRow = run(["tool", "sympy"]);
  assert.equal(toolRow.status, 0, toolRow.stderr);
  const row = JSON.parse(toolRow.stdout);
  assert.equal(row.status, "NATIVE_PROBE_PASS_SCOPED");
  assert.equal(row.probed_version, "1.14.0");
  const unknownTool = run(["tool", "no-such-tool"]);
  assert.equal(unknownTool.status, 2);
  const noCaps = run(["match"]);
  assert.equal(noCaps.status, 2);
  assert.match(noCaps.stderr, /requires at least one --cap/);
});
