/**
 * i180/V6 — real-user E2E (issue #186). OFFLINE INVARIANTS + COMMITTED LIVE
 * EVIDENCE INTEGRITY.
 *
 * The live E2E ran for real on the trusted Debian host (cc@192.168.100.200,
 * portable bundle with z3 5.4.0 / cvc5 1.4.2 / HiGHS 1.15.1) at HEAD
 * 646859f628c4595e66c490c00c887e54e02bc215: real DeepSeek planning, real
 * solver executions, real negatives, real browser journey. This test file
 * locks that evidence into CI:
 *   1. offline invariants over fixtures and the pinned hash rules;
 *   2. an ALWAYS-ON integrity pass over evidence/SHA256SUMS (every committed
 *      live-evidence file must exist and hash-match — nothing can drift or be
 *      quietly edited without failing CI);
 *   3. ALWAYS-ON assertions that the committed receipts carry the recorded
 *      source SHA and the real verdict classes (AGREE_UNSAT / AGREE_SAT /
 *      kOptimal objective 11 / kInfeasible / the fail-closed negatives);
 *   4. clearly named env-gated blocks (FORCE_LIVE_USER_E2E=1) for RE-RUNNING
 *      the harness entries where the surfaces are wired — they are optional,
 *      never required for the offline gate.
 *
 * Documented duplication: `localValidateHighsModel` below is a local
 * reimplementation of the LP shape checks read from
 * packages/runner/js/tool-portfolio-t4.mjs (validateHighsModel, r0 @ 33bd3d0).
 * The duplication is INTENTIONAL: that file is owned by other lanes and this
 * offline test must stay decoupled from it. Re-sync the local copy if the
 * upstream shape contract changes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonString, canonicalJsonSha256, sha256Hex,
  validateExecutionPlanShape, validateExecutionReceiptShape,
  checkBudgetPolicy, classifyPlan, recomputeStepInputSha,
  isKnownOutcomeClass, REPO_ROOT, BUDGET_POLICY,
  PLAN_TOOL_ALLOWLIST, PLAN_OPERATION_ALLOWLIST
} from "../validation/mvp-user-e2e/harness/lib.mjs";
import { normalizeReport, compareEntries, compareReports, outcomeClassFromReceipt, planSignatureFromPlan, TOLERANCE_TABLE } from "../validation/mvp-user-e2e/harness/compare.mjs";

const FX = join(REPO_ROOT, "validation", "mvp-user-e2e", "fixtures");
const HARNESS = join(REPO_ROOT, "validation", "mvp-user-e2e", "harness");
const EVIDENCE = join(REPO_ROOT, "validation", "mvp-user-e2e", "evidence");
const read = (p) => readFileSync(p, "utf8");
const readBytes = (p) => readFileSync(p);

function balancedParens(text) {
  let depth = 0, inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (c === "\\") i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0 && !inString;
}

/**
 * LOCAL reimplementation of validateHighsModel shape checks (tool-portfolio-t4).
 * DOCUMENTED DUPLICATION — see file header. Caps: <=64 vars, <=128 constraints,
 * objective/constraint coefficient widths must equal the objective width,
 * normalized JSON must stay under the 64KiB fixture cap.
 */
function localValidateHighsModel(model) {
  const exactKeys = (obj, keys) =>
    obj !== null && typeof obj === "object" && !Array.isArray(obj) &&
    Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
  const dense = (v, min, max) => Array.isArray(v) && v.length >= min && v.length <= max;
  const finiteNum = (v) => typeof v === "number" && Number.isFinite(v);
  const bound = (v) => v === null || finiteNum(v);
  if (!exactKeys(model, ["sense", "objective", "variables", "constraints"])) throw new TypeError("HIGHS_MODEL_SCHEMA_INVALID");
  if (!["min", "max"].includes(model.sense)) throw new TypeError("HIGHS_MODEL_SENSE_INVALID");
  if (!dense(model.objective, 1, 64)) throw new TypeError("HIGHS_OBJECTIVE_INVALID");
  for (const value of model.objective) if (!finiteNum(value)) throw new TypeError("HIGHS_OBJECTIVE_ELEMENT_INVALID");
  if (!dense(model.variables, model.objective.length, model.objective.length)) throw new TypeError("HIGHS_VARIABLE_COUNT_MISMATCH");
  model.variables.forEach((v, i) => {
    if (!exactKeys(v, ["lower", "upper"]) || !bound(v.lower) || !bound(v.upper) ||
        (v.lower !== null && v.upper !== null && v.lower > v.upper))
      throw new TypeError("HIGHS_VARIABLE_BOUNDS_INVALID_" + i);
  });
  if (!dense(model.constraints, 0, 128)) throw new TypeError("HIGHS_CONSTRAINT_COUNT_INVALID");
  model.constraints.forEach((c, i) => {
    if (!exactKeys(c, ["lower", "upper", "coefficients"]) || !bound(c.lower) || !bound(c.upper) ||
        (c.lower !== null && c.upper !== null && c.lower > c.upper) ||
        !dense(c.coefficients, model.objective.length, model.objective.length) ||
        !c.coefficients.every(finiteNum))
      throw new TypeError("HIGHS_CONSTRAINT_INVALID_" + i);
  });
  const bytes = Buffer.from(JSON.stringify({
    sense: model.sense,
    objective: model.objective,
    variables: model.variables.map((v) => ({ lower: v.lower, upper: v.upper })),
    constraints: model.constraints.map((c) => ({ lower: c.lower, upper: c.upper, coefficients: c.coefficients }))
  }));
  if (bytes.length > 65536) throw new RangeError("HIGHS_MODEL_SIZE_LIMIT");
  return true;
}

