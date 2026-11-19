/**
 * Issue #182 follow-up R2-C: offline tests for the NL -> typed constraint
 * model lane (packages/runner/js/nl-model.mjs).
 *
 * ALL provider input here is a deterministic STUB — no network, no API key.
 * The hostile cases mirror what an untrusted translation proposal may try:
 * extra keys, oversized variable sets, undeclared/non-linear-breaking
 * coefficients, bad names, crossed bounds, non-integer data. Every hostile
 * reply must land on status UNKNOWN (never rendered, never approved, never
 * planned); the honest statuses NEEDS_CLARIFICATION / MODEL_PROPOSED must
 * behave per contract.
 *
 * Real DeepSeek/solver journeys live in tests/nl-model.driver.mjs (NOT part
 * of the CI test glob); committed live evidence is under
 * validation/local-runtime-receipts/nl-model-*.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NL_MODEL_PROPOSAL_SCHEMA, NL_MODEL_APPROVED_SCHEMA, NL_CAPS,
  NL_LP_RELAXATION_ASSUMPTION, NL_SYSTEM_PROMPT, NL_PROBLEM_KIND,
  NL_LP_RELAXATION_ONLY, NL_UNSUPPORTED_EXACT_INTEGER,
  NL_INTEGER_OPTIMIZATION_UNSUPPORTED_NOTE,
  nlLpRelaxationAckRecord, nlLpRelaxationPlanAssumption,
  proposeConstraintModel, approveModel, buildPlanFromApprovedModel,
  validateStructuredModel, renderSmtLib, renderLpModel, verifyRenderedSmt,
  makeNlModelProvider
} from "../packages/runner/js/nl-model.mjs";
import {
  WorkflowError, canonicalJson, sha256Canonical, sha256Text, validateExecutionPlan
} from "../packages/runner/js/workflow-plan.mjs";
import { planPortfolioOperation } from "../packages/runner/js/tool-portfolio-t4.mjs";

/** @returns {any} deterministic "what a good translation proposal looks like" */
function stubModel() {
  return {
    variables: [
      { name: "x", integer: true, lower: 3, upper: 50 },
      { name: "y", integer: true, lower: 1, upper: 50 },
      { name: "k", integer: true, lower: 1, upper: 14 }
    ],
    constraints: [
      { coefficients: { x: 1, y: 1, k: -7 }, op: "==", rhs: 0 },
      { coefficients: { y: 1, x: -1 }, op: "<=", rhs: 0 }
    ],
    question: "sat",
    assumptions: ["auxiliary k: x+y = 7*k", "k bounded because 4 <= x+y <= 100"]
  };
}

/** @returns {any} deterministic optimization model (LP arm) */
function stubOptimizeModel() {
  return {
    variables: [
      { name: "x", integer: true, lower: 0, upper: 3 },
      { name: "y", integer: true, lower: 0, upper: 4 }
    ],
    constraints: [
      { coefficients: { x: 1, y: 1 }, op: "<=", rhs: 4 },
      { coefficients: { x: 1 }, op: "<=", rhs: 3 }
    ],
    question: "optimize",
    objective: { direction: "maximize", coefficients: { x: 3, y: 2 } },
    assumptions: ["x in [0,3] because x <= 3", "y in [0,4] implied by x+y <= 4 and x >= 0"]
  };
}

/** @param {any} model @returns {function(): Promise<any>} deterministic stub provider */
const stubProvider = model => async () => structuredClone(model);

/** @param {Function} fn @returns {string} thrown WorkflowError code */
function codeOf(fn) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof WorkflowError, "expected WorkflowError, got " + String(e));
    return /** @type {WorkflowError} */ (e).code;
  }
  throw new Error("expected WorkflowError, nothing thrown");
}

const SAT_TEXT =
  "找出整数 x 和 y:x 至少是 3,y 至少是 1,两个都不超过 50,x+y 恰好是 7 的倍数,并且 y 不超过 x。这样的整数对存在吗?";
const VAGUE_TEXT = "证明我们的系统总体上是安全的";
const OPT_TEXT = "最大化 3x+2y,其中 x 和 y 都是非负整数,x+y 不超过 4,并且 x 不超过 3";

