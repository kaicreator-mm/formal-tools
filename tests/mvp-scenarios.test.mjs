import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { toolIds as nativeToolIds } from "../packages/runner/js/native-catalog.mjs";
import { planPortfolioOperation } from "../packages/runner/js/tool-portfolio-t4.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarios = JSON.parse(readFileSync(resolve(repoRoot, "docs/mvp/SCENARIOS.json"), "utf8"));
const dag = JSON.parse(readFileSync(resolve(repoRoot, "docs/tool-portfolio/r1/TOOL_PORTFOLIO_DAG.json"), "utf8"));
const capabilities = JSON.parse(readFileSync(resolve(repoRoot, "registry/PROBLEM_CAPABILITIES.json"), "utf8"));
const sha = s => createHash("sha256").update(s).digest("hex");
const dagVersion = Object.fromEntries(dag.tools.map(t => [t.slug, t.version]));
const knownTools = new Set([...nativeToolIds, ...capabilities.tools.map(t => t.id)]);

test("SCENARIOS.json parses with schema, version and honesty declarations", () => {
  assert.equal(scenarios.schema, "formal-tools/mvp-scenarios/1.0");
  assert.equal(typeof scenarios.version, "string");
  assert.match(scenarios.version, /^\d+\.\d+\.\d+$/);
  assert.equal(scenarios.output_label, "FORMAL_TOOLS_I180_V1_TOOL_READINESS");
  assert.equal(scenarios.issue, 181);
  assert.equal(scenarios.base_main_sha, "33bd3d0");
  assert.equal(typeof scenarios.honesty.user_operation_coverage_not_universal, "string");
  assert.ok(scenarios.honesty.user_operation_coverage_not_universal.length > 0);
  assert.equal(typeof scenarios.host.validated_at_utc, "string");
  assert.match(scenarios.host.validated_at_utc, /^\d{4}-\d{2}-\d{2}T/);
});

test("exactly 2 positive scenarios and at least 4 negatives", () => {
  assert.equal(scenarios.scenarios.length, 2);
  const positive = scenarios.scenarios.filter(s => s.kind === "positive");
  assert.equal(positive.length, 2);
  assert.ok(Array.isArray(scenarios.negatives) && scenarios.negatives.length >= 4);
  const ids = new Set(scenarios.negatives.map(n => n.id));
  for (const required of ["unknown-tool-id", "tampered-plan-hash", "timeout-budget-exhaustion", "tool-disagreement"])
    assert.ok(ids.has(required), "missing negative " + required);
});

test("every scenario declares tools, pins, inputs with expected verdict classes and host evidence", () => {
  for (const s of scenarios.scenarios) {
    assert.ok(Array.isArray(s.tools) && s.tools.length >= 1, s.id + " tools");
    for (const t of s.tools) assert.ok(knownTools.has(t), s.id + " unknown tool " + t);
    assert.ok(s.pins && Object.keys(s.pins).length >= 1, s.id + " pins");
    assert.ok(Array.isArray(s.inputs) && s.inputs.length >= 1, s.id + " inputs");
    for (const input of s.inputs) {
      assert.equal(typeof input.text, "string");
      assert.ok(input.text.length > 0, s.id + "/" + input.file + " empty text");
      assert.equal(input.bytes, Buffer.byteLength(input.text), s.id + "/" + input.file + " byte count");
      assert.equal(input.sha256, sha(input.text), s.id + "/" + input.file + " sha256");
      assert.equal(typeof input.intended_question, "string");
      assert.ok(input.intended_question.length > 0, s.id + "/" + input.file + " intended question");
      assert.equal(typeof input.expected_verdict_class, "string");
      assert.ok(input.expected_verdict_class.length > 0, s.id + "/" + input.file + " expected class");
    }
    assert.equal(typeof s.host_validated_evidence, "object");
    assert.match(String(s.host_validated_evidence.validated_at_utc), /^\d{4}-\d{2}-\d{2}T/,
      s.id + " host evidence date");
    // command records may be nested (e.g. manual_runner_reproduction / js_receipt_path)
    const commands = [];
    const walk = node => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === "object") {
        if (typeof node.cmd === "string" && Array.isArray(node.cmd) === false) commands.push(node);
        Object.values(node).forEach(walk);
      }
    };
    walk(s.host_validated_evidence);
    assert.ok(commands.length >= 2, s.id + " host evidence must contain real command records");
    for (const c of commands) {
      if ("exit_code" in c) assert.ok(Number.isInteger(c.exit_code), s.id + " evidence exit_code");
    }
    assert.ok(Array.isArray(s.negatives_ref) && s.negatives_ref.length >= 1, s.id + " negatives_ref");
  }
});