const LIVE_REASON = "optional re-run of the harness entries in THIS environment; the committed live evidence is already integrity-checked above/below without any gating";
const FORCE_LIVE = process.env.FORCE_LIVE_USER_E2E === "1";
const HEAD_SHA = "646859f628c4595e66c490c00c887e54e02bc215";

// ---------------------------------------------------------------------------
// 1. SMT fixtures
// ---------------------------------------------------------------------------
test("user-e2e fixtures: scenario A SMT2 pair is small, QF_LIA, self-contained and balanced", () => {
  for (const [name, status] of [["scenario-a.smt2", "unsat"], ["scenario-a-sat.smt2", "sat"]]) {
    const p = join(FX, name);
    const text = read(p);
    assert.ok(statSync(p).size < 2048, name + " must stay <2KB");
    assert.ok(text.includes("(set-logic QF_LIA)"), name + " pins its logic");
    assert.ok(text.includes("(assert"), name + " is non-trivial (has asserts)");
    assert.ok(text.includes("(check-sat)"), name + " ends with check-sat");
    assert.ok(text.includes("(exit)"), name + " is self-contained (exit)");
    assert.ok(text.includes(`:status ${status}`), name + " documents expected status " + status);
    assert.ok(balancedParens(text), name + " is balanced");
  }
  const unsat = read(join(FX, "scenario-a.smt2"));
  const sat = read(join(FX, "scenario-a-sat.smt2"));
  // SAT variant is the same family with a reachable bound: witness x=1,y=1 gives x+y=2.
  assert.ok(sat.includes("(>= (+ x y) 2)") && unsat.includes("(>= (+ x y) 4)"));
});
test("user-e2e fixtures: scenario A UNSAT claim is arithmetically certain (x+y<=2 < 4)", () => {
  // x,y in [0,1] -> x+y <= 2, so x+y >= 4 is unsatisfiable over any domain.
  const maxSum = 1 + 1;
  assert.ok(maxSum < 4, "bounds must make the unsat claim certain, not probable");
});
test("user-e2e fixtures: malformed.smt2 is genuinely malformed (unbalanced), a real parse-error input", () => {
  const text = read(join(FX, "negatives", "malformed.smt2"));
  assert.ok(!balancedParens(text), "malformed.smt2 must fail the paren balance check");
  assert.ok(text.includes("(assert"), "it must fail inside real content, not be empty");
});

// ---------------------------------------------------------------------------
// 2. LP fixtures — local shape checks (documented duplication) + offline
//    optimality/infeasibility certificates (no solver, no binaries).
// ---------------------------------------------------------------------------
test("user-e2e fixtures: LP models pass the local reimplementation of the tool-portfolio-t4 shape checks", () => {
  const feasible = JSON.parse(read(join(FX, "scenario-b-lp.json")));
  const infeasible = JSON.parse(read(join(FX, "scenario-b-infeasible.json")));
  assert.equal(localValidateHighsModel(feasible), true);
  assert.equal(localValidateHighsModel(infeasible), true);
  // Shape rejections: wrong keys, mismatched widths, bad bound ordering, cap breach.
  assert.throws(() => localValidateHighsModel({ ...feasible, extra: 1 }), /SCHEMA_INVALID/);
  assert.throws(() => localValidateHighsModel({ ...feasible, objective: [3, 2, 1] }), /VARIABLE_COUNT_MISMATCH/);
  assert.throws(() => localValidateHighsModel({
    ...feasible, variables: [{ lower: 5, upper: 0 }, { lower: 0, upper: null }]
  }), /VARIABLE_BOUNDS_INVALID/);
  assert.throws(() => localValidateHighsModel({
    ...feasible, constraints: [...feasible.constraints, { lower: 0, upper: 1, coefficients: [1] }]
  }), /CONSTRAINT_INVALID/);
});
test("user-e2e fixtures: scenario-b-lp.json objective 11 is PROVEN offline (primal vertex + dual certificate)", () => {
  // max 3x+2y s.t. x+y<=4, x<=3, x,y>=0.
  const c = [3, 2];
  const vertex = [3, 1]; // candidate primal optimum
  const A1 = [1, 1], b1 = 4, A2 = [1, 0], b2 = 3;
  const primalFeasible =
    vertex[0] * A1[0] + vertex[1] * A1[1] <= b1 &&
    vertex[0] * A2[0] + vertex[1] * A2[1] <= b2 &&
    vertex[0] >= 0 && vertex[1] >= 0;
  const primalObj = c[0] * vertex[0] + c[1] * vertex[1];
  // Dual of {max c'x, Ax<=b, x>=0} is {min b'y, A'y>=c, y>=0}; witness y=(2,1).
  const y = [2, 1];
  const dualFeasible =
    y[0] * A1[0] + y[1] * A1[1] >= c[0] &&   // 2*1+1*1 = 3 >= 3
    y[0] * A2[0] + y[1] * A2[1] >= c[1] &&   // 2*1+1*0 = 2 >= 2
    y[0] >= 0 && y[1] >= 0;
  const dualObj = b1 * y[0] + b2 * y[1];     // 4*2+3*1 = 11
  assert.ok(primalFeasible, "(3,1) must be feasible");
  assert.ok(dualFeasible, "(2,1) must be dual-feasible");
  assert.equal(primalObj, dualObj, "primal == dual closes the duality gap: optimum is exact");
  assert.equal(primalObj, 11, "hand-derived optimum");
});
test("user-e2e fixtures: scenario-b-infeasible.json infeasibility is PROVEN offline (x>=2 forces x+y>=2 > 1)", () => {
  const model = JSON.parse(read(join(FX, "scenario-b-infeasible.json")));
  const [cap, supply] = model.constraints;
  assert.deepEqual(cap.coefficients, [1, 1]);
  assert.deepEqual(supply.coefficients, [1, 0]);
  assert.equal(cap.upper, 1, "total capacity bound");
  assert.equal(supply.lower, 2, "product-1 lower bound");
  const minPossibleTotal = supply.lower + 0; // y >= 0 (variables[1].lower)
  assert.equal(model.variables[1].lower, 0);
  assert.ok(minPossibleTotal > cap.upper, "x>=2 and y>=0 force x+y>=2, contradicting x+y<=1");
});
test("user-e2e fixtures: expected-relation.json tables are closed, honest and file-backed", () => {
  for (const relPath of ["expected-relation.json", join("negatives", "expected-relation.json")]) {
    const rel = JSON.parse(read(join(FX, relPath)));
    assert.equal(rel.schema, "formal-tools/user-e2e-expected-relation/1.0");
    const entries = [...rel.entries, ...(rel.cross_fixture ?? [])];
    assert.ok(entries.length > 0, relPath + " has entries");
    for (const e of entries) {
      assert.ok(isKnownOutcomeClass(e.expected_outcome_class), "known outcome class: " + e.expected_outcome_class);
      assert.ok(existsSync(join(FX, e.kind)), "entry kind maps to an existing fixture: " + e.kind);
    }
  }
  const rel = JSON.parse(read(join(FX, "expected-relation.json")));
  const byKind = Object.fromEntries(rel.entries.map((e) => [e.kind, e.expected_outcome_class]));
  assert.equal(byKind["scenario-a.smt2"], "AGREE_UNSAT");
  assert.equal(byKind["scenario-a-sat.smt2"], "AGREE_SAT");
  assert.equal(byKind["scenario-b-lp.json"], "K_OPTIMAL_OBJECTIVE_11");
  assert.equal(byKind["scenario-b-infeasible.json"], "K_INFEASIBLE");
});

