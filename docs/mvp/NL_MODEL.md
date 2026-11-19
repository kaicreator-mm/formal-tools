# NL_MODEL.md — natural language to typed constraint model (i180/R2-C + R3)

Issue #182 follow-up R2, lane C (`OUTPUT_LABEL=FORMAL_TOOLS_I180_R2_NL_TO_MODEL`);
R3 follow-up (`OUTPUT_LABEL=FORMAL_TOOLS_I180_R3_NL_MODEL_SEMANTICS`): the LP
relaxation arm is now EXPLICIT and FAIL-CLOSED — see §2 rule 5 and §3.

The lane closes the P1 review finding: `planWorkflow` used to pass prose to
solvers verbatim, so ordinary language honestly failed `UNSUPPORTED_BY_MVP`
(V6 J3). There is still **no universal NL support** — this lane adds the
minimal REAL path for ONE scoped class:

> natural-language bounded integer linear problems (QF_LIA, ≤16 variables,
> ≤32 constraints) and the LP-relaxation arm of the existing HiGHS typed
> shape for explicit optimization questions.

Pipeline: **NL text → LLM proposes a structured model (UNTRUSTED) →
deterministic validation + rendering → explicit user approval → typed
ExecutionPlan → real z3/cvc5/HiGHS → receipt + witness evidence.**

Module: `packages/runner/js/nl-model.mjs` (new file only; no shared-file
edits). Offline tests: `tests/nl-model.test.mjs`. Live driver:
`tests/nl-model.driver.mjs` (NOT in the CI glob; runs on the trusted host
with real DeepSeek + real solvers).

---

## 1. Contract

```js
proposeConstraintModel({ text, provider? }) -> Promise<proposal>
```

- `text` — string, NFC/LF canonical, ≤ 8 KiB (`NL_TEXT_OVERSIZED` beyond).
- `provider` — omitted/`"deepseek"` → real DeepSeek (`deepseek-chat`,
  temperature 0, JSON mode) via `makeNlModelProvider`, which reuses the V2
  transport adapter (`makeDeepSeekChatProvider` in workflow-plan.mjs) and
  swaps only the system prompt: env-only key, header-only Authorization,
  timeout/abort discipline, strict JSON classification. `BLOCKED_PROVIDER`
  is **thrown** when no key is configured (callers decide to skip).
  A plain `generate(payload)` function or `{generate, model}` object can be
  injected (tests use deterministic stubs).
- `prompt_sha256` = sha256 over the canonical JSON of the prompt payload;
  `response_sha256` = sha256 over the canonical JSON of the parsed reply.

The provider is asked for EXACTLY one JSON object:

```json
{
  "variables":   [{"name":"x","integer":true,"lower":3,"upper":50}],
  "constraints": [{"coefficients":{"x":1,"y":1,"k":-7},"op":"==","rhs":0}],
  "question":    "sat",
  "assumptions": ["every non-obvious interpretation decision"],
  "objective":   {"direction":"maximize","coefficients":{"x":3,"y":2}},
  "clarification_needed": ["specific question to the user"]
}
```

`objective` is only allowed with `question:"optimize"`. The system prompt
instructs the model to use `clarification_needed` — with empty
variables/constraints — whenever the text is not a bounded finite linear
integer problem, and never to guess missing bounds.

### Statuses

| status | meaning | can be approved? |
| --- | --- | --- |
| `MODEL_PROPOSED` | valid structured model + rendered SMT + provenance | yes (gate) |
| `NEEDS_CLARIFICATION` | the model asked specific questions (vague text, missing bounds, contradictory instructions); `rendering` is `null` — never rendered, never executed | no (`NL_NOT_APPROVABLE`); explicit rejection allowed |
| `UNKNOWN` | provider transport failure, unparseable reply, or structurally rejected reply (`reason` + `issues` recorded); never rendered | no |

### Validation caps (all deterministic, in-module)