// ---------------------------------------------------------------------------
// 1. Happy path: proposal -> rendering -> provenance
// ---------------------------------------------------------------------------
test("nl-model: stub proposal is MODEL_PROPOSED with valid rendering and full provenance", async () => {
  const p = await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(stubModel()) });
  assert.equal(p.schema, NL_MODEL_PROPOSAL_SCHEMA);
  assert.equal(p.status, "MODEL_PROPOSED");
  assert.equal(p.original_text, SAT_TEXT); // verbatim (canonical form) preserved
  assert.equal(p.original_text_sha256, sha256Text(SAT_TEXT));
  assert.deepEqual(p.provider, { name: "injected", model: "injected" });
  assert.match(p.prompt_sha256, /^[a-f0-9]{64}$/);
  assert.match(p.response_sha256, /^[a-f0-9]{64}$/);
  assert.equal(p.review.approved, false);
  assert.match(p.honesty_note, /TRANSLATION PROPOSAL/);
  assert.ok(!/equivalent/i.test(p.honesty_note));
  // rendering: valid QF_LIA text, allowlisted commands, answer-only
  assert.equal(p.rendering.kind, "smt-lib2");
  assert.equal(p.rendering.logic, "QF_LIA");
  assert.equal(p.rendering.mode, "plan");
  assert.ok(p.rendering.text.includes("(set-logic QF_LIA)"));
  assert.ok(p.rendering.text.includes("(check-sat)"));
  assert.ok(!p.rendering.text.includes("get-model"));
  assert.ok(!p.rendering.text.includes("get-value"));
  assert.equal(p.rendering.sha256, sha256Text(p.rendering.text));
  assert.equal(p.rendering.semantic_status, "TRANSLATION_PROPOSAL_NOT_VERIFIED_AGAINST_TEXT");
  verifyRenderedSmt(p.rendering.text, { variables: ["x", "y", "k"] });
  // proposal hash binds the full core (text, provider, prompt/response, model, rendering)
  const core = {
    original_text: p.original_text,
    provider: p.provider,
    prompt_sha256: p.prompt_sha256,
    response_sha256: p.response_sha256,
    model: p.model,
    rendering: p.rendering
  };
  assert.equal(p.proposal_sha256, sha256Canonical(core));
  // determinism: same stub -> identical proposal hash and rendering
  const again = await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(stubModel()) });
  assert.equal(again.proposal_sha256, p.proposal_sha256);
  assert.equal(again.rendering.text, p.rendering.text);
});

// ---------------------------------------------------------------------------
// 2. Input validation
// ---------------------------------------------------------------------------
test("nl-model: text and provider input validation fails closed", async () => {
  await assert.rejects(
    () => proposeConstraintModel({ text: 42, provider: stubProvider(stubModel()) }),
    e => e instanceof WorkflowError && e.code === "NL_TEXT_INVALID");
  await assert.rejects(
    () => proposeConstraintModel({ text: "x".repeat(NL_CAPS.maxTextBytes + 1), provider: stubProvider(stubModel()) }),
    e => e instanceof WorkflowError && e.code === "NL_TEXT_OVERSIZED");
  const atCap = await proposeConstraintModel({
    text: "find integer x: ".padEnd(NL_CAPS.maxTextBytes, "x"), provider: stubProvider(stubModel())
  });
  assert.equal(atCap.status, "MODEL_PROPOSED");
  await assert.rejects(
    () => proposeConstraintModel({ text: "ok", provider: { no_generate: true } }),
    e => e instanceof WorkflowError && e.code === "NL_PROVIDER_INVALID");
});

// ---------------------------------------------------------------------------
// 3. NEEDS_CLARIFICATION: vague text, model questions, never rendered
// ---------------------------------------------------------------------------
test("nl-model: NEEDS_CLARIFICATION carries the model's questions and is not approvable", async () => {
  const reply = {
    variables: [], constraints: [], question: "sat", assumptions: [],
    clarification_needed: [
      "Which system component does \"the system\" refer to?",
      "What does \"safe\" mean measurably here?",
      "Which quantities bound the problem?"
    ]
  };
  const p = await proposeConstraintModel({ text: VAGUE_TEXT, provider: stubProvider(reply) });
  assert.equal(p.status, "NEEDS_CLARIFICATION");
  assert.equal(p.model, null);
  assert.equal(p.rendering, null); // never rendered
  assert.equal(p.clarification_needed.length, 3);
  assert.equal(p.proposal_sha256, null);
  assert.equal(codeOf(() => approveModel(p, { approved: true })), "NL_NOT_APPROVABLE");
  const r = approveModel(p, { approved: false });
  assert.equal(r.status, "USER_REJECTED");
});

