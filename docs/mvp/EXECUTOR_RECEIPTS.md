# Executor & Receipts (V3, issue #183) — typed DAG execution with hash-bound receipts

OUTPUT_LABEL=FORMAL_TOOLS_I180_V3_TYPED_DAG_EXECUTION
Parent: #180 (MVP V0 pinned contracts). Branch: `i180/v3` @ `33bd3d0c588f40adad8dfb5a7a5449de3345bd0a`.

Modules (exclusive write set):

- `packages/runner/js/workflow-executor.mjs` — `executeWorkflowPlan(plan, options)`, `validateExecutionPlan(plan)`, `WorkflowPlanError`, `WorkflowBlockedError`.
- `packages/runner/js/workflow-evidence.mjs` — `buildExecutionReceipt(input)`, `writeExecutionReceiptArtifacts(dir, receipt, rawStreams)`, `canonicalJsonBytes(value)`, `sha256Hex`, `boundText`.

The plan is consumed as **validated DATA only** (`formal-tools/execution-plan/1.0`): structure, tool allowlist, canonical input hashes, DAG closure and budgets are re-validated by the executor itself — no code coupling to the V2 plan compiler, so the lanes CI independently.

## 1. Execution semantics

- **Validation before anything**: a plan that fails re-validation throws `WorkflowPlanError` with code `PLAN_SCHEMA_INVALID | PLAN_ID_INVALID | PLAN_SOURCE_INVALID | PLAN_ASSUMPTIONS_INVALID | PLAN_METHOD_DAG_INVALID | PLAN_BUDGETS_INVALID | PLAN_COMPILED_INVALID | PLAN_STEPS_INVALID | PLAN_BUDGET_EXCEEDED | PLAN_STEP_FIELDS_INVALID | PLAN_STEP_ID_INVALID | PLAN_DUP_STEP | PLAN_TOOL_NOT_ALLOWED | PLAN_OPERATION_MISMATCH | PLAN_UNBOUND_DEPENDENCY | PLAN_CYCLE | PLAN_TIMEOUT_INVALID | PLAN_EXPECTED_KIND_INVALID | PLAN_INPUT_INVALID | PLAN_HASH_MISMATCH | PLAN_COMPARE_INVALID`. Nothing is executed, no workspace is created.
- **Allowlist (V0 pin)**: `z3|cvc5 → solve-smt` (input `{smt_lib}`, kind `smt-answer`), `highs → solve-lp` (LP model object per `planPortfolioOperation`, kind `lp-status`), `compare → cross-check` (input `{left_step, right_step, agree_on}`, kind `cross-tool-verdict`). `agree_on` is a non-empty, unique array over `sat|unsat|optimal-status` (`registry/EXECUTION_PLAN.schema.json` `compareInput`). Timeout ranges: solve-smt/cross-check 1..120 s, solve-lp 1..30 s (portfolio budget).
- **Canonical JSON** (shared rule): recursively sort object keys, no whitespace, UTF-8 — `canonicalJsonBytes`. `input_sha256` is `sha256(canonicalJsonBytes(input))`; `plan_sha256` is `sha256(canonicalJsonBytes(plan))`.
- **Preflight before any step**: `FORMAL_PORTABLE_ROOT` must be absolute and exist; every named tool binary must exist (`tools/<tool>/bin/<tool>`; highs: `bin/tool-runner` + `tools/highs/run`); one bounded `--version` probe per solve-smt tool. Any miss throws `WorkflowBlockedError` (code `BLOCKED_TOOL_MISSING` or `BLOCKED_TOOL_VERSION_PROBE`) **with a full ABORTED receipt attached** (`error.receipt`) for evidence.
- **DAG execution**: Kahn topological order, stable by plan order, sequential (deterministic). A step runs only if all `depends_on` steps are `EXECUTED`; otherwise it is `SKIPPED_DOWNSTREAM`. Wall-clock budget: once `budgets.max_total_timeout_s` is exhausted, unlaunched steps stay `NOT_RUN` and the run records `BUDGET_WALL_CLOCK_EXCEEDED`.
- **No shell anywhere**: the only process launch is `spawn(argv, {shell:false})` through the injectable `captureImpl` (`(argv,{cwd,timeoutMs,env}) => {exit_code, timed_out, output_limit, error, stdout, stderr}`), and solve-lp is delegated to the existing T4 gateway `runPortfolioOperation` (injectable as `solveLpImpl` for offline tests). solve-smt writes `steps/<id>/input.smt2` into the per-run workspace and spawns `["input.smt2"]` with cwd = the step directory.
- **solve-smt parsing**: the first stdout line that is exactly `sat|unsat|unknown` is the answer. Exit != 0 is `ERROR` (`SOLVER_NONZERO_EXIT`) **even if an answer token is present**; exit 0 with no token is `ERROR` (`SOLVER_OUTPUT_UNPARSABLE`). Never guess.
- **solve-lp mapping**: `T4_OPERATION_EXECUTED_UNREVIEWED` → step `EXECUTED`, `result` = the portfolio `solver` object (`model_status` `kOptimal|kInfeasible|...`); `PORTFOLIO_OPERATION_FAILED` → `TIMEOUT` (if `process.timed_out`) or `ERROR` (`HIGHS_ADAPTER_FAIL_CLOSED`); anything else (incl. `NOT_RUN_FAIL_CLOSED` and synchronous `planPortfolioOperation` throws) → `ERROR` with the adapter's reason.
- **cross-check**: computed from completed dependency results only; `sat`/`unsat` agree → `AGREE_SAT`/`AGREE_UNSAT`; differ → `CONTRADICTION`; any unknown/unavailable → `UNKNOWN` (with `unknown_reason`). LP answers normalize `kOptimal→sat`, `kInfeasible→unsat`, others → `unknown`.