≤16 variables, ≤32 constraints, integer coefficients `|c| ≤ 1000`, bounds
`|b| ≤ 10^6`, names `^[a-z][a-z0-9_]{0,15}$`, no duplicate variables, only
declared variables in constraints/objective, no zero coefficients, ops
`< <= == >= >`, all bounds finite safe integers with `lower ≤ upper`,
`question ∈ {sat, optimize}`, assumptions ≤16×256 chars, clarifications
≤8×256 chars. Any violation → status `UNKNOWN` with the specific issues
(hostile replies are data, never authority).

### Rendering (deterministic)

- **SMT-LIB2 / QF_LIA** — `renderSmtLib(model, {mode})`. `mode:"plan"` is
  answer-only: `set-logic QF_LIA`, `declare-fun`, bound/constraint `assert`s,
  `check-sat`, `exit`. `mode:"witness"` additionally emits
  `(get-value (…))` for evidence tooling AFTER an `AGREE_SAT` verdict; it is
  never placed in a plan step. Measured reason: z3 5.4.0 exits **1** on
  `(get-model)` after `unsat` (trusted host, 2025-11), and an executor step
  must not risk a nonzero exit on an unpredictable answer.
  `verifyRenderedSmt` proves per artifact: balanced parens (string-aware),
  top-level commands only from
  `{set-logic, declare-fun, assert, check-sat, get-model, exit}` (plus
  `get-value` in witness mode), and every atom drawn only from declared
  variables, `Int`, `QF_LIA`, the comparison/arithmetic operators and the
  command names.
- **LP (HiGHS typed shape)** — `renderLpModel(model)` for `question:"optimize"`
  only. Emits the exact `{sense, objective, variables[{lower,upper}],
  constraints[{lower,upper,coefficients}]}` shape and probes it through
  `planPortfolioOperation("highs","solve-lp", …)` — the same validator the
  executor-side gateway applies. Strict ops (`<`, `>`) are rejected in the LP
  arm: strict inequalities have no LP form, and the integer shift
  (`x < 5 ≡ x ≤ 4`) is unsound once integrality is dropped.

### Provenance (always preserved)

`original_text` (verbatim canonical form), `original_text_sha256`, provider
name/model, `prompt_sha256`, `response_sha256`, the structured model, the
rendered text + its sha256, and the explicit `assumptions` list. The core is
hash-bound: `proposal_sha256` = canonical sha256 over
`{original_text, provider, prompt_sha256, response_sha256, model, rendering}`;
tampering is detected (`NL_TAMPERED`) before anything downstream happens.

---

## 2. Honesty rules (binding)

1. **Translation proposal, never a translation.** The LLM output is
   UNTRUSTED DATA. The module's own words on every `MODEL_PROPOSED` record:
   `semantic_status: "TRANSLATION_PROPOSAL_NOT_VERIFIED_AGAINST_TEXT"` and an
   `honesty_note` stating a human must review it. **No code path in this
   module claims semantic equivalence** between the text and the model —
   render validity is a statement about the renderer, not about fidelity.
2. **The approval gate is the only path to a plan.** `approveModel(proposal,
   {approved, edited?, lpRelaxationAcknowledged?})` — explicit boolean
   decision. `approveModel` rejects everything that is not `MODEL_PROPOSED`;
   `buildPlanFromApprovedModel` accepts only `USER_APPROVED` records with
   intact hashes and a fresh render equal to the stored rendering
   (`NL_RENDER_DRIFT`). An `edited` model is re-validated and re-rendered;
   the edit is flagged in `review`. R3: an optimize FINAL model (directly or
   via `edited`) additionally requires `lpRelaxationAcknowledged: true` —
   otherwise approval returns the restricted
   `UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION` record (§3), never a plan.
3. **The plan binds the full provenance chain.** `buildPlanFromApprovedModel`
   embeds `canonicalJson({original_text, structured_model, rendering})` as a
   second ProblemSpec requirement (source ref `nl-model-provenance`), so
   `plan.source.problem_sha256` and every step `input_sha256` cover the whole
   chain — change one character of the original text and the plan id changes.