// ---------------------------------------------------------------------------
// 4. Hostile proposals are untrusted data: UNKNOWN, never rendered
// ---------------------------------------------------------------------------
/** @type {Record<string, any>} */
const hostile = {
  extra_top_level_key: { ...stubModel(), execute: "rm -rf /" },
  too_many_vars: {
    ...stubModel(),
    variables: Array.from({ length: NL_CAPS.maxVars + 1 }, (_, i) =>
      ({ name: "v" + i, integer: true, lower: 0, upper: 1 }))
  },
  undeclared_coefficient: (() => {
    const m = stubModel();
    m.constraints = [{ coefficients: { x: 1, ghost: 1 }, op: "<=", rhs: 5 }];
    return m;
  })(),
  coeff_over_abs_cap: (() => {
    const m = stubModel();
    m.constraints = [{ coefficients: { x: NL_CAPS.maxCoeffAbs + 1 }, op: "<=", rhs: 5 }];
    return m;
  })(),
  bad_var_name: (() => {
    const m = stubModel();
    m.variables = [{ name: "X", integer: true, lower: 0, upper: 5 }];
    return m;
  })(),
  crossed_bounds: (() => {
    const m = stubModel();
    m.variables = [{ name: "x", integer: true, lower: 9, upper: 3 }];
    return m;
  })(),
  fractional_rhs: (() => {
    const m = stubModel();
    m.constraints = [{ coefficients: { x: 1 }, op: "<=", rhs: 2.5 }];
    return m;
  })(),
  reply_string: "declare x int",
  reply_array: ["variables"],
  missing_required_field: (() => {
    const m = stubModel();
    delete m.question;
    return m;
  })(),
  bad_question: (() => {
    const m = stubModel();
    m.question = "minimize please";
    return m;
  })(),
  sat_with_objective: (() => {
    const m = stubModel();
    m.objective = { direction: "minimize", coefficients: { x: 1 } };
    return m;
  })(),
  optimize_without_objective: (() => {
    const m = stubModel();
    m.question = "optimize";
    return m;
  })(),
  zero_coefficient: (() => {
    const m = stubModel();
    m.constraints = [{ coefficients: { x: 1, y: 0 }, op: "<=", rhs: 5 }];
    return m;
  })(),
  non_integer_variable: (() => {
    const m = stubModel();
    m.variables = [{ name: "x", integer: false, lower: 0, upper: 5 }];
    return m;
  })(),
  bound_over_abs_cap: (() => {
    const m = stubModel();
    m.variables = [{ name: "x", integer: true, lower: 0, upper: 2000000 }];
    return m;
  })(),
  duplicate_variable: (() => {
    const m = stubModel();
    m.variables = [
      { name: "x", integer: true, lower: 0, upper: 5 },
      { name: "x", integer: true, lower: 1, upper: 6 }
    ];
    return m;
  })()
};

for (const [name, reply] of Object.entries(hostile)) {
  test("nl-model: hostile reply rejected as UNKNOWN: " + name, async () => {
    const p = await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(reply) });
    assert.equal(p.status, "UNKNOWN");
    assert.equal(p.rendering, null, "hostile replies must never be rendered");
    assert.equal(p.model, null);
    assert.ok(Array.isArray(p.issues) && p.issues.length > 0, "issues must be recorded");
    assert.equal(codeOf(() => approveModel(p, { approved: true })), "NL_NOT_APPROVABLE");
  });
}

test("nl-model: invalid clarification content falls through to UNKNOWN", async () => {
  const reply = { ...stubModel(), clarification_needed: [42] };
  const p = await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(reply) });
  assert.equal(p.status, "UNKNOWN");
  assert.ok(p.issues.includes("clarification_needed_invalid"));
  const withModel = { ...stubModel(), clarification_needed: ["which bound?"] };
  const p2 = await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(withModel) });
  assert.equal(p2.status, "NEEDS_CLARIFICATION", "the model's questions win over a proposed model");
});

// ---------------------------------------------------------------------------
// 5. Provider failure classification
// ---------------------------------------------------------------------------
test("nl-model: provider failures classify to UNKNOWN; BLOCKED_PROVIDER is thrown", async () => {
  const p = await proposeConstraintModel({
    text: SAT_TEXT,
    provider: async () => { throw new WorkflowError("PROVIDER_FAILED", "boom", { http_status: 503 }); }
  });
  assert.equal(p.status, "UNKNOWN");
  assert.equal(p.reason, "PROVIDER_FAILED:PROVIDER_FAILED");
  assert.equal(p.rendering, null);
  const p2 = await proposeConstraintModel({ text: SAT_TEXT, provider: async () => { throw new TypeError("no net"); } });
  assert.equal(p2.status, "UNKNOWN");
  assert.equal(p2.reason, "PROVIDER_FAILED");
  const blocked = makeNlModelProvider({ apiKey: "", fetchImpl: async () => { throw new Error("must not be called"); } });
  await assert.rejects(() => proposeConstraintModel({ text: SAT_TEXT, provider: blocked }),
    e => e instanceof WorkflowError && e.code === "BLOCKED_PROVIDER");
});