Options: `{captureImpl?, solveLpImpl?, workspaceDir?, sourceSha?, env?, now?, runId?, host?}` — all injectable for deterministic offline tests (`now` drives `created_at`, per-step `elapsed_ms` and the wall-clock guard). Returns `{receipt, workspaceDir}`; receipt + bounded logs + hash manifest are written into the workspace.

## 2. Receipt schema — `formal-tools/execution-receipt/1.0`

```json
{ "schema": "formal-tools/execution-receipt/1.0", "run_id": "...", "plan_id": "...",
  "plan_sha256": "<64hex>", "source_sha": "<40hex git HEAD | 64hex>", "created_at": "<ISO-8601 Z>",
  "tool_versions": { "z3": {"version": "...", "probe_sha256": "<64hex>", "probe_bounded": "<=256B"},
                      "highs": {"version": "highspy 1.15.1", "probe_sha256": null, "probe_bounded": null} },
  "steps": [ { "step_id": "...", "tool": "...", "operation": "...",
               "status": "EXECUTED|NOT_RUN|TIMEOUT|ERROR|SKIPPED_DOWNSTREAM",
               "exit_code": 0, "elapsed_ms": 12,
               "stdout_sha256": "<64hex over FULL bytes>", "stderr_sha256": "<64hex>",
               "stdout_bounded": "<first 4096 bytes, utf8>", "stderr_bounded": "<...>",
               "result": {"answer": "sat|unsat|unknown"} | {"model_status": "kOptimal", ...}
                        | {"verdict": "AGREE_UNSAT"} | {"error": "..."} | null,
               "artifacts": [ { "name": "steps/z3-solve/input.smt2", "sha256": "<64hex>", "bytes": 117 } ] } ],
  "overall": { "process_outcome": "OK|PARTIAL|FAILED|ABORTED",
               "solver_answer": {"kind": "solve-smt|solve-lp|mixed|none", "value": "sat|unsat|null", "by_step": [...]},
               "cross_tool_verdict": "AGREE_SAT|AGREE_UNSAT|CONTRADICTION|UNKNOWN|NOT_APPLICABLE",
               "claim_verdict": "PASS|UNSUPPORTED_BY_MVP|NOT_APPLICABLE|BLOCKED",
               "fail_closed_reason": "..." (present only when set) },
  "environment": { "host": "...", "node": "v22.16.0", "formal_portable_root_sha": "<64hex|null>" } }
```

Workspace artifacts (`writeExecutionReceiptArtifacts`): `receipt.json`, `logs/<step>.stdout.txt` / `.stderr.txt` (verbatim bounded copies — re-verifiable against the receipt hashes), and `manifest.json` (`formal-tools/execution-artifacts/1.0`) binding `receipt_sha256` + per-log hashes.

## 3. Verdict semantics — three different questions

**process EXIT ≠ solver answer ≠ user claim.** They are separate receipt fields and must never be collapsed.

| situation | process_outcome | cross_tool_verdict | claim_verdict | fail_closed_reason |
|---|---|---|---|---|
| all steps executed, cross-check agrees, all answers definitive | OK | AGREE_SAT / AGREE_UNSAT | PASS | — |
| all steps executed, solvers disagree | **OK** (processes ran fine) | CONTRADICTION | UNSUPPORTED_BY_MVP | CROSS_TOOL_CONTRADICTION |
| all steps executed, an answer is `unknown` | OK | UNKNOWN | UNSUPPORTED_BY_MVP | — |
| single-tool plan (no compare steps), steps OK | OK | NOT_APPLICABLE | NOT_APPLICABLE | — |
| a step ERROR / TIMEOUT | FAILED | (verdicts so far) | UNSUPPORTED_BY_MVP | step-level code |
| budget wall-clock exhausted mid-plan | PARTIAL | (verdicts so far) | UNSUPPORTED_BY_MVP | BUDGET_WALL_CLOCK_EXCEEDED |
| preflight blocked (tool/binary/version probe) | ABORTED | NOT_APPLICABLE | BLOCKED | BLOCKED_TOOL_MISSING / BLOCKED_TOOL_VERSION_PROBE |

