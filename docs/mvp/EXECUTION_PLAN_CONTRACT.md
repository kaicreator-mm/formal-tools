# ExecutionPlan Contract (i180/V2 — V0 cross-lane freeze)

Status: frozen V0 contract for lanes V2 (planning + compilation, this document),
V3 (executor), V4 (portfolio integration), V5 (audit). Implementations:

- `packages/runner/js/workflow-plan.mjs` — normalization, provider adapter, plan builder/validator
- `packages/runner/js/workflow-compiler.mjs` — deterministic launcher compiler
- `registry/EXECUTION_PLAN.schema.json` — formal JSON Schema (draft 2020-12)

## 1. Data shapes

### ExecutionPlan — `formal-tools/execution-plan/1.0`

```json
{ "schema": "formal-tools/execution-plan/1.0",
  "plan_id": "wf-<32 hex>",
  "source": { "problem_sha256": "<sha256>", "problem_kind": "<tag>" },
  "assumptions": ["<explicit string assumptions>"],
  "method_dag": [{ "id": "m1", "kind": "solve|cross_check", "depends_on": [] }],
  "steps": [{ "id": "step-1", "tool": "z3", "operation": "solve-smt",
              "depends_on": [], "input": {},
              "input_sha256": "<sha256>", "timeout_s": 30,
              "expected_output_kind": "smt-answer" }],
  "budgets": { "max_steps": 8, "max_total_timeout_s": 120 },
  "compiled": { "launcher_sha256": null, "manifest_sha256": null } }
```

- `additionalProperties: false` at every level. Unknown keys anywhere
  (envelope, source, step, input, budgets, compiled, method_dag entry) are a
  rejection (`PLAN_SCHEMA_INVALID`), never silently dropped.
- `plan_id` = `"wf-" + sha256(canonical({source, assumptions, method_dag,
  steps, budgets})).slice(0, 32)` — stable, content-derived.
- `method_dag` mirrors `steps` 1:1 in order; `kind` is `solve` for
  solver/LP steps and `cross_check` for compare steps; `depends_on` equals the
  step's `depends_on`.
- `compiled` is null/null at build time. Only `compilePlan` backfills it, and
  only in the returned copy; the caller's plan object is never mutated.

### LauncherManifest — `formal-tools/launcher-manifest/1.0`

```json
{ "schema": "formal-tools/launcher-manifest/1.0", "plan_id": "wf-…",
  "plan_sha256": "<…>", "launcher_sha256": "<…>", "entry": "launcher.mjs",
  "runtime": "node>=20", "generated_by": "workflow-compiler@1.0",
  "deterministic": true }
```

Hash chain (no cycles):
1. `plan_sha256` = sha256 of the canonical plan JSON with
   `compiled = {null, null}` (the "execution-relevant" form; the backfilled
   `compiled` fields are pure custody metadata and are excluded).
2. `launcher_sha256` = sha256 of the launcher source text (which embeds the
   plan and header with `plan_id` + `plan_sha256`).
3. `manifest_sha256` = sha256 of the canonical manifest JSON; recorded in the
   returned plan copy as `compiled.manifest_sha256`.

## 2. Canonicalization rule (exact)

`canonicalJson(value)`: recursively, object keys are sorted by **UTF-16 code
unit order** (default `Array#sort`; deliberately NOT `localeCompare`, which is
locale-dependent), array order is preserved, then standard `JSON.stringify`
output. `sha256Canonical(value)` = sha256 hex over the UTF-8 bytes of that
string. Hash domains:

- `step.input_sha256` = `sha256Canonical(step.input)`.
- `source.problem_sha256` = `sha256Canonical(problem)` where `problem` is the
  bounded ProblemSpec (`formal-tools/problem-spec/0.1`). For
  `normalizeUserProblem(text)` the canonical user text is `NFC → CRLF/CR→LF →
  trim`, whose text sha256 is also stored in `source_refs[0].sha256`.
- plan/manifest hashes as in §1.

Number formatting is whatever `JSON.stringify` produces for the JS number
(ES-specified, engine-stable). Values that are not JSON-safe (functions,
symbols, bigints, cyclic structures, `toJSON` accessors) are rejected.

## 3. Typed-operation allowlist (frozen)