// ---------------------------------------------------------------------------
// 6. makeNlModelProvider transport reuse
// ---------------------------------------------------------------------------
test("nl-model: provider swaps only the system prompt; key stays header-only; temperature 0", async () => {
  /** @type {any} */
  let seen = null;
  const fetchImpl = async (/** @type {any} */ url, /** @type {any} */ init) => {
    seen = { url, body: JSON.parse(init.body), headers: init.headers };
    return {
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ ok: 1 }) } }] })
    };
  };
  const provider = makeNlModelProvider({ apiKey: "test-key-abc", fetchImpl });
  const reply = await provider.generate({ original_text: "hello" });
  assert.deepEqual(reply, { ok: 1 });
  assert.equal(seen.url, "https://api.deepseek.com/chat/completions");
  assert.equal(seen.headers.authorization, "Bearer test-key-abc");
  assert.equal(seen.body.messages[0].content, NL_SYSTEM_PROMPT);
  assert.equal(seen.body.messages[1].content, JSON.stringify({ original_text: "hello" }));
  assert.equal(seen.body.temperature, 0);
  assert.deepEqual(seen.body.response_format, { type: "json_object" });
  assert.equal(seen.body.model, "deepseek-chat");
  assert.ok(!JSON.stringify(seen.body).includes("test-key-abc"), "key must never travel in the body");
  // the prompt itself carries the honesty framing and the escape hatch
  assert.match(NL_SYSTEM_PROMPT, /STRICT JSON/);
  assert.match(NL_SYSTEM_PROMPT, /clarification_needed/);
  assert.match(NL_SYSTEM_PROMPT, /do NOT invent a model/);
});

// ---------------------------------------------------------------------------
// 7. Deterministic rendering + render verification
// ---------------------------------------------------------------------------
test("nl-model: renderSmtLib is deterministic and answer-only in plan mode", () => {
  const m = validateStructuredModel(stubModel());
  const a = renderSmtLib(m, { mode: "plan" });
  const b = renderSmtLib(m, { mode: "plan" });
  assert.equal(a, b);
  assert.ok(a.includes("(assert (= (+ (* -7 k) x y) 0))"));
  assert.ok(a.includes("(assert (<= (+ (- x) y) 0))"));
  assert.ok(!a.includes("get-value"));
  const w = renderSmtLib(m, { mode: "witness" });
  assert.ok(w.includes("(get-value (x y k))"));
  assert.ok(w.startsWith(a.split("(check-sat)")[0]));
});

test("nl-model: verifyRenderedSmt rejects hostile or malformed text", () => {
  const m = validateStructuredModel(stubModel());
  const good = renderSmtLib(m, { mode: "plan" });
  assert.equal(verifyRenderedSmt(good, { variables: ["x", "y", "k"] }).ok, true);
  // hostile: a command outside the frozen allowlist
  const shell = good.replace("(exit)", "(shell \"bash -c id\")");
  assert.throws(() => verifyRenderedSmt(shell, { variables: ["x", "y", "k"] }), /disallowed_command:shell/);
  // malformed: unbalanced parens
  assert.throws(() => verifyRenderedSmt(good.slice(0, -2), { variables: ["x", "y", "k"] }), /unbalanced/);
  // rogue atom not declared/allowlisted
  const rogue = good.replace("(check-sat)", "(assert (>= injected 1))");
  assert.throws(() => verifyRenderedSmt(rogue, { variables: ["x", "y", "k"] }), /disallowed_atom:injected/);
  // get-value is only admitted when explicitly allowed (witness mode)
  const witness = renderSmtLib(m, { mode: "witness" });
  assert.throws(() => verifyRenderedSmt(witness, { variables: ["x", "y", "k"], allowGetModel: false }),
    /disallowed_command:get-value/);
  assert.equal(verifyRenderedSmt(witness, { variables: ["x", "y", "k"], allowGetModel: true }).ok, true);
  assert.throws(() => verifyRenderedSmt("", { variables: ["x"] }), /empty/);
});

