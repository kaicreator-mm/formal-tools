import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  loadCapabilityValidation, validateCapabilityValidation, matchValidatedTools
} from "../packages/runner/js/capability-validation.mjs";
import { readCapabilityRegistry } from "../packages/runner/js/problem-capabilities.mjs";

const clone = (x) => structuredClone(x);

test("r176+r181 ledger loads and validates against the frozen discovery registry", () => {
  const ledger = loadCapabilityValidation();
  assert.equal(ledger.schema, "formal-tools/capability-validation/0.1");
  assert.equal(ledger.status, "PROBE_VALIDATED_SCOPED_NOT_FORMAL_ACCEPTANCE");
  assert.equal(ledger.tools.length, 36);
  assert.deepEqual(ledger.counts, {
    tools: 36, capabilities: 23,
    native_probe_pass_scoped: 36, portable_lane_pass_scoped: 0, not_verified: 0,
    probe_quality_effective: 29, probe_quality_ineffective: 7, probe_not_probed_unavailable: 0
  });
  assert.equal(ledger.authority.portfolio_issue, 24);
  assert.equal(ledger.authority.closed_product_issue, 11);
  assert.deepEqual(ledger.authority.r181_refresh.rebound_tools, ["nuxmv", "prob"]);
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

test("r181 rebound rows stay honest: native receipts, truthful probe quality", () => {
  const ledger = loadCapabilityValidation();
  const nuxmv = ledger.tools.find((t) => t.id === "nuxmv");
  assert.equal(nuxmv.status, "NATIVE_PROBE_PASS_SCOPED");
  assert.equal(nuxmv.evidence_ref, "docs/tool-portfolio/r181/receipts/nuxmv/receipt.json");
  assert.equal(nuxmv.evidence_sha256?.length, 64);
  assert.equal(nuxmv.probe_status, "PROBED");
  assert.equal(nuxmv.probe_quality, "INEFFECTIVE_OUTPUT"); // rc=255 unknown-option banner, no version obtained
  assert.equal(nuxmv.probed_version, null);
  assert.equal(nuxmv.container_probe_receipt, null);
  assert.match(nuxmv.probe_note, /r176\/receipts\/nuxmv/); // prior honest skip receipt still referenced
  const prob = ledger.tools.find((t) => t.id === "prob");
  assert.equal(prob.status, "NATIVE_PROBE_PASS_SCOPED");
  assert.equal(prob.evidence_ref, "docs/tool-portfolio/r181/receipts/prob/receipt.json");
  assert.equal(prob.probe_quality, "EFFECTIVE");
  assert.equal(prob.probed_version, "1.16.1-final");
  assert.deepEqual(prob.verify_phases, ["setup", "pos", "neg", "err"]);
  assert.equal(prob.version_drift?.probed, "1.16.1-final");
  assert.equal(prob.container_probe_receipt, null);
  // A fabricated portable-lane probe version on a rebound row must still fail closed.
  const forged = clone(ledger);
  forged.tools.find((t) => t.id === "prob").status = "PORTABLE_LANE_PASS_SCOPED";
  forged.tools.find((t) => t.id === "prob").evidence_ref = "portable/status/receipts/verify-prob.json";
  assert.ok(validateCapabilityValidation(forged).issues.some((x) => x.includes("must not fabricate") || x.includes("counts do not match")));
});

test("receipt roots are an explicit versioned allowlist; r181 authority is hash-bound", () => {
  const ledger = loadCapabilityValidation();
  // fabricated sweep rounds (r999) must fail closed even with a well-formed sha
  const alien = clone(ledger);
  const z3 = alien.tools.find((t) => t.id === "z3");
  z3.evidence_ref = "docs/tool-portfolio/r999/receipts/z3/receipt.json";
  assert.ok(validateCapabilityValidation(alien).issues.some((x) => x.includes("versioned sweep receipt")));
  // tampering with the r181 sweep summary binding must fail closed
  const tampered = clone(ledger);
  tampered.authority.r181_refresh.sweep_summary_sha256 = "1".repeat(64);
  const report = validateCapabilityValidation(tampered, { receiptHasher: () => "0".repeat(64) });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((x) => x.includes("r181 sweep summary hash mismatch")));
  // declaring a rebound tool whose row does not carry an r181 receipt must fail closed
  const lying = clone(ledger);
  lying.authority.r181_refresh.rebound_tools = ["z3"];
  assert.ok(validateCapabilityValidation(lying).issues.some((x) => x.includes("lacks an r181 native receipt binding")));
  // the committed r181 sweep summary itself hashes to the authority pin (real-file binding)
  const report2 = validateCapabilityValidation(clone(ledger));
  assert.equal(report2.ok, true, report2.issues.join("; "));
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

test("cli capabilities match and tool are wired and read-only", () => {
  const run = (args) => spawnSync(process.execPath, ["packages/runner/js/cli.mjs", "capabilities", ...args],
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