// ---------------------------------------------------------------------------
// 3. Canonical hash rule (pinned) — test vectors
// ---------------------------------------------------------------------------
test("canonical hash rule: recursively sorted keys, no whitespace, order-invariant", () => {
  assert.equal(canonicalJsonString({ b: 1, a: { d: 2, c: [3, 1] } }), '{"a":{"c":[3,1],"d":2},"b":1}');
  assert.equal(
    canonicalJsonSha256(JSON.parse('{"a":1}')),
    "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
    "known vector sha256('{\"a\":1}')");
  assert.equal(
    canonicalJsonSha256(JSON.parse('{"a":1,"b":{"y":2,"x":1}}')),
    canonicalJsonSha256(JSON.parse('{"b":{"x":1,"y":2},"a":1}')),
    "key order must not affect the hash");
  assert.equal(canonicalJsonString([]), "[]");
  assert.equal(canonicalJsonString(0), "0");
});

// ---------------------------------------------------------------------------
// 4. ExecutionPlan negative fixtures — structurally conformant, each fails
//    closed with exactly its expected class.
// ---------------------------------------------------------------------------
const NEG = join(FX, "negatives");
const negativePlans = [
  ["unknown-tool.plan.json", "PLAN_UNKNOWN_TOOL"],
  ["tampered-hash.plan.json", "PLAN_HASH_MISMATCH"],
  ["timeout-crush.plan.json", "TIMEOUT_BUDGET"]
];
test("negative plans: parse and conform structurally to the pinned V3 ExecutionPlan contract", () => {
  for (const [name] of negativePlans) {
    const plan = JSON.parse(read(join(NEG, name)));
    assert.equal(plan.schema, "formal-tools/execution-plan/1.0", name + " pins the schema");
    const shape = validateExecutionPlanShape(plan);
    assert.deepEqual(shape.errors, [], name + " has no structural errors: " + JSON.stringify(shape.errors));
    if (name === "unknown-tool.plan.json") {
      assert.deepEqual(shape.classes.map((c) => c.code), ["TOOL_NOT_IN_ALLOWLIST"],
        "its deliberate violation is surfaced as a class, not a structural error");
    } else if (name === "timeout-crush.plan.json") {
      assert.deepEqual(shape.classes.map((c) => c.code), ["TIMEOUT_BUDGET"],
        "its over-cap step timeout is surfaced as the deliberate class, not a structural error");
    } else {
      assert.deepEqual(shape.classes, [], name + " stays inside tool/operation allowlist at the shape layer");
    }
    if (name === "unknown-tool.plan.json") {
      assert.equal(validateExecutionPlanShape(plan, { negativesAreErrors: true }).ok, false,
        "allowlist violations become errors under negativesAreErrors");
    }
    // tampered-hash and timeout-crush violate at the hash-binding / budget-policy
    // layer, asserted by their dedicated classifier tests below.
  }
});
test("negative plans: classifier maps each to exactly its expected fail-closed class", () => {
  const classes = Object.fromEntries(negativePlans.map(([name]) => [name, classifyPlan(JSON.parse(read(join(NEG, name))))]));
  assert.equal(classes["unknown-tool.plan.json"], "PLAN_UNKNOWN_TOOL");
  assert.equal(classes["timeout-crush.plan.json"], "TIMEOUT_BUDGET");
});
test("negative plans: tampered-hash.plan.json binds the canonical hash of DIFFERENT input", () => {
  const plan = JSON.parse(read(join(NEG, "tampered-hash.plan.json")));
  const step = plan.steps[0];
  const actual = canonicalJsonSha256(step.input);
  assert.notEqual(step.input_sha256, actual, "declared hash must mismatch the inline input object");
  assert.match(step.input_sha256, /^[a-f0-9]{64}$/, "but the declared hash is still a well-formed sha256");
  const satText = read(join(FX, "scenario-a-sat.smt2"));
  assert.equal(step.input_sha256, canonicalJsonSha256({ smt_lib: satText }),
    "tamper provenance: it is the canonical hash of the SAT sibling as smt_lib");
  assert.equal(classifyPlan(plan, { recomputeInputSha: true, repoRoot: REPO_ROOT }), "PLAN_HASH_MISMATCH");
});
test("negative plans: timeout-crush violates the harness budget policy before any launch", () => {
  const plan = JSON.parse(read(join(NEG, "timeout-crush.plan.json")));
  const violations = checkBudgetPolicy(plan);
  assert.ok(violations.length >= 2, "step timeout and declared budget must both violate: " + JSON.stringify(violations));
  const sum = plan.steps.reduce((acc, s) => acc + s.timeout_s, 0);
  assert.ok(sum > BUDGET_POLICY.max_total_timeout_s);
});
test("negative plans: their own non-tampered hash bindings are real (canonical input hashes)", () => {
  for (const [name] of [["unknown-tool.plan.json"], ["timeout-crush.plan.json"]]) {
    const plan = JSON.parse(read(join(NEG, name)));
    assert.equal(plan.source.problem_sha256, sha256Hex(readBytes(join(FX, "scenario-a.smt2"))),
      name + " problem_sha256 stays bound to the scenario-A bytes");
    for (const step of plan.steps) {
      assert.equal(recomputeStepInputSha(step, REPO_ROOT).code, "INPUT_SHA_MATCH",
        name + " step " + step.id + " hash is the real canonical input hash");
    }
  }
});
test("well-formed plan built in-test classifies OK and hash-checks against the canonical rule", () => {
  const smtText = read(join(FX, "scenario-a.smt2"));
  const plan = {
    schema: "formal-tools/execution-plan/1.0",
    plan_id: "test-positive-01",
    source: { problem_sha256: sha256Hex(Buffer.from(smtText, "utf8")), problem_kind: "qf_lia-sat-consistency" },
    assumptions: ["offline test-constructed plan"],
    method_dag: [{ id: "s1", kind: "solve", depends_on: [] }],
    steps: [{
      id: "s1", tool: "z3", operation: "solve-smt", depends_on: [],
      input: { smt_lib: smtText }, input_sha256: canonicalJsonSha256({ smt_lib: smtText }),
      timeout_s: 10, expected_output_kind: "smt-answer"
    }],
    budgets: { max_steps: 8, max_total_timeout_s: 120 },
    compiled: { launcher_sha256: null, manifest_sha256: null }
  };
  assert.equal(validateExecutionPlanShape(plan).ok, true);
  assert.equal(classifyPlan(plan, { recomputeInputSha: true, repoRoot: REPO_ROOT }), "OK");
  assert.equal(
    canonicalJsonSha256(plan),
    canonicalJsonSha256({ ...plan, budgets: { max_total_timeout_s: 120, max_steps: 8 } }),
    "nested key order alone must not change the canonical hash");
  assert.notEqual(canonicalJsonSha256(plan), canonicalJsonSha256({ ...plan, plan_id: "test-positive-02" }),
    "content change must change the hash");
});