test("nl-model: renderLpModel emits the portfolio shape; strict ops and sat question rejected", () => {
  const m = validateStructuredModel(stubOptimizeModel());
  const lp = renderLpModel(m);
  assert.deepEqual(lp, {
    sense: "max", objective: [3, 2],
    variables: [{ lower: 0, upper: 3 }, { lower: 0, upper: 4 }],
    constraints: [
      { lower: null, upper: 4, coefficients: [1, 1] },
      { lower: null, upper: 3, coefficients: [1, 0] }
    ]
  });
  // the same validator the executor-side portfolio gateway applies
  assert.equal(planPortfolioOperation("highs", "solve-lp", lp).tool, "highs");
  const strict = structuredClone(stubOptimizeModel());
  strict.constraints = [{ coefficients: { x: 1, y: 1 }, op: "<", rhs: 4 }];
  assert.equal(codeOf(() => renderLpModel(validateStructuredModel(strict))), "NL_RENDER_INVALID");
  assert.equal(codeOf(() => renderLpModel(validateStructuredModel(stubModel()))), "NL_RENDER_INVALID");
});

// ---------------------------------------------------------------------------
// 8. Approval gate
// ---------------------------------------------------------------------------
test("nl-model: approveModel gate semantics (reject/edit/tamper/types)", async () => {
  const p = await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(stubModel()) });
  const no = approveModel(p, { approved: false });
  assert.equal(no.status, "USER_REJECTED");
  assert.equal(codeOf(() => buildPlanFromApprovedModel(no)), "NL_NOT_APPROVED");
  assert.equal(codeOf(() => approveModel(p, {})), "NL_APPROVAL_INVALID");
  assert.equal(codeOf(() => approveModel({ schema: "other" }, { approved: true })), "NL_PROPOSAL_INVALID");

  const a = approveModel(p, { approved: true });
  assert.equal(a.schema, NL_MODEL_APPROVED_SCHEMA);
  assert.equal(a.status, "USER_APPROVED");
  assert.deepEqual(a.review, { approved: true, edited: false });
  assert.equal(a.rendering.text, p.rendering.text);
  assert.equal(a.provenance.prompt_sha256, p.prompt_sha256);
  assert.equal(a.provenance.response_sha256, p.response_sha256);

  // edit path: re-validated, re-rendered, flagged. R3: editing a sat proposal
  // into an optimize model is the FAIL-CLOSED LP gate — without the explicit
  // acknowledgement the approval returns the restricted unsupported record,
  // never a plan-eligible approval.
  const editedNoAck = approveModel(p, { approved: true, edited: stubOptimizeModel() });
  assert.equal(editedNoAck.status, NL_UNSUPPORTED_EXACT_INTEGER);
  assert.equal(editedNoAck.edited, true);
  assert.equal(editedNoAck.plan, null);
  assert.equal(editedNoAck.unsupported.reason, "LP_RELAXATION_NOT_ACKNOWLEDGED");
  assert.equal(editedNoAck.approved_sha256, undefined, "unsupported records are never plan-eligible");
  const editedAck = approveModel(p, {
    approved: true, edited: stubOptimizeModel(), lpRelaxationAcknowledged: true
  });
  assert.equal(editedAck.status, "USER_APPROVED");
  assert.equal(editedAck.review.edited, true);
  assert.deepEqual(editedAck.review.lp_relaxation_ack, nlLpRelaxationAckRecord());
  assert.equal(editedAck.model.question, "optimize");
  assert.notEqual(editedAck.approved_sha256, a.approved_sha256);
  // original proposal untouched
  assert.equal(p.review.approved, false);

  // reviewer/note metadata is part of the hash-covered approval
  const annotated = approveModel(p, {
    approved: true,
    reviewer: "human-reviewer-01",
    note: "checked the auxiliary-k encoding against the Chinese text"
  });
  assert.equal(annotated.review.reviewer, "human-reviewer-01");
  assert.ok(annotated.review.note.includes("auxiliary-k"));
  const annotatedCore = {
    schema: annotated.schema, status: annotated.status,
    original_text: annotated.original_text, original_text_sha256: annotated.original_text_sha256,
    provider: annotated.provider, proposal_sha256: annotated.proposal_sha256,
    provenance: annotated.provenance, model: annotated.model, rendering: annotated.rendering,
    review: annotated.review
  };
  assert.equal(annotated.approved_sha256, sha256Canonical(annotatedCore));
  // post-hoc metadata mutation must be detected by the integrity recheck
  const mutated = structuredClone(annotated);
  mutated.review.reviewer = "someone-else";
  assert.equal(codeOf(() => buildPlanFromApprovedModel(mutated)), "NL_TAMPERED");

  // tamper: flip the model after hashing
  const tampered = structuredClone(a);
  tampered.model.variables[0].lower = -100;
  assert.equal(codeOf(() => buildPlanFromApprovedModel(tampered)), "NL_TAMPERED");
  // proposal tamper: same class of protection on the proposal core
  const tamperedProposal = structuredClone(p);
  tamperedProposal.model.constraints[0].rhs = 1;
  assert.equal(codeOf(() => approveModel(tamperedProposal, { approved: true })), "NL_TAMPERED");
});