`PASS` requires **independent cross-tool agreement** plus definitiveness of every executed solve answer; exit codes and solver answers alone can never produce `PASS`. `UNKNOWN` stays `UNKNOWN`.

## 4. Fail-closed catalog (all codes observed or enforced)

| code | trigger | behavior |
|---|---|---|
| `PLAN_HASH_MISMATCH` | `input_sha256` ≠ canonical hash | throw before workspace/execution; zero captures |
| `PLAN_CYCLE` / `PLAN_DUP_STEP` / `PLAN_UNBOUND_DEPENDENCY` | DAG closure violations | throw at validation |
| `PLAN_TOOL_NOT_ALLOWED` / `PLAN_OPERATION_MISMATCH` / `PLAN_INPUT_INVALID` | allowlist/shape violations | throw at validation |
| `PLAN_BUDGET_EXCEEDED` | steps/timeout sums exceed budgets | throw at validation |
| `BLOCKED_TOOL_MISSING` | root/binary/runner missing | `WorkflowBlockedError` + ABORTED receipt, nothing executed |
| `BLOCKED_TOOL_VERSION_PROBE` | `--version` failed/empty | same as above |
| `STEP_TIMEOUT` | capture reports `timed_out` | step TIMEOUT, downstream SKIPPED_DOWNSTREAM, FAILED |
| `SOLVER_NONZERO_EXIT` | exit != 0 (even with answer-looking stdout) | step ERROR — real z3 5.4.0 emits an error line AND a spurious `sat` on malformed input (see N1 receipt) |
| `SOLVER_OUTPUT_UNPARSABLE` | exit 0 but no full-line answer token | step ERROR |
| `STEP_PROCESS_ERROR` | spawn error / output limit / workspace I/O | step ERROR |
| `HIGHS_ADAPTER_FAIL_CLOSED` | portfolio gateway `NOT_RUN_FAIL_CLOSED`/`PORTFOLIO_OPERATION_FAILED`/throw | step ERROR with adapter reason |
| `CROSS_TOOL_CONTRADICTION` | compare verdict CONTRADICTION | non-blocking: process stays OK, claim is non-PASS |
| `BUDGET_WALL_CLOCK_EXCEEDED` | run exceeds `max_total_timeout_s` | remaining steps NOT_RUN, PARTIAL |

## 5. Real host execution (trusted Debian 13, mandatory evidence)

All commands run on the trusted host `cc@192.168.100.200` with the pinned portable bundle. Committed evidence: `docs/mvp/receipts/run-*.receipt.json` + `.manifest.json` + per-step stdout logs (byte-identical bounded copies whose sha256 matches the receipt fields; verified 16/16 hash checks at commit time).

```
# environment (host: "cc", bundled Node v22.16.0)
B=/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64
B/bin/tool-runner sha256 = 020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a
# sync worktree @33bd3d0c588f40adad8dfb5a7a5449de3345bd0a, then:
FORMAL_PORTABLE_ROOT=$B FORMAL_PORTABLE_RUNNER_SHA256=020f8f5e... \
FORMAL_WORKFLOW_SOURCE_SHA=33bd3d0c588f40adad8dfb5a7a5449de3345bd0a \
FORMAL_WORKFLOW_HOST_OUT=<out> $B/bin/tool-runner node tests/workflow-executor.host.mjs   # exit 0
```

Tools (from `--version` probes bound in receipts): z3 `Z3 version 5.4.0 - 64 bit - build hashcode d6c9b4fbb31cb76e35cc325dd7e64b7c26c7d70f`; cvc5 `cvc5 1.4.2 [git 282d5e0 on branch HEAD]`; highs `highspy 1.15.1` (python 3.13.5, numpy 2.5.4).