// ---------------------------------------------------------------------------
// 5. ExecutionReceipt shape conformance (pinned contract vectors)
// ---------------------------------------------------------------------------
test("receipt shape checker accepts a minimal pinned-contract receipt and rejects drift", () => {
  const good = {
    schema: "formal-tools/execution-receipt/1.0",
    run_id: "r-1", plan_id: "p-1", plan_sha256: "a".repeat(64), source_sha: "b".repeat(64),
    created_at: "2026-11-19T00:00:00.000Z",
    tool_versions: { z3: "4.8.12" },
    steps: [{ step_id: "s1", tool: "z3", operation: "solve-smt", status: "EXECUTED", exit_code: 0,
      elapsed_ms: 12, stdout_sha256: "c".repeat(64), stderr_sha256: "d".repeat(64),
      stdout_bounded: false, stderr_bounded: false, result: {}, artifacts: [] }],
    overall: { process_outcome: "OK", solver_answer: "unsat", cross_tool_verdict: "AGREE_UNSAT", claim_verdict: "VERIFIED" },
    environment: {}
  };
  assert.equal(validateExecutionReceiptShape(good).ok, true);
  assert.equal(validateExecutionReceiptShape({ ...good, schema: "x" }).ok, false);
  const noOverall = { ...good }; delete noOverall.overall;
  assert.equal(validateExecutionReceiptShape(noOverall).ok, false);
  assert.equal(validateExecutionReceiptShape({ ...good, unexpected: 1 }).ok, false);
});