// ---------------------------------------------------------------------------
// 9. buildPlanFromApprovedModel: SMT target
// ---------------------------------------------------------------------------
test("nl-model: SMT plan mirrors the frozen fixture shapes and binds the provenance chain", async () => {
  const p = await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(stubModel()) });
  const a = approveModel(p, { approved: true });
  const built = buildPlanFromApprovedModel(a);
  assert.equal(built.target, "smt");
  assert.equal(built.question, "sat");
  const plan = built.plan;
  assert.equal(plan.schema, "formal-tools/execution-plan/1.0");
  validateExecutionPlan(plan); // the frozen choke point
  assert.deepEqual(plan.steps.map(s => s.tool + "/" + s.operation),
    ["z3/solve-smt", "cvc5/solve-smt", "compare/cross-check"]);
  for (const s of plan.steps.filter(s => s.tool === "z3" || s.tool === "cvc5")) {
    assert.deepEqual(Object.keys(s.input), ["smt_lib"]);
    assert.equal(s.input.smt_lib, a.rendering.text);
    assert.equal(s.input_sha256, sha256Canonical(s.input));
  }
  assert.deepEqual(plan.assumptions, stubModel().assumptions);
  assert.equal(plan.source.problem_kind, NL_PROBLEM_KIND);
  // determinism: same approval -> same plan id
  const rebuilt = buildPlanFromApprovedModel(approveModel(
    await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(stubModel()) }), { approved: true }));
  assert.equal(rebuilt.plan.plan_id, plan.plan_id);
  // full provenance chain is embedded as requirement r2 and hash-bound
  const r2 = built.problem.requirements.find(r => r.id === "r2");
  const provenanceSource = built.problem.source_refs.find(s => s.id === "nl-model-provenance");
  assert.ok(r2 && provenanceSource, "provenance requirement + source must be embedded");
  const parsed = JSON.parse(r2.text);
  assert.deepEqual(Object.keys(parsed).sort(), ["original_text", "rendering", "structured_model"]);
  assert.equal(parsed.original_text, SAT_TEXT);
  assert.equal(parsed.rendering.text, a.rendering.text);
  assert.deepEqual(parsed.structured_model, a.model);
  assert.equal(built.provenance_sha256, sha256Text(r2.text));
  assert.equal(provenanceSource.sha256, built.provenance_sha256);
  // provenance binding: ANY change to the original text changes the plan hashes
  const other = await proposeConstraintModel({ text: SAT_TEXT + "(请给出一个可行解)", provider: stubProvider(stubModel()) });
  const otherBuilt = buildPlanFromApprovedModel(approveModel(other, { approved: true }));
  assert.notEqual(otherBuilt.plan.plan_id, plan.plan_id);
  assert.notEqual(otherBuilt.plan.source.problem_sha256, plan.source.problem_sha256);
  // gate rejections on non-approved records
  assert.equal(codeOf(() => buildPlanFromApprovedModel(p)), "NL_NOT_APPROVED");
  // target mismatch: sat never takes the LP path (semantic narrowing, not a flag)
  assert.equal(codeOf(() => buildPlanFromApprovedModel(a, { target: "lp" })), "NL_TARGET_MISMATCH");
  // render drift with repaired approval hash -> drift detection
  const drifted = structuredClone(a);
  drifted.rendering = { ...drifted.rendering, text: drifted.rendering.text + "; tampered" };
  drifted.approved_sha256 = sha256Canonical({
    schema: drifted.schema, status: drifted.status,
    original_text: drifted.original_text, original_text_sha256: drifted.original_text_sha256,
    provider: drifted.provider, proposal_sha256: drifted.proposal_sha256,
    provenance: drifted.provenance, model: drifted.model, rendering: drifted.rendering, review: drifted.review
  });
  assert.equal(codeOf(() => buildPlanFromApprovedModel(drifted)), "NL_RENDER_DRIFT");
});

