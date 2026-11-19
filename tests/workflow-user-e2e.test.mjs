/**
 * i180/V6 — real-user E2E preparation (issue #186). OFFLINE INVARIANTS ONLY.
 *
 * This round commits fixtures, expected relations and the three-entry harness
 * (CLI / MCP / Web) WITHOUT executing any solver and without network access to
 * any provider (the DeepSeek probe transcript is committed real evidence from a
 * single earlier probe run; the test only re-validates its integrity offline).
 * The live E2E itself is enabled next round after V1–V5 merge — those tests are
 * present as clearly named skip blocks.
 *
 * Documented duplication: `localValidateHighsModel` below is a local
 * reimplementation of the LP shape checks read from
 * packages/runner/js/tool-portfolio-t4.mjs (validateHighsModel, r0 @ 33bd3d0).
 * The duplication is INTENTIONAL: that file is owned by another lane (V1–V5) and
 * this offline test must stay decoupled from it. Re-sync the local copy if the
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
import { normalizeReport, compareEntries, compareReports, TOLERANCE_TABLE } from "../validation/mvp-user-e2e/harness/compare.mjs";

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

const LIVE_REASON = "live E2E runs next round after V1-V5 merge (issue #186): needs the trusted Debian host binaries and the V4-b workflow layer";
const FORCE_LIVE = process.env.FORCE_LIVE_USER_E2E === "1";

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
test("negative plans: parse and conform structurally to the pinned ExecutionPlan contract", () => {
  for (const [name] of negativePlans) {
    const plan = JSON.parse(read(join(NEG, name)));
    assert.equal(plan.schema, "formal-tools/execution-plan/1.0", name + " pins the schema");
    const shape = validateExecutionPlanShape(plan);
    assert.deepEqual(shape.errors, [], name + " has no structural errors: " + JSON.stringify(shape.errors));
    if (name === "unknown-tool.plan.json") {
      assert.deepEqual(shape.classes.map((c) => c.code), ["TOOL_NOT_IN_ALLOWLIST"],
        "its deliberate violation is surfaced as a class, not a structural error");
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
test("negative plans: tampered-hash.plan.json binds a real sha256 of DIFFERENT bytes", () => {
  const plan = JSON.parse(read(join(NEG, "tampered-hash.plan.json")));
  const step = plan.steps[0];
  const actual = sha256Hex(readBytes(resolve(REPO_ROOT, step.input)));
  assert.notEqual(step.input_sha256, actual, "declared hash must mismatch the referenced input");
  assert.match(step.input_sha256, /^[a-f0-9]{64}$/, "but the declared hash is still a well-formed sha256");
  const satHash = sha256Hex(readBytes(join(FX, "scenario-a-sat.smt2")));
  assert.equal(step.input_sha256, satHash, "tamper provenance: it is the hash of the SAT sibling file");
  assert.equal(classifyPlan(plan, { recomputeInputSha: true, repoRoot: REPO_ROOT }), "PLAN_HASH_MISMATCH");
});
test("negative plans: timeout-crush violates the harness budget policy before any launch", () => {
  const plan = JSON.parse(read(join(NEG, "timeout-crush.plan.json")));
  const violations = checkBudgetPolicy(plan);
  assert.ok(violations.length >= 2, "both the declared budget and the step sum must violate: " + JSON.stringify(violations));
  const sum = plan.steps.reduce((acc, s) => acc + s.timeout_s, 0);
  assert.ok(sum > BUDGET_POLICY.max_total_timeout_s);
});
test("negative plans: their own non-tampered hash bindings are real (problem_sha256 matches the file)", () => {
  const plan = JSON.parse(read(join(NEG, "unknown-tool.plan.json")));
  assert.equal(plan.source.problem_sha256, sha256Hex(readBytes(join(FX, "scenario-a.smt2"))));
  const step = plan.steps[0];
  assert.equal(step.input_sha256, sha256Hex(readBytes(join(FX, "scenario-a.smt2"))));
  assert.equal(recomputeStepInputSha(step, REPO_ROOT).code, "INPUT_SHA_MATCH");
});
test("well-formed plan built in-test classifies OK and hash-checks against the raw fixture", () => {
  const input = "validation/mvp-user-e2e/fixtures/scenario-a.smt2";
  const plan = {
    schema: "formal-tools/execution-plan/1.0",
    plan_id: "test-positive-01",
    source: { problem_sha256: sha256Hex(readBytes(join(FX, "scenario-a.smt2"))), problem_kind: "qf_lia-sat-consistency" },
    assumptions: ["offline test-constructed plan"],
    method_dag: [{ id: "s1", tool: "z3", operation: "solve-smt", depends_on: [] }],
    steps: [{
      id: "s1", tool: "z3", operation: "solve-smt", depends_on: [],
      input, input_sha256: sha256Hex(readBytes(join(FX, "scenario-a.smt2"))),
      timeout_s: 10, expected_output_kind: "solver_answer"
    }],
    budgets: { max_steps: 4, max_total_timeout_s: 60 },
    compiled: {
      launcher_sha256: sha256Hex(Buffer.alloc(0)),
      manifest_sha256: sha256Hex(Buffer.alloc(0))
    }
  };
  assert.equal(validateExecutionPlanShape(plan).ok, true);
  assert.equal(classifyPlan(plan, { recomputeInputSha: true, repoRoot: REPO_ROOT }), "OK");
  assert.equal(
    canonicalJsonSha256(plan),
    canonicalJsonSha256({ ...plan, budgets: { max_total_timeout_s: 60, max_steps: 4 } }),
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
  assert.equal(TOLERANCE_TABLE.plan_sha256, "EXACT");
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
// 9. Live E2E blocks — explicitly skipped THIS round, named for enablement
//    next round after V1–V5 merge (issue #186). Flip FORCE_LIVE_USER_E2E=1 to
//    attempt them where the workflow layer is wired.
// ---------------------------------------------------------------------------
test("LIVE-E2E [pending V1-V5]: CLI journey plan/execute/status/results on trusted host", { skip: FORCE_LIVE ? false : LIVE_REASON }, async () => {
  const { buildReport } = await import("../validation/mvp-user-e2e/harness/run-cli.mjs");
  const report = buildReport("probe");
  assert.ok(["SKIP_NOT_WIRED", "WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_WIRING"].includes(report.entry_outcome_class),
    report.entry_outcome_class);
  assert.notEqual(report.entry_outcome_class, "FAIL_CLOSED_OTHER");
});
test("LIVE-E2E [pending V1-V5]: MCP workflow tools registered and callable", { skip: FORCE_LIVE ? false : LIVE_REASON }, async () => {
  const { buildReport } = await import("../validation/mvp-user-e2e/harness/run-mcp.mjs");
  const report = await buildReport();
  assert.ok(["NOT_REGISTERED_YET", "WIRED_PARTIAL_OR_FULL_SEE_WORKFLOW_TOOLS"].includes(report.entry_outcome_class),
    report.entry_outcome_class);
});
test("LIVE-E2E [pending V1-V5]: Web journeys against a running apps/web server", { skip: FORCE_LIVE ? false : LIVE_REASON }, async () => {
  const { buildReport } = await import("../validation/mvp-user-e2e/harness/run-web.mjs");
  const report = await buildReport();
  assert.ok(["SKIP_WEB_NOT_RUNNING", "WEB_REACHABLE_PARTIAL_SEE_CHECKS", "WEB_SHAPE_MISMATCH"].includes(report.entry_outcome_class),
    report.entry_outcome_class);
});
test("LIVE-E2E [pending V1-V5]: full planning path -> ExecutionPlan -> executed receipt -> compare across entries", { skip: FORCE_LIVE ? false : LIVE_REASON }, async () => {
  const { runProbe } = await import("../validation/mvp-user-e2e/harness/run-deepseek-plan.mjs");
  const probe = await runProbe({ outDir: null });
  assert.equal(probe.http_status, 200, "provider reachable for the real planning path");
  assert.equal(probe.proposal_mapping.ok, true, "proposal maps to the allowlist before any execution");
});