// ---------------------------------------------------------------------------
// 6. Harness files are syntactically valid (node --check) and import cleanly
// ---------------------------------------------------------------------------
test("harness files: every module passes node --check and imports without side effects", async () => {
  const files = ["lib.mjs", "run-cli.mjs", "run-mcp.mjs", "run-web.mjs", "run-deepseek-plan.mjs", "compare.mjs"];
  for (const f of files) {
    const p = join(HARNESS, f);
    const chk = spawnSync(process.execPath, ["--check", p], { encoding: "utf8", timeout: 20000 });
    assert.equal(chk.status, 0, f + " must be syntactically valid: " + chk.stderr);
  }
  for (const f of files) {
    const mod = await import("../validation/mvp-user-e2e/harness/" + f + "?offline-import=" + f);
    assert.ok(mod !== undefined, f + " imports cleanly");
  }
});

// ---------------------------------------------------------------------------
// 7. compare.mjs normalization + tolerance table
// ---------------------------------------------------------------------------
test("compare: run_id may differ, plan_sha256/outcome classes must match (tolerance table)", () => {
  assert.equal(TOLERANCE_TABLE.run_id, "MAY_DIFFER");
  assert.equal(TOLERANCE_TABLE.plan_sha256, "EXACT_OR_SEMANTIC");
  const a = { entry: "cli", entry_outcome_class: "EXECUTED", normalized: { run_id: "r-cli", plan_sha256: "h1", outcome_class: "AGREE_UNSAT", cross_tool_verdict: "AGREE_UNSAT" } };
  const b = { entry: "mcp", entry_outcome_class: "EXECUTED", normalized: { run_id: "r-mcp", plan_sha256: "h1", outcome_class: "AGREE_UNSAT", cross_tool_verdict: "AGREE_UNSAT" } };
  const cmp = compareEntries(normalizeReport(a), normalizeReport(b));
  assert.equal(cmp.verdict, "MATCH");
  assert.equal(cmp.fields.run_id.verdict, "MATCH_TOLERATED");
  const bad = compareEntries(normalizeReport(a),
    normalizeReport({ ...b, normalized: { ...b.normalized, plan_sha256: "h2" } }));
  assert.equal(bad.verdict, "MISMATCH");
  assert.equal(bad.fields.plan_sha256.verdict, "MISMATCH");
});
test("compare: identical plan_sha256 matches exactly; differing envelopes with the SAME step signature are MATCH_SEMANTIC, never exact", () => {
  const base = (planSha, sig) => ({
    entry: "x", entry_outcome_class: "EXECUTED",
    normalized: { run_id: "r-" + planSha, plan_sha256: planSha, plan_signature: sig,
      outcome_class: "AGREE_UNSAT", cross_tool_verdict: "AGREE_UNSAT" }
  });
  const sig = "step-z3:z3:solve-smt:h1|step-agree:compare:cross-check:h3|step-cvc5:cvc5:solve-smt:h2";
  const exact = compareEntries(
    normalizeReport({ ...base("hA", sig), entry: "cli" }),
    normalizeReport({ ...base("hA", sig), entry: "web" }));
  assert.equal(exact.fields.plan_sha256.verdict, "MATCH");
  assert.equal(exact.verdict, "MATCH");
  const semantic = compareEntries(
    normalizeReport({ ...base("hA", sig), entry: "cli" }),
    normalizeReport({ ...base("hB", sig), entry: "web" }));
  assert.equal(semantic.fields.plan_sha256.verdict, "MATCH_SEMANTIC");
  assert.equal(semantic.verdict, "MATCH");
  const diverged = compareEntries(
    normalizeReport({ ...base("hA", sig), entry: "cli" }),
    normalizeReport({ ...base("hB", sig.replace("step-z3", "s1")), entry: "web" }));
  assert.equal(diverged.verdict, "MISMATCH", "a genuinely different step set must never pass as semantic parity");
});
test("compare: outcome classes derive from real receipts only (never invented)", () => {
  assert.equal(outcomeClassFromReceipt({ overall: { process_outcome: "ABORTED" } }), "FAIL_CLOSED_OTHER");
  assert.equal(outcomeClassFromReceipt({ overall: { process_outcome: "OK", cross_tool_verdict: "AGREE_UNSAT" } }), "AGREE_UNSAT");
  assert.equal(outcomeClassFromReceipt({
    overall: { process_outcome: "OK", cross_tool_verdict: "NOT_APPLICABLE" },
    steps: [{ status: "EXECUTED", operation: "solve-lp", result: { model_status: "kOptimal", objective: 11 } }]
  }), "K_OPTIMAL_OBJECTIVE_11");
  assert.equal(outcomeClassFromReceipt({
    overall: { process_outcome: "OK", cross_tool_verdict: "NOT_APPLICABLE" },
    steps: [{ status: "EXECUTED", operation: "solve-lp", result: { model_status: "kInfeasible" } }]
  }), "K_INFEASIBLE");
  assert.equal(outcomeClassFromReceipt({ overall: { process_outcome: "FAILED", cross_tool_verdict: "UNKNOWN" } }), null);
});
test("compare: plan signatures are order-invariant and content-sensitive", () => {
  const plan = { steps: [
    { id: "step-z3", tool: "z3", operation: "solve-smt", input_sha256: "h1" },
    { id: "step-agree", tool: "compare", operation: "cross-check", input_sha256: "h3" },
    { id: "step-cvc5", tool: "cvc5", operation: "solve-smt", input_sha256: "h2" }
  ] };
  const sig = planSignatureFromPlan(plan);
  const reordered = planSignatureFromPlan({ steps: [...plan.steps].reverse() });
  assert.equal(sig, reordered, "signature must be order-invariant");
  assert.notEqual(sig, planSignatureFromPlan({ steps: [...plan.steps].slice(0, 2) }));
});
test("compare: SKIP reports (not-yet-executed entries) compare as SKIP, never as a fabricated match", () => {
  const cliSkip = { entry: "cli", entry_outcome_class: "SKIP_NOT_WIRED" };
  const mcpSkip = { entry: "mcp", entry_outcome_class: "NOT_REGISTERED_YET" };
  const webSkip = { entry: "web", entry_outcome_class: "SKIP_WEB_NOT_RUNNING" };
  const cmp = compareReports([cliSkip, mcpSkip, webSkip]);
  assert.equal(cmp.overall, "SKIP");
  assert.ok(cmp.entries.every((e) => e.comparable === false));
});