// ---------------------------------------------------------------------------
// 10. buildPlanFromApprovedModel: LP target — R3 fail-closed semantics
// ---------------------------------------------------------------------------
test("nl-model: LP optimize without acknowledgement is fail-closed UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION", async () => {
  const p = await proposeConstraintModel({ text: OPT_TEXT, provider: stubProvider(stubOptimizeModel()) });
  assert.equal(p.status, "MODEL_PROPOSED");
  // R3 (intentional tightening; previously this produced an LP plan silently):
  // every non-true acknowledgement value fails closed.
  for (const ack of [undefined, false, "yes", 1]) {
    const a = approveModel(p, ack === undefined
      ? { approved: true }
      // hostile non-true values exercise the strict `!== true` runtime gate
      : { approved: true, lpRelaxationAcknowledged: /** @type {any} */ (ack) });
    assert.equal(a.status, NL_UNSUPPORTED_EXACT_INTEGER, "ack=" + String(ack));
    assert.equal(a.schema, NL_MODEL_APPROVED_SCHEMA);
    assert.equal(a.question, "optimize");
    assert.equal(a.plan, null, "no plan may be produced without the acknowledgement");
    assert.equal(a.unsupported.reason, "LP_RELAXATION_NOT_ACKNOWLEDGED");
    assert.deepEqual(a.unsupported.dropped, ["integrality"]);
    assert.equal(a.unsupported.required_decision_field, "lpRelaxationAcknowledged");
    assert.match(a.unsupported.available_operation, /continuous LP relaxation only/);
    assert.ok(Array.isArray(a.unsupported.remedies) && a.unsupported.remedies.length === 2);
    assert.equal(a.detail, NL_INTEGER_OPTIMIZATION_UNSUPPORTED_NOTE);
    assert.deepEqual(a.review, { approved: false, edited: false, rejected: false, unsupported: true });
    assert.match(a.honesty_note, /fail-closed/);
    // the restricted record is NOT plan-eligible (and never throws silently through)
    assert.equal(codeOf(() => buildPlanFromApprovedModel(a)), "NL_NOT_APPROVED");
  }
});

test("nl-model: LP plan with explicit acknowledgement carries LP_RELAXATION_ONLY metadata", async () => {
  const p = await proposeConstraintModel({ text: OPT_TEXT, provider: stubProvider(stubOptimizeModel()) });
  const a = approveModel(p, { approved: true, lpRelaxationAcknowledged: true });
  assert.equal(a.status, "USER_APPROVED");
  assert.deepEqual(a.review.lp_relaxation_ack, {
    acknowledged: true, kind: NL_LP_RELAXATION_ONLY, dropped: ["integrality"],
    decision_field: "lpRelaxationAcknowledged"
  });
  const built = buildPlanFromApprovedModel(a);
  assert.equal(built.target, "lp");
  assert.equal(built.question, "optimize");
  // wrapper-level machine-readable relaxation metadata
  assert.deepEqual(built.relaxation, {
    kind: NL_LP_RELAXATION_ONLY,
    dropped: ["integrality"],
    meaning: NL_LP_RELAXATION_ASSUMPTION,
    effect: "plan results characterize the continuous LP relaxation only; " +
      "the optimal value is a bound for the integer problem, not its exact optimum",
    ack: nlLpRelaxationAckRecord()
  });
  const plan = built.plan;
  validateExecutionPlan(plan);
  assert.deepEqual(plan.steps.map(s => s.tool + "/" + s.operation), ["highs/solve-lp"]);
  const step = plan.steps[0];
  assert.equal(step.expected_output_kind, "lp-status");
  assert.ok(step.timeout_s >= 1 && step.timeout_s <= 30);
  assert.deepEqual(Object.keys(step.input).sort(), ["constraints", "objective", "sense", "variables"]);
  // the plan envelope itself carries the machine-readable marker (the frozen
  // schema has no metadata slot, so it rides as a canonical JSON assumption)
  const marker = plan.assumptions.find(a => a.startsWith("{\"ack\":"));
  assert.ok(marker, "canonical JSON relaxation assumption must be present");
  assert.deepEqual(JSON.parse(marker), JSON.parse(nlLpRelaxationPlanAssumption()));
  assert.deepEqual(JSON.parse(marker), {
    kind: NL_LP_RELAXATION_ONLY, dropped: ["integrality"],
    relaxed_from: "QF_LIA integer model",
    ack: { field: "lpRelaxationAcknowledged", acknowledged: true }
  });
  // the prose assumption coexists (never replaced by the JSON)
  assert.ok(plan.assumptions.includes(NL_LP_RELAXATION_ASSUMPTION));
  assert.ok(plan.assumptions.includes(stubOptimizeModel().assumptions[0]));
  assert.equal(plan.source.problem_kind, NL_PROBLEM_KIND);
  assert.ok(plan.assumptions.length <= 32, "plan assumptions stay within the frozen cap");
  // determinism of the machine-readable marker
  assert.equal(nlLpRelaxationPlanAssumption(), nlLpRelaxationPlanAssumption());
  assert.equal(nlLpRelaxationPlanAssumption(), JSON.stringify(JSON.parse(nlLpRelaxationPlanAssumption())));
});