| tool | operation | input | expected_output_kind | method_operation admitted | notes |
|---|---|---|---|---|---|
| z3 | solve-smt | `{smt_lib}` | smt-answer | `solve` | smt_lib ≤ 64 KiB |
| cvc5 | solve-smt | `{smt_lib}` | smt-answer | `solve` | smt_lib ≤ 64 KiB |
| highs | solve-lp | LP model (§4) | lp-status | `UNRESOLVED` | caps below |
| compare | cross-check | `{left_step,right_step,agree_on}` | cross-tool-verdict | none (executor-side) | operands must exist and be `depends_on` members |

Anything else ⇒ reject (`PLAN_UNKNOWN_TOOL` / `PLAN_UNKNOWN_OPERATION`).
`compare` steps have no method counterpart; every registered-tool plan step
must correspond to an admitted G2 method step (same id, `tool_id`, admitting
method operation, same dependency set) — divergence ⇒ `PLAN_METHOD_INVALID`.

`agree_on` ⊆ {`sat`, `unsat`, `optimal-status`}, non-empty, unique.

## 4. HiGHS LP model caps (mirrored from tool-portfolio-t4.mjs)

Validation delegates to `planPortfolioOperation("highs","solve-lp",model)` —
the same pure validator the portfolio runner uses, so caps cannot drift:

- exact keys `{sense, objective, variables, constraints}`; `sense` ∈ min|max
- objective: dense array 1..64 finite numbers; `variables` length == objective
- bounds `null` or finite; `lower <= upper`
- constraints 0..128 × `{lower, upper, coefficients}`, coefficients dense,
  length == objective
- normalized JSON ≤ 65536 bytes (`PLAN_OVERSIZED`)
- step `timeout_s` ≤ `budget.max_timeout_s` (30) from the portfolio plan

## 5. Budgets and size caps

- `steps` 1..8; `budgets.max_steps` 1..8 (default 8);
  `budgets.max_total_timeout_s` 1..120 (default 120); per-step `timeout_s`
  1..120 integer; Σ timeout ≤ max; highs ≤ 30 (above).
- problem text ≤ 64 KiB canonical; assumptions ≤ 32 × 512 chars;
  smt_lib ≤ 64 KiB; canonical plan JSON ≤ 256 KiB (transport bound).

## 6. Error codes (WorkflowError.code)

`PLAN_SCHEMA_INVALID` (shape/unknown keys/ids/problem spec),
`PLAN_UNKNOWN_TOOL`, `PLAN_UNKNOWN_OPERATION`, `PLAN_DUP_STEP_ID`,
`PLAN_UNBOUND_DEP`, `PLAN_CYCLE`, `PLAN_HASH_MISMATCH`,
`PLAN_BUDGET_EXCEEDED` (range/sum/step-count violations incl. per-step
timeout bounds), `PLAN_INPUT_INVALID` (op-specific input shape, operand rules,
declared output kind), `PLAN_OVERSIZED`, `PLAN_METHOD_INVALID` (assessMethod
rejection or method↔step divergence). Provider codes: `BLOCKED_PROVIDER` (no
key), `PROVIDER_FAILED` (http/network/timeout/parse; details carry only
status/reason — never the key, URL bodies or exception text).

## 7. Untrusted-LLM boundary

- `proposeMethod(problem, generate, egressAuthority)` (method-planner.mjs) is
  the only admission path; its verdict (`STRUCTURALLY_VALID` + issues) is a
  precondition of `buildExecutionPlan`, which re-runs `assessMethod`.
- `makeDeepSeekChatProvider()` adapts DeepSeek `/chat/completions`
  (temperature 0, `response_format: json_object`, 60 s abort) to the
  `generate(prompt)` callback contract. The key comes from
  `process.env.DEEPSEEK_API_KEY` only, travels only in the Authorization
  header, and never appears in errors, details or logs. No key ⇒
  `BLOCKED_PROVIDER`; callers decide to skip.
- The proposal (method) is DATA. It can only enter a plan through the static
  gates above; hostile keys (`argv`, `shell`, `env`, `pre_exec`, …) are
  structurally impossible (unknown-key rejection), so no LLM string ever
  reaches code, argv, env or shell.

## 8. Compiler guarantees and security properties

`compilePlan(plan)` (workflow-compiler.mjs):

- **Deterministic**: byte-identical launcher + manifest for the same plan,
  independent of input key order; no timestamps, no randomness.