| scenario | plan (plan_sha256 prefix) | real outcome | steps (elapsed) | verdicts |
|---|---|---|---|---|
| `run-scenario-a-unsat` | `e4bc4aed…` | z3 **unsat** (12 ms) + cvc5 **unsat** (4 ms) | all EXECUTED | AGREE_UNSAT, claim **PASS**, process OK |
| `run-scenario-a2-sat` | `b5c23f03…` | z3 **sat** (11 ms) + cvc5 **sat** (4 ms) | all EXECUTED | AGREE_SAT, claim **PASS**, process OK |
| `run-scenario-b-lp` | `ee6e795d…` | highs **kOptimal** obj=1.0 (214 ms) + **kInfeasible** (232 ms) | all EXECUTED | solver_answer by_step kOptimal/kInfeasible, cross NOT_APPLICABLE, claim NOT_APPLICABLE, process OK |
| `run-scenario-n1-malformed` | `83a5e610…` | malformed SMT: z3 exit 1 (11 ms), cvc5 exit 1 (12 ms) | both ERROR | FAILED, claim UNSUPPORTED_BY_MVP, `SOLVER_NONZERO_EXIT` |

N1 note (why fail-closed on exit codes matters): on malformed input z3 5.4.0 prints `(error "line 3 column 13: unknown constant definitely-not-a-term")` **and then a spurious `sat` token** to stdout before exiting 1 (see `run-scenario-n1-malformed.step-z3-bad.stdout.txt`). A parser that trusted the first token or exit 0 alone would have "proved" a sat answer for garbage. The executor requires exit 0 AND a full-line token, so N1 fails closed.

Bring-up incidents (both were the fail-closed paths working on real infra, not suppressed):
1. `PORTABLE_RUNNER_DIGEST_NOT_PINNED` — first run without `FORMAL_PORTABLE_RUNNER_SHA256`; highs steps ERROR'd honestly until the caller pinned the runner digest.
2. `HIGHS_OPERATION_SCRIPT_SHA256_MISMATCH` — the bundle's `tests/highs/solve-lp.py` had drifted (sha `869a341e…`, older, pre-hardening copy) vs the repo pin (`6b43add5…`). The canonical bytes were restored into the bundle before the final run; the bundle needs a rebuild to ship the hardened script.

## 6. Integration notes (V4 CLI/MCP, V5 UI, V6 e2e)

- Call `executeWorkflowPlan(plan, {workspaceDir?, sourceSha?})`; treat thrown `WorkflowPlanError.code` / `WorkflowBlockedError.code` as typed gate outcomes, and `error.receipt` on blocked runs as committed evidence. Never infer success from absence of an exception — read `receipt.overall`.
- Surface the three layers separately (process / solver / claim). A UI badge must key on `overall.claim_verdict`, not exit codes or `solver_answer`.
- `overall.solver_answer.value` is a *normalized consensus* (sat/unsat); it is `null` under disagreement or unknown — render contradiction/unknown states from `cross_tool_verdict`.
- Receipts are deterministic for fixed `now/runId/host/sourceSha`; `elapsed_ms` varies and must not be part of any equality gate.
- Keep the CI glob clean: `tests/workflow-executor.host.mjs` is the only binary-dependent file and deliberately does not match `tests/*.test.mjs`.
- Replay/verification of committed evidence: `sha256(receipt.json bytes) == manifest.receipt_sha256`, and each `logs/<step>.*.txt` hashes to the receipt's `stdout_sha256`/`stderr_sha256` (as long as output stayed under 4096 bytes, the committed copy is the complete stream).

## 7. Provenance note (i180/V3-fix2 kind + compare-input alignment)

The integration gate on main @ `944f063` caught a cross-lane defect: this executor validated `expected_output_kind` against deviant values (`solve-lp → "lp-result"`, `cross-check → "cross-check-verdict"`) and required the deviant compare input shape `agree_on:"answer"`. The frozen V0 contract (`docs/mvp/EXECUTION_PLAN_CONTRACT.md`, `registry/EXECUTION_PLAN.schema.json`) and every other lane (V2 `workflow-plan.mjs`, V5 UI shapes, V6 fixtures) pin `solve-lp → "lp-status"`, `cross-check → "cross-tool-verdict"`, and `agree_on` as a non-empty unique array over `sat|unsat|optimal-status`. So plans produced by V2's `buildExecutionPlan` were rejected by V3 (`PLAN_EXPECTED_KIND_INVALID`, compare step first). V3-fix2 aligns the executor with the frozen contract and adds an interop lock test (V2-built plan accepted, fails closed honestly without tools, executes to `AGREE_UNSAT`/`PASS` with stubbed solvers).

The committed receipts in `docs/mvp/receipts/` predate this fix: their `plan_sha256` values pin plans that were built with the pre-fix deviant shapes (which the then-current executor accepted). Those receipt bytes are historical evidence of what actually ran and stay byte-identical; they do not embed `expected_output_kind` or `agree_on` strings. Future host runs build plans with the contract shapes, so their `plan_sha256` values will differ from the committed pre-fix ones by design.