test("nl-model: lp_relaxation_ack is hash-covered and required on hand-carried records", async () => {
  const p = await proposeConstraintModel({ text: OPT_TEXT, provider: stubProvider(stubOptimizeModel()) });
  const a = approveModel(p, { approved: true, lpRelaxationAcknowledged: true });
  const built = buildPlanFromApprovedModel(a);
  assert.equal(built.plan.plan_id.length > 0, true);
  // sat wrappers carry NO relaxation metadata and sat approvals carry no ack
  const psat = await proposeConstraintModel({ text: SAT_TEXT, provider: stubProvider(stubModel()) });
  const asat = approveModel(psat, { approved: true });
  assert.equal(asat.review.lp_relaxation_ack, undefined);
  const builtSat = buildPlanFromApprovedModel(asat);
  assert.equal(builtSat.relaxation, null);
  assert.ok(!builtSat.plan.assumptions.some(x => x.includes(NL_LP_RELAXATION_ONLY)));
  // post-hoc mutation of the ack is detected by the integrity recheck
  const mutated = structuredClone(a);
  mutated.review.lp_relaxation_ack.acknowledged = false;
  assert.equal(codeOf(() => buildPlanFromApprovedModel(mutated)), "NL_TAMPERED");
  const stripped = structuredClone(a);
  delete stripped.review.lp_relaxation_ack;
  assert.equal(codeOf(() => buildPlanFromApprovedModel(stripped)), "NL_TAMPERED");
  // defense in depth: a hand-carried record with a SELF-CONSISTENT hash but no
  // canonical ack is rejected fail-closed with the R3 verdict token
  const handCarried = structuredClone(stripped);
  handCarried.approved_sha256 = sha256Canonical({
    schema: handCarried.schema, status: handCarried.status,
    original_text: handCarried.original_text, original_text_sha256: handCarried.original_text_sha256,
    provider: handCarried.provider, proposal_sha256: handCarried.proposal_sha256,
    provenance: handCarried.provenance, model: handCarried.model, rendering: handCarried.rendering,
    review: handCarried.review
  });
  const err = /** @type {any} */ (() => {
    try { buildPlanFromApprovedModel(handCarried); return null; }
    catch (e) { return e; }
  })();
  assert.ok(err instanceof WorkflowError);
  assert.equal(err.code, NL_UNSUPPORTED_EXACT_INTEGER);
  assert.match(err.message, /LP-relaxation acknowledgement/);
  // a drift-tampered ack shape (right keys, wrong values) must also fail closed
  const wrongAck = structuredClone(a);
  wrongAck.review.lp_relaxation_ack = { acknowledged: true, kind: NL_LP_RELAXATION_ONLY };
  wrongAck.approved_sha256 = sha256Canonical({
    schema: wrongAck.schema, status: wrongAck.status,
    original_text: wrongAck.original_text, original_text_sha256: wrongAck.original_text_sha256,
    provider: wrongAck.provider, proposal_sha256: wrongAck.proposal_sha256,
    provenance: wrongAck.provenance, model: wrongAck.model, rendering: wrongAck.rendering,
    review: wrongAck.review
  });
  assert.equal(codeOf(() => buildPlanFromApprovedModel(wrongAck)), NL_UNSUPPORTED_EXACT_INTEGER);
});

// ---------------------------------------------------------------------------
// 11. Structured-model validation unit surface
// ---------------------------------------------------------------------------
test("nl-model: validateStructuredModel returns exact normalized copies", () => {
  const m = validateStructuredModel(stubModel());
  assert.deepEqual(m, stubModel());
  assert.equal(codeOf(() => validateStructuredModel({ variables: [] })), "NL_MODEL_INVALID");
  assert.equal(codeOf(() => validateStructuredModel("nope")), "NL_MODEL_INVALID");
});

test("nl-model: canonical provenance JSON is key-order independent", () => {
  const a = canonicalJson({ b: 1, a: { y: 2, x: 1 } });
  const b = canonicalJson({ a: { x: 1, y: 2 }, b: 1 });
  assert.equal(a, b);
});