- **Inert text**: the launcher is a fixed header (plan_id, plan_sha256),
  `const PLAN = Object.freeze(JSON.parse("<canonical plan JSON>"))` — plan
  data exists only inside that JSON string literal — a guarded
  `await import(resolveExecutorUrl())` whose specifier comes only from the
  trusted-executor locator below, `main(argv)` which calls
  `executeWorkflowPlan(PLAN)` and writes the receipt to `process.argv[2]`
  (never a plan field). No shell, child_process, eval, dynamic requires
  computed from data, env mutation, or LLM text outside the plan literal.
- **Trusted-executor locator (i180/R2, runtime — never compile time)**:
  the launcher resolves `workflow-executor.mjs` when it runs, in this order:
  1. `FORMAL_TOOLS_RUNNER_ROOT` if set (non-empty): must be a directory
     containing `packages/runner/js/workflow-executor.mjs`, validated with
     `existsSync` BEFORE the import; anything else ⇒ exit 2 +
     `RUNNER_ROOT_INVALID`, no receipt (fail loud — never a silent fallback
     to a different executor).
  2. Otherwise the fixed relative specifier
     `../../packages/runner/js/workflow-executor.mjs` resolved against the
     launcher's own location (in-repo `artifacts/<plan_id>/` layout —
     unchanged pre-R2 behavior).
  No absolute path is ever baked into the launcher text, so `compilePlan`
  stays byte-deterministic and machine-independent, and a launcher emitted
  under an arbitrary cwd executes against the trusted runner when the caller
  (user, trusted host, harness, or `workflow execute`) exports
  `FORMAL_TOOLS_RUNNER_ROOT=<repository root>`. The only locator inputs
  are the environment and the launcher's own URL — never plan or LLM data.
  The env root must be a full runner root (repo-root layout): the executor
  module resolves its repo-root assets (`registry/`,
  `docs/tool-portfolio/`) relative to its own location, so a partial
  directory that contains only the executor file fails the import and the
  launcher still fails closed (`NOT_COMPILED_FOR_EXECUTION`, exit 2, no
  receipt).
- **Fail-closed**: with no locator hit (`RUNNER_ROOT_INVALID`) or no
  executor at the resolved location (`NOT_COMPILED_FOR_EXECUTION`), running
  the launcher exits with code 2 and writes no receipt (the plan stays
  honestly `NOT_RUN`); missing receipt path ⇒ code 1 + `LAUNCHER_USAGE`;
  any other failure ⇒ code 1.
- **Non-mutating**: the caller's plan is cloned; hashes are backfilled only
  in the returned copy.
- Tamper sensitivity: any step hash drift, cycle, unknown key or allowlist
  violation is rejected at compile time with the same `PLAN_*` codes.

## 9. NOT_RUN semantics (honesty)

- Plan build and compilation execute NOTHING. `tool_execution` stays
  `NOT_RUN`; no receipt exists. "Executed" claims may only come from a real
  executor receipt (`formal-tools/execution-receipt/1.0`, V3).
- The only real LLM claim allowed in V2 evidence: an actual DeepSeek call via
  `makeDeepSeekChatProvider` (record model name + plan_id). CI runs without
  the key skip the real-call test (`BLOCKED_PROVIDER`) and count as stubs.

## 10. Handoff notes

- **V3 (executor)**: implement `workflow-executor.mjs` exporting
  `executeWorkflowPlan(plan)`; validate with `validateExecutionPlan` (accepts
  `compiled` backfilled), recompute `input_sha256` per §2, respect §3/§4/§5
  caps, emit `formal-tools/execution-receipt/1.0` with per-step receipts and
  honest NOT_RUN on skips. The launcher already freezes the plan and routes
  the receipt path via argv.
- **V4 (portfolio)**: keep `planPortfolioOperation` as the single LP validator
  source; if its caps change, plan validation follows automatically; the
  launcher/embedded plan must be re-compiled (plan_sha256 changes only when
  plan content changes).
- **V5 (audit)**: verify chains: `manifest.plan_sha256` ↔ canonical plan
  (compiled=null), `manifest.launcher_sha256` ↔ launcher bytes,
  `plan.compiled.manifest_sha256` ↔ canonical manifest. The registry schema
  (`EXECUTION_PLAN.schema.json`) is the formal shape authority for diffing.