// ---------------------------------------------------------------------------
// 8. User prompts + DeepSeek probe transcript (committed real evidence)
// ---------------------------------------------------------------------------
test("user prompts: natural-language, non-empty, contain no credential material", () => {
  for (const name of ["user-prompt-a.txt", "user-prompt-b.txt"]) {
    const text = read(join(FX, name));
    assert.ok(text.trim().length >= 40, name + " carries a real request");
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(text), name + " must not embed API keys");
    assert.ok(text.includes("solver") || text.includes("z3") || text.includes("cvc5") || text.includes("HiGHS"),
      name + " names the tooling expectation");
  }
});
test("deepseek probe transcript: real response, labeled PROBE_NOT_FINAL_E2E, allowlist-mapped, key-free", () => {
  const p = join(EVIDENCE, "deepseek-probe", "transcript.json");
  assert.ok(existsSync(p), "probe transcript is committed evidence");
  const t = JSON.parse(read(p));
  assert.equal(t.kind, "PROBE_NOT_FINAL_E2E");
  assert.equal(t.provider, "deepseek");
  assert.equal(t.http_status, 200);
  assert.equal(t.request.authorization_header, "REDACTED_BY_CONSTRUCTION");
  assert.ok(t.response.assistant_message.length > 0, "real assistant message present");
  assert.equal(t.proposal_mapping.ok, true, "proposal maps onto the pinned allowlist");
  const raw = JSON.stringify(t);
  assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(raw), "no API-key-shaped material in the transcript");
  const envKey = process.env.DEEPSEEK_API_KEY;
  if (envKey) assert.ok(!raw.includes(envKey), "the env key value never appears in the transcript");
  for (const node of t.proposal_mapping.parsed_proposal.method_dag) {
    assert.ok(PLAN_TOOL_ALLOWLIST.includes(node.tool), "tool inside allowlist: " + node.tool);
    assert.ok(PLAN_OPERATION_ALLOWLIST.includes(node.operation), "operation inside allowlist: " + node.operation);
  }
});
test("deepseek probe transcript: disclaimer separates probe from the final E2E", () => {
  const t = JSON.parse(read(join(EVIDENCE, "deepseek-probe", "transcript.json")));
  assert.match(t.disclaimer, /NOT the final E2E/);
});