4. **Target mapping is semantic, not a flag.** `question:"sat"` → SMT plan
   (`z3` + `cvc5` + `cross-check`, `agree_on sat/unsat`). `question:"optimize"`
   → LP plan (HiGHS only). Any mismatch → `NL_TARGET_MISMATCH`.
5. **LP arm is fail-closed and discloses integrality loss.** The HiGHS typed
   shape has no integrality field, so there is NO exact-integer execution
   operation. R3: approving an optimize model without the explicit
   `lpRelaxationAcknowledged` acknowledgement returns
   `UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION` (plan `null`, never a silent LP
   stand-in). With the acknowledgement, the plan carries machine-readable
   `LP_RELAXATION_ONLY` metadata (§3) in addition to the
   `NL_LP_RELAXATION_ASSUMPTION` prose: the executed answer characterizes the
   continuous relaxation only, not the integer problem.
6. **Witness ≠ fidelity.** The J1 witness probe re-queries z3 with
   `get-value` and checks every rendered bound/constraint against the
   retrieved integers. That is a consistency check on the MODEL's answer; it
   is **not** evidence that the translation matches the Chinese text.
7. **No silent guessing.** Vague or unbounded texts must produce
   `NEEDS_CLARIFICATION` with the model's specific questions, or `UNKNOWN`
   with the recorded issues. Neither is ever rendered or executed.

---

## 3. R3 follow-up — LP relaxation is explicit and fail-closed (i180/R3)