test("SMT input texts are non-empty and stay within the 4096-char scenario cap", () => {
  const smt = scenarios.scenarios.find(s => s.name === "smt-cross-check");
  assert.ok(smt, "scenario A present");
  assert.equal(smt.theory, "QF_LIA");
  for (const input of smt.inputs) {
    assert.ok(input.text.length <= 4096, input.file + " exceeds 4096 chars");
    assert.ok(input.text.includes("(check-sat)"), input.file + " missing check-sat");
    assert.ok(/^\(set-logic QF_LIA\)\n/.test(input.text), input.file + " must pin QF_LIA logic");
  }
  const classes = smt.inputs.map(i => i.expected_verdict_class);
  assert.deepEqual(classes.sort(), ["AGREE_SAT", "AGREE_UNSAT"]);
});

test("scenario A pins equal the DAG-pinned solver versions", () => {
  const smt = scenarios.scenarios.find(s => s.name === "smt-cross-check");
  assert.equal(smt.pins.z3.version, dagVersion.z3);
  assert.equal(smt.pins.cvc5.version, dagVersion.cvc5);
  assert.equal(dagVersion.z3, "5.4.0");
  assert.equal(dagVersion.cvc5, "1.4.2");
});

test("scenario B model texts pass the real planPortfolioOperation validator with exact hashes", () => {
  const lp = scenarios.scenarios.find(s => s.name === "highs-lp");
  assert.ok(lp, "scenario B present");
  const statuses = [];
  for (const input of lp.inputs) {
    const model = JSON.parse(input.text);
    const plan = planPortfolioOperation("highs", "solve-lp", model);
    assert.equal(plan.input_sha256, input.sha256, input.file + " plan hash must equal recorded sha256");
    assert.equal(plan.input_sha256, sha(input.text));
    assert.ok(plan.budget.max_variables === 64 && plan.budget.max_constraints === 128);
    statuses.push(input.expected.model_status);
  }
  assert.deepEqual(statuses.sort(), ["kInfeasible", "kOptimal"]);
  const feasible = lp.inputs.find(i => i.expected.model_status === "kOptimal");
  const infeasible = lp.inputs.find(i => i.expected.model_status === "kInfeasible");
  assert.equal(feasible.expected.objective, 12);
  assert.deepEqual(feasible.expected.variables, [4, 0]);
  assert.equal(infeasible.expected.objective, null);
  assert.deepEqual(infeasible.expected.variables, []);
  assert.equal(lp.pins.highs.version, dagVersion.highs);
  assert.equal(dagVersion.highs, "1.15.1");
});

test("scenario B pinned script sha equals the JS pin in tool-portfolio-t4.mjs", () => {
  const lp = scenarios.scenarios.find(s => s.name === "highs-lp");
  const source = readFileSync(resolve(repoRoot, "packages/runner/js/tool-portfolio-t4.mjs"), "utf8");
  const pin = source.match(/highsSolveScriptSha256="([a-f0-9]{64})"/)?.[1];
  assert.ok(pin, "pin constant found in source");
  assert.equal(lp.pinned_script.sha256, pin);
  const script = readFileSync(resolve(repoRoot, "portable/verification/cases/highs/solve-lp.py"));
  assert.equal(sha(script), pin, "repo script bytes must equal the recorded pin");
});

test("scenario A runner path honestly marks the typed operation as planned via #183", () => {
  const smt = scenarios.scenarios.find(s => s.name === "smt-cross-check");
  assert.equal(smt.runner_path.planned_issue, 183);
  assert.match(smt.runner_path.current_main, /No typed SMT portfolio operation exists in main/);
  const readiness = readFileSync(resolve(repoRoot, "docs/mvp/TOOL_OPERATION_READINESS.md"), "utf8");
  assert.match(readiness, /READY-VIA-V3-PLAN/);
  assert.match(readiness, /User-operation coverage is NOT universal/);
  assert.match(readiness, /\*\*1 \/ 36 READY\*\*/);
  assert.match(readiness, /\*\*33 \/ 36 FIXTURE_ONLY/);
});

test("every negative has id, trigger, expected behavior and evidence with honest attribution", () => {
  for (const n of scenarios.negatives) {
    assert.equal(typeof n.id, "string");
    assert.ok(n.applies_to.length >= 1);
    assert.equal(typeof n.trigger, "string");
    assert.ok(n.trigger.length > 0);
    assert.equal(typeof n.expected_behavior, "string");
    assert.match(n.expected_behavior, /fail-closed|NOT_RUN_FAIL_CLOSED|TOOL_DISAGREEMENT|UNKNOWN|PARSE_ERROR|TypeError/i);
    assert.ok(n.evidence && typeof n.evidence.where === "string");
    assert.ok(/live host run|committed test|comparator rule/.test(n.evidence.where),
      n.id + " evidence must be attributed to a live run or committed test");
  }
});

test("negatives reference registered failure modes that exist in the runner sources", () => {
  const portfolio = readFileSync(resolve(repoRoot, "packages/runner/js/tool-portfolio-t4.mjs"), "utf8");
  assert.match(portfolio, /unadmitted typed portfolio operation/);
  assert.match(portfolio, /PORTABLE_RUNNER_SHA256_MISMATCH/);
  assert.match(portfolio, /HIGHS_OPERATION_SCRIPT_SHA256_MISMATCH/);
  assert.match(portfolio, /timeoutS must be integer 1..30/);
});