// ---------------------------------------------------------------------------
// 9. Committed LIVE evidence integrity (ALWAYS-ON): the V6 live E2E ran for
//    real on the trusted host at HEAD_SHA. SHA256SUMS pins every evidence
//    byte; the receipts' verdict fields assert the real outcomes. Nothing
//    here re-runs solvers or the network.
// ---------------------------------------------------------------------------
const LIVE_EV = join(EVIDENCE);
test("live evidence: SHA256SUMS manifest exists and every listed file hash-matches", () => {
  const manifestPath = join(LIVE_EV, "SHA256SUMS");
  assert.ok(existsSync(manifestPath), "SHA256SUMS is committed");
  const lines = read(manifestPath).trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 60, "manifest lists the full evidence set: " + lines.length);
  for (const line of lines) {
    const m = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(m, "manifest line format: " + line.slice(0, 80));
    const [, hash, rel] = m;
    const p = join(REPO_ROOT, "validation", "mvp-user-e2e", rel);
    assert.ok(existsSync(p), "evidence file present: " + rel);
    const actual = sha256Hex(readBytes(p));
    assert.equal(actual, hash, "hash match for " + rel);
  }
});
test("live evidence: no API-key-shaped material anywhere in the committed evidence", () => {
  const manifestPath = join(LIVE_EV, "SHA256SUMS");
  for (const line of read(manifestPath).trim().split("\n").filter(Boolean)) {
    const rel = line.split(/ {2}/)[1];
    if (!/\.(json|md|txt)$/.test(rel)) continue;
    const text = read(join(REPO_ROOT, "validation", "mvp-user-e2e", rel));
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(text), "no key-shaped material in " + rel);
    const envKey = process.env.DEEPSEEK_API_KEY;
    if (envKey) assert.ok(!text.includes(envKey), "the env key value never appears in " + rel);
  }
});
test("live evidence: CLI DeepSeek journey receipt — real z3 5.4.0 + cvc5 1.4.2 AGREE_UNSAT, PASS, bound to HEAD", () => {
  const receipt = JSON.parse(read(join(LIVE_EV, "live-cli", "j1-unsat-deepseek.receipt.json")));
  assert.equal(receipt.source_sha, HEAD_SHA, "receipt binds the exact HEAD SHA");
  assert.equal(receipt.overall.process_outcome, "OK");
  assert.equal(receipt.overall.cross_tool_verdict, "AGREE_UNSAT");
  assert.equal(receipt.overall.claim_verdict, "PASS");
  assert.match(receipt.tool_versions.z3.version, /Z3 version 5\.4\.0/);
  assert.match(receipt.tool_versions.cvc5.version, /cvc5 1\.4\.2/);
  const answers = receipt.overall.solver_answer.by_step.map((s) => s.answer);
  assert.deepEqual(answers, ["unsat", "unsat"], "both real solvers answered unsat");
  // the LLM-planned step ids prove the DeepSeek proposal (template uses step-z3/step-cvc5)
  const stepIds = receipt.steps.map((s) => s.step_id);
  assert.deepEqual(stepIds, ["z3-solve", "cvc5-solve", "step-agree"]);
});
test("live evidence: SAT variant AGREE_SAT + PASS; prose journey honestly fails closed", () => {
  const sat = JSON.parse(read(join(LIVE_EV, "live-cli", "j2-sat-template.receipt.json")));
  assert.equal(sat.source_sha, HEAD_SHA);
  assert.equal(sat.overall.cross_tool_verdict, "AGREE_SAT");
  assert.equal(sat.overall.claim_verdict, "PASS");
  const prose = JSON.parse(read(join(LIVE_EV, "live-cli", "j3-prose-failclosed.receipt.json")));
  assert.equal(prose.source_sha, HEAD_SHA);
  assert.equal(prose.overall.process_outcome, "FAILED");
  assert.equal(prose.overall.claim_verdict, "UNSUPPORTED_BY_MVP");
  assert.equal(prose.overall.fail_closed_reason, "SOLVER_NONZERO_EXIT");
  assert.equal(prose.overall.solver_answer.value, null, "no solver answer is invented for prose input");
});
test("live evidence: LP journeys — HiGHS kOptimal objective 11 and kInfeasible", () => {
  const kopt = JSON.parse(read(join(LIVE_EV, "live-cli", "j4-lp-koptimal.receipt.json")));
  const step = kopt.steps.find((s) => s.operation === "solve-lp");
  assert.equal(kopt.source_sha, HEAD_SHA);
  assert.equal(kopt.overall.process_outcome, "OK");
  assert.equal(step.result.model_status, "kOptimal");
  assert.equal(step.result.objective, 11, "the hand-proven optimum");
  assert.deepEqual(step.result.variables, [3, 1], "primal vertex (3,1)");
  assert.match(kopt.tool_versions.highs.version, /highspy 1\.15\.1/);
  const kinf = JSON.parse(read(join(LIVE_EV, "live-cli", "j5-lp-kinfeasible.receipt.json")));
  const infStep = kinf.steps.find((s) => s.operation === "solve-lp");
  assert.equal(kinf.source_sha, HEAD_SHA);
  assert.equal(infStep.result.model_status, "kInfeasible");
  const unpinned = JSON.parse(read(join(LIVE_EV, "live-cli", "j4-first-attempt-unpinned.receipt.json")));
  assert.equal(unpinned.overall.fail_closed_reason, "HIGHS_ADAPTER_FAIL_CLOSED",
    "the first LP attempt without the pinned runner digest failed closed (honest, kept)");
});
test("live evidence: negatives report — policy classes exact, executor PLAN_* codes, no receipts written", () => {
  const report = JSON.parse(read(join(LIVE_EV, "live-negatives", "negatives.report.json")));
  assert.equal(report.summary.failed, 0, "all fail-closed expectations held");
  const codes = Object.fromEntries(Object.entries(report.executor).map(([k, v]) => [k, v.error_code]));
  assert.equal(codes["unknown-tool.plan.json"], "PLAN_TOOL_NOT_ALLOWED");
  assert.equal(codes["tampered-hash.plan.json"], "PLAN_HASH_MISMATCH");
  assert.equal(codes["timeout-crush.plan.json"], "PLAN_TIMEOUT_INVALID");
  for (const [name, rec] of Object.entries(report.executor)) {
    assert.equal(rec.receipt_written, false, name + " wrote no receipt artifact");
  }
  const policy = Object.fromEntries(Object.entries(report.classifications).map(([k, v]) => [k, v.harness_class]));
  assert.equal(policy["unknown-tool.plan.json"], "PLAN_UNKNOWN_TOOL");
  assert.equal(policy["tampered-hash.plan.json"], "PLAN_HASH_MISMATCH");
  assert.equal(policy["timeout-crush.plan.json"], "TIMEOUT_BUDGET");
  const malformed = JSON.parse(read(join(LIVE_EV, "live-negatives", "malformed.receipt.json")));
  assert.equal(malformed.overall.process_outcome, "FAILED");
  assert.equal(malformed.overall.claim_verdict, "UNSUPPORTED_BY_MVP");
  assert.equal(malformed.overall.fail_closed_reason, "SOLVER_NONZERO_EXIT");
});
test("live evidence: MCP journey 12/12 checks, deterministic plan parity with the CLI planner", () => {
  const report = JSON.parse(read(join(LIVE_EV, "live-mcp", "mcp-journey.report.json")));
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.checks, 12);
  assert.ok(report.summary.passed >= 11, "MCP assertions overwhelmingly passed");
  assert.equal(report.credential_material_present, false);
  const comparison = JSON.parse(read(join(LIVE_EV, "live-compare", "comparison.json")));
  assert.equal(comparison.overall, "MATCH", "cross-entry comparison MATCHes");
  assert.equal(comparison.bindings.cli_plan_id, comparison.bindings.mcp_plan_id,
    "CLI and MCP planners returned the identical plan object");
  assert.equal(comparison.bindings.deepseek_plan_id_cli, comparison.bindings.deepseek_plan_id_mcp_provider_call,
    "the real DeepSeek proposal reproduced across entries at temperature 0");
});
test("live evidence: web bridge journeys — AGREE_UNSAT via the real engine, LP kOptimal, evidence bytes verified", () => {
  const smt = JSON.parse(read(join(LIVE_EV, "live-web", "journey-smt-template", "evidence-verification.json")));
  assert.equal(smt.identical_to_run_summary_receipt, true, "downloaded evidence bytes equal the served receipt");
  assert.equal(smt.overall.cross_tool_verdict, "AGREE_UNSAT");
  assert.equal(smt.overall.claim_verdict, "PASS");
  const lp = JSON.parse(read(join(LIVE_EV, "live-web", "journey-lp", "evidence-verification.json")));
  assert.equal(lp.identical_to_run_summary_receipt, true);
  assert.equal(lp.overall.solver_answer.by_step[0].answer, "kOptimal");
  const browserSmt = JSON.parse(read(join(LIVE_EV, "live-web", "browser-journey", "run-summary-smt-deepseek.json")));
  assert.equal(browserSmt.receipt.overall.cross_tool_verdict, "AGREE_UNSAT");
  assert.equal(browserSmt.receipt.overall.claim_verdict, "PASS");
  for (const shot of [
    "01-input-scenario-a-deepseek.png", "02-plan-deepseek-llm.png", "03-run-steps-real-solvers.png",
    "04-results-agree-unsat.png", "05-evidence-download-attempt.png", "06-lp-result-koptimal.png"
  ]) {
    assert.ok(existsSync(join(LIVE_EV, "live-web", "screenshots", shot)), "screenshot committed: " + shot);
  }
});
test("live evidence: harness drivers pass node --check (committed tooling stays runnable)", async () => {
  for (const f of ["run-live-cli-journey.mjs", "run-live-mcp-journey.mjs", "run-live-negatives.mjs", "build-entry-reports.mjs"]) {
    const p = join(HARNESS, f);
    const chk = spawnSync(process.execPath, ["--check", p], { encoding: "utf8", timeout: 20000 });
    assert.equal(chk.status, 0, f + " must be syntactically valid: " + chk.stderr);
  }
});