Audit finding (i180 #180): the LP arm silently produced a HiGHS
`solve-lp` plan from a plain `approved: true`, and HiGHS is a CONTINUOUS LP —
the relaxation optimum can differ from the integer optimum (e.g. max x over
integer x∈[0,10] with 2x ≤ 5: LP optimum 2.5, integer optimum 2). A consumer
could read the executed 2.5 as "the integer optimum". Minimal fix, all
additive, all three core API signatures unchanged:

### 3.1 Decision field `lpRelaxationAcknowledged`

`approveModel(proposal, decision)` gains one optional boolean decision field,
`decision.lpRelaxationAcknowledged`. The gate applies to the FINAL model
(after any `edited` revalidation — so a sat proposal edited into an optimize
model hits the same gate):

- `question:"optimize"` and `lpRelaxationAcknowledged !== true` → approval
  RETURNS (never throws) the restricted record
  `status: "UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION"` with `plan: null`. It is
  not plan-eligible (`buildPlanFromApprovedModel` → `NL_NOT_APPROVED`). No
  silent degradation to the relaxation, ever.
- `question:"optimize"` and `lpRelaxationAcknowledged === true` → normal
  `USER_APPROVED` record; the canonical acknowledgement is recorded
  hash-covered at `review.lp_relaxation_ack`.
- `question:"sat"` is unaffected (no ack required, no ack recorded).

### 3.2 Frozen JSON contracts

**(a) The restricted unsupported record** (returned by `approveModel`):

```json
{
  "schema": "formal-tools/nl-model-approved/0.1",
  "status": "UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION",
  "original_text": "<verbatim canonical NL text>",
  "proposal_sha256": "<64 hex>",
  "question": "optimize",
  "edited": false,
  "model": { "…validated structured model…" },
  "unsupported": {
    "code": "UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION",
    "reason": "LP_RELAXATION_NOT_ACKNOWLEDGED",
    "dropped": ["integrality"],
    "available_operation": "highs/solve-lp (continuous LP relaxation only; no integer MIP typed operation)",
    "required_decision_field": "lpRelaxationAcknowledged",
    "remedies": [
      "re-approve with lpRelaxationAcknowledged: true to explicitly accept the LP relaxation (results then characterize the continuous relaxation only)",
      "wait for a future integer MIP typed operation adapter"
    ]
  },
  "detail": "<fixed NL_INTEGER_OPTIMIZATION_UNSUPPORTED_NOTE sentence>",
  "review": { "approved": false, "edited": false, "rejected": false, "unsupported": true },
  "plan": null,
  "honesty_note": "fail-closed: no plan was produced and the LP relaxation was not presented as an integer optimum"
}
```

**(b) `review.lp_relaxation_ack`** on every approved optimize model (inside
the hash-covered `review`, so post-hoc mutation is `NL_TAMPERED`):

```json
{ "acknowledged": true, "kind": "LP_RELAXATION_ONLY", "dropped": ["integrality"], "decision_field": "lpRelaxationAcknowledged" }
```

**(c) `relaxation` on the `buildPlanFromApprovedModel` return wrapper**
(`null` for the smt target; the ExecutionPlan envelope schema is frozen —
`validateExecutionPlan` enforces an exact field allowlist — so the metadata
cannot ride as a new envelope field):

```json
{
  "kind": "LP_RELAXATION_ONLY",
  "dropped": ["integrality"],
  "meaning": "<the NL_LP_RELAXATION_ASSUMPTION sentence>",
  "effect": "plan results characterize the continuous LP relaxation only; the optimal value is a bound for the integer problem, not its exact optimum",
  "ack": { "acknowledged": true, "kind": "LP_RELAXATION_ONLY", "dropped": ["integrality"], "decision_field": "lpRelaxationAcknowledged" }
}
```

**(d) Machine-readable marker INSIDE the plan**: one additional plan
assumption, the canonical JSON string (keys sorted, deterministic,
`nlLpRelaxationPlanAssumption()`), so a consumer holding only the plan
envelope can machine-detect the relaxation:

```
{"ack":{"acknowledged":true,"field":"lpRelaxationAcknowledged"},"dropped":["integrality"],"kind":"LP_RELAXATION_ONLY","relaxed_from":"QF_LIA integer model"}
```

The prose `NL_LP_RELAXATION_ASSUMPTION` assumption coexists (never replaced).

### 3.3 Defense in depth + binding scope

`buildPlanFromApprovedModel` requires `review.lp_relaxation_ack` to equal the
exact canonical record (b) — a hand-carried record with a self-consistent
`approved_sha256` but a missing or shape-divergent ack throws
`WorkflowError("UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION")`. R3 intentionally
does NOT attempt to prove semantic equivalence between text and model: the
existing hash bindings (`approved_sha256` over model+rendering+review,
provenance requirement `r2` + `input_sha256` per step) remain the only
model↔result binding, verified SAT and UNSAT alike.

---

## 4. Worked examples (REAL runs, live receipts)

All receipts committed under `validation/local-runtime-receipts/nl-model-*`,
recorded at the commit SHA in `nl-model-run.json.source_sha`
(f84d3b9789138481d96cf6d9a382fa0a2d09fbde), provider `deepseek-chat`
(real API), solvers z3 5.4.0 / cvc5 1.4.2 / HiGHS 1.15.1 from the portable
bundle on the trusted Debian 13 host. Driver exit 0, `all_matched: true`.

### 4.1 成立例 — sat with witness (J1)

Text (Chinese): 「找出整数 x 和 y:x 至少是 3,y 至少是 1,两个都不超过
50,x+y 恰好是 7 的倍数,并且 y 不超过 x。这样的整数对存在吗?」

Real DeepSeek → `MODEL_PROPOSED`: variables `x∈[3,50]`, `y∈[1,50]`, auxiliary
`k∈[-100,100]` ("bounds widened safely", recorded in `assumptions`),
constraints `x+y-7k = 0` and `y-x ≤ 0` → rendered QF_LIA → surrogate approval
(hash-covered `reviewer`/`note`) → plan `wf-e3dbbfc68a09c717591adc992e2933df`
(z3+cvc5+compare) → **AGREE_SAT** (z3 5.4.0 + cvc5 1.4.2 both `sat`) → z3
witness probe retrieved **(x,y,k) = (6,1,1)**: 6+1 = 7 = 7·1 and y ≤ x —
every rendered bound and constraint holds (receipt
`nl-model-j1-sat.witness.json`). Per honesty rule 6 this proves the model's
answer, not the translation.

### 4.2 反例 — false claim disproved (J2)

Text: 「x 是一个整数,它至少是 5,同时又不超过 3。请问:满足这两个条件的 x
存在吗?」 → `MODEL_PROPOSED`: DeepSeek gave x wide neutral bounds
`[-1000000, 1000000]` and encoded the contradiction as two constraints
`x ≥ 5` and `x ≤ 3` (exactly the prompt's anti-crossed-bounds rule) → plan
`wf-acce01a7c0e983f3c701a4de8e6a30f4` → **AGREE_UNSAT** — the claim is
disproved *under the rendered model*.

### 4.3 无法安全形式化负例 — NEEDS_CLARIFICATION (J3)

Text: 「证明我们的系统总体上是安全的」 → real DeepSeek returned two specific
questions (which concrete quantities/variables/numeric bounds define "safe";
which linear thresholds such as failure-rate ≤ X or redundancy ≥ Y with their
numeric values) → status `NEEDS_CLARIFICATION`, `rendering: null`, approval
attempt throws `NL_NOT_APPROVABLE`. Nothing rendered, nothing executed.
Receipt: `nl-model-j3-clarification.proposal.json`.

### 4.4 LP arm (J4, bonus)

Text: 「最大化 3x+2y,其中 x 和 y 都是非负整数,x+y 不超过 4,并且 x 不超过
3」 → `MODEL_PROPOSED` with `question:"optimize"` → LP plan (4 assumptions,
integrality-drop note recorded) → HiGHS **kOptimal, objective 11** at the
vertex **(x,y) = (3,1)** — the hand-provable LP relaxation optimum (same
instance as the V6 fixture).

**R3 note**: the committed J4 receipts predate R3 and show the pre-R3
surrogate approval (plain `approved: true`). Under R3 that approval would
fail closed (`UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION`); the driver now first
records that fail-closed probe and then approves with
`lpRelaxationAcknowledged: true` before executing, asserting the
`LP_RELAXATION_ONLY` metadata on the approval, the wrapper and the plan.

Driver: `node tests/nl-model.driver.mjs --source-sha <sha>` on the trusted
host (env `DEEPSEEK_API_KEY`, `FORMAL_PORTABLE_ROOT`,
`FORMAL_PORTABLE_RUNNER_SHA256`); exit 0 iff every journey matched its
expectation. Summary: `validation/local-runtime-receipts/nl-model-run.json`.

---

## 5. Limits

- **Scope**: bounded integer linear problems renderable to QF_LIA with the
  caps above; LP relaxation for explicit optimization. No non-linear terms,
  no quantifiers, no strings/arrays, no strict ops in the LP arm.
- ≤ 16 variables / ≤ 32 constraints / ≤ 8 KiB text; single DeepSeek round
  trip per attempt (≤ 2 attempts recorded by the driver, no hidden retries).
- `question:"sat"` proposals with an `objective` are rejected (an unenforced
  objective would be dishonest); `question:"optimize"` has no SMT path
  (min/max commands are outside the frozen render allowlist and the executor
  parses only sat/unsat/unknown).
- The approval gate in the committed journeys was exercised by a **driver
  surrogate**, explicitly labeled as such — a human must review the recorded
  model before any production use.
- z3 witness probes run with `get-value` only for `AGREE_SAT` journeys;
  cvc5 would need `--produce-models` and is not part of the witness path.
- **R3**: no exact integer optimization support — the only optimize
  execution operation is the continuous LP relaxation, gated behind the
  explicit `lpRelaxationAcknowledged` decision (§3). Exact integer optima
  require a future integer MIP typed operation adapter.

## 6. Files

| file | role |
| --- | --- |
| `packages/runner/js/nl-model.mjs` | module (proposal/validation/rendering/approval/plan) |
| `tests/nl-model.test.mjs` | offline tests (stubs only, CI) |
| `tests/nl-model.driver.mjs` | real journeys driver (host-only, not in CI glob) |
| `docs/mvp/NL_MODEL.md` | this document |
| `validation/local-runtime-receipts/nl-model-*.json` / `.log` | committed live evidence |