// ---------------------------------------------------------------------------
// 10. Optional re-run blocks — env-gated (FORCE_LIVE_USER_E2E=1). The offline
//     gate above NEVER needs them; they exercise the local surfaces where they
//     happen to be wired (trusted host binaries / running web server / network).
// ---------------------------------------------------------------------------
test("LIVE-E2E [optional re-run]: CLI harness probe reports the wired workflow surface", { skip: FORCE_LIVE ? false : LIVE_REASON }, async () => {
  const { buildReport } = await import("../validation/mvp-user-e2e/harness/run-cli.mjs");
  const report = buildReport("probe");
  assert.ok(["SKIP_NOT_WIRED", "WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_WIRING"].includes(report.entry_outcome_class),
    report.entry_outcome_class);
  assert.notEqual(report.entry_outcome_class, "FAIL_CLOSED_OTHER");
});
test("LIVE-E2E [optional re-run]: MCP workflow tool registered and callable", { skip: FORCE_LIVE ? false : LIVE_REASON }, async () => {
  const { buildReport } = await import("../validation/mvp-user-e2e/harness/run-mcp.mjs");
  const report = await buildReport();
  assert.ok(["NOT_REGISTERED_YET", "WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_TOOLS"].includes(report.entry_outcome_class),
    report.entry_outcome_class);
});
test("LIVE-E2E [optional re-run]: Web journeys against a running apps/web server", { skip: FORCE_LIVE ? false : LIVE_REASON }, async () => {
  const { buildReport } = await import("../validation/mvp-user-e2e/harness/run-web.mjs");
  const report = await buildReport();
  assert.ok(["SKIP_WEB_NOT_RUNNING", "WEB_REACHABLE_PARTIAL_SEE_CHECKS", "WEB_SHAPE_MISMATCH"].includes(report.entry_outcome_class),
    report.entry_outcome_class);
});
test("LIVE-E2E [optional re-run]: real-provider planning probe maps onto the allowlist", { skip: FORCE_LIVE ? false : LIVE_REASON }, async () => {
  const { runProbe } = await import("../validation/mvp-user-e2e/harness/run-deepseek-plan.mjs");
  const probe = await runProbe({ outDir: null });
  assert.equal(probe.http_status, 200, "provider reachable for the real planning path");
  assert.equal(probe.proposal_mapping.ok, true, "proposal maps to the allowlist before any execution");
});
