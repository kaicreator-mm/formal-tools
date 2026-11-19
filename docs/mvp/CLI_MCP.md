# CLI and MCP quickstart (i180 / V4 Parts A + B, R2-B execution)

How to drive the formal-tools JavaScript surface: the unified Node CLI, the
MCP stdio server, the real stdio acceptance smoke that CI runs, and the
workflow plan → execute → results contract (Part B; MCP-side execution was
added in R2-B via `execute_workflow`). Status semantics
(probe receipts are technical evidence, never T3/T4/T5/T6 or business
acceptance) follow `docs/CLI_MCP_CONTRACT.md`.

## Run the CLI

The `formal` npm script wraps `packages/runner/js/cli.mjs`; pass arguments
after `--`:

```sh
npm run formal -- list                       # 13 native adapters + portfolio + pure engines
npm run formal -- validate                   # static registry/source validation (STATIC_PASS)
npm run formal -- catalog z3                 # typed CLI operation schemas
npm run formal -- info z3                    # tool profile
npm run formal -- plan z3 solve --input skills/z3/examples/positive.smt2   # validated argv, NO execution
npm run formal -- pure dag --input validation/js/dag-positive.json         # pure JS finite-model check
npm run formal -- capabilities summary       # frozen G1 discovery registry summary
npm run formal -- capabilities match --cap logic.smt                       # capability -> validated tools
```

`plan` returns planned argv with `runtime: NOT_RUN`; it never executes.
`exec`/`invoke`/`native` launch native binaries and require an installed,
pinned local toolchain — out of scope for the JS-only CI lane.

## Workflow plan → approve → execute → results (Part B)

One reusable contract over the frozen `formal-tools/execution-plan/1.0`
schema, exposed identically through the SDK, the CLI and MCP planning:

1. **plan** — turn a bounded user problem into an execution plan (deterministic
   template, or one real DeepSeek method proposal with `--provider deepseek`).
   Planning never executes anything; `tool_execution` stays `NOT_RUN`.
2. **approve (human)** — read the plan JSON (steps, tools, inputs, hashes,
   budgets). The plan_id is content-derived; the compiled launcher/manifest
   hash-chain the plan. Nothing runs until step 3.
3. **execute** — run the plan on a trusted host. Every step is hash-bound,
   allowlisted and budgeted; receipts
   (`formal-tools/execution-receipt/1.0`) separate process status, solver
   answers, cross-tool verdicts and the claim verdict (see
   `docs/mvp/EXECUTOR_RECEIPTS.md`).
4. **results** — print the normalized verdict summary of a receipt.

### SDK

```js
import { planWorkflow, compileWorkflowPlan, executeWorkflowPlan } from "<repo>/packages/runner/js/sdk.mjs";

const { problem, plan } = await planWorkflow({ problemText, assumptions: ["..."] });
// optional: provider: "deepseek" — ONE real DeepSeek proposal call; the API
// key is read ONLY from env DEEPSEEK_API_KEY; absent key fails closed with
// BLOCKED_PROVIDER (never mocked, never read from anywhere else).
const { launcher, manifest, plan: compiledPlan } = compileWorkflowPlan(plan);
const { receipt, workspaceDir } = await executeWorkflowPlan(compiledPlan, { sourceSha: "<40-hex git SHA>" });
// executeWorkflowPlan throws WorkflowBlockedError (with a full ABORTED
// receipt attached) when preflight cannot guarantee every named tool.
```

`planWorkflow` is deterministic by default: the canonical problem text is
used **verbatim as the SMT-LIB input** of a z3 + cvc5 cross-check pair plus a
`compare` step. Real SMT-LIB input really solves; prose input honestly fails
at execution time (no fabricated verdict). Callers with a real encoding pass
`smtLib` explicitly. Typed declarations live in `sdk.d.mts` (`WorkflowError`,
`WorkflowPlanError`, `WorkflowBlockedError` carry stable machine codes).

### CLI

```sh
npm run formal -- workflow plan --problem-file problem.smt2 \
    [--assumption "text"]... [--capability logic.smt]... [--provider deepseek] [--compile]
npm run formal -- workflow execute --plan-file artifacts/<plan_id>/plan.json [--source-sha <40hex>]
npm run formal -- workflow results --receipt artifacts/<plan_id>/receipt.json
```

- `workflow plan` prints `{plan, artifacts}` JSON to stdout. With `--compile`
  it also writes `plan.json`, `launcher.mjs`, `manifest.json` under
  `artifacts/<plan_id>/` (relative to the current directory) and prints the
  paths. Exit 0 on a well-formed plan; Workflow error codes
  (`PLAN_*`, `BLOCKED_PROVIDER`, ...) exit 2 with a JSON error on stderr.
- `workflow execute` runs the plan and writes
  `artifacts/<plan_id>/receipt.json`; prints a receipt summary with the
  overall verdict fields labeled (`process_outcome`,
  `solver_answer`, `cross_tool_verdict`, `claim_verdict`,
  `fail_closed_reason`). Exit 0 only on `claim_verdict: "PASS"`.
- `workflow results` prints the normalized verdict summary of any receipt
  file (a reporting action: exit 0 for any well-formed receipt, 2 for
  malformed input; the verdict classes are in the JSON).

Honest fail-closed semantics: in an environment without the pinned portable
bundle, execution preflight produces an `ABORTED` receipt with
`claim_verdict: "BLOCKED"` and `fail_closed_reason: "BLOCKED_TOOL_MISSING"`
and the command exits non-zero. That is the honest outcome in a binary-less
environment — never a fabricated PASS.

## Start the MCP server (stdio)

Requires dependencies (`npm ci` once). stdout is reserved for the MCP
newline-delimited JSON-RPC transport; diagnostics go to stderr.

```sh
npm run formal:mcp        # node packages/runner/js/mcp.mjs
```

Any MCP host can attach over stdio (`@modelcontextprotocol/server` v2,
protocol `2025-06-18`).

## Registered MCP tools (exactly 16)

1. `list_formal_tools` — 13 native adapters + candidate portfolio + 4 pure engines.
2. `validate_formal_source` — static validation, no proof execution.
3. `inspect_formal_tool` — tool contract + fixture expectations (read-only).
4. `probe_formal_tool` — `--version`/`--help` probe attempt, fails closed.
5. `run_formal_fixture` — committed positive/negative fixture only.
6. `describe_native_cli` — named CLI operations, no execution.
7. `inspect_native_installation` — read-only installation discovery.
8. `plan_native_cli` — validated argv plan, `runtime: NOT_RUN`.
9. `list_portfolio_tools` — discovery metadata for all 36 tools.
10. `match_formal_capabilities` — deterministic capability-ID → validated-tool
    match over the sha256-bound r176/r181 container probe receipts
    (input: `capabilities: string[1..16]`, optional `include_not_verified`).
11. `inspect_portfolio_tool` — read-only portable installation metadata.
12. `verify_portable_fixture` — pinned portable pos/neg/err fixture via the
    SHA-pinned runner.
13. `run_portfolio_operation` — a bounded typed execution lane: Highs
    1.15.1 `solve-lp` with a bounded typed LP model (no raw argv/shell).
14. `verify_formal_model` — pure JS finite-model checks (`dag|writers|cnf|states`).
15. `plan_workflow` — **planning only**: a bounded `problem_text` (1..64 KiB,
    ≤32 assumptions, optional `provider: "deepseek"`) becomes an
    `execution-plan/1.0` plan. It NEVER executes anything.
16. `execute_workflow` — **bounded typed execution** over the real V3 DAG
    executor (see below).

Every tool rejects execution-shaped arguments (raw argv/shell/cwd) at the
zod schema or handler boundary and fails closed.

### `execute_workflow` (trusted-host execution over MCP, R2-B)

The one workflow-execute surface over MCP. Input is strictly typed and
bounded; the executor keeps every security-relevant choke point:

- `plan` — the `formal-tools/execution-plan/1.0` object (exactly the frozen
  8-key schema, ≤64 KiB JSON). Structure, tool allowlist, canonical input
  hashes, DAG closure and budgets are re-validated by `executeWorkflowPlan`
  itself — never duplicated or bypassed at the MCP layer.
- `source_sha` — **required**, 40-hex git commit SHA of the caller's source
  tree. No anonymous or unlabeled runs; the receipt binds it.
- `budget_caps` — optional, tighten-only (`max_steps`, `max_total_timeout_s`).
  A cap looser than the plan's own budget is rejected `PLAN_BUDGET_EXCEEDED`;
  caps never extend budgets.

Environment contract: the MCP server process inherits the trusted host
environment; execution requires `FORMAL_PORTABLE_ROOT` to point at the pinned
portable bundle (the same env the CLI path uses). There is no raw shell, no
argv passthrough, no file-path inputs and no tool escalation — the only
process launches are the executor's hash-bound, allowlisted solver calls.

Results: the response carries the receipt's `overall` verdicts
(`process_outcome` / `solver_answer` / `cross_tool_verdict` / `claim_verdict`
— never collapsed), per-step statuses with full-byte stream hashes (bounded
log copies further truncated to 512 bytes, truncation flagged), and artifact
pointers (`receipt_sha256` + `manifest.json` entry hashes; capped at 256).
Without the pinned bundle the preflight fails closed and the tool returns the
honest `ABORTED` receipt — `claim_verdict: "BLOCKED"`,
`fail_closed_reason: "BLOCKED_TOOL_MISSING"` — as a **non-error** result
(never a fabricated PASS). Invalid plans (schema/hash/budget violations) are
tool errors before anything runs (`PLAN_HASH_MISMATCH`, `PLAN_OVERSIZED`, ...).

Planning tools are unchanged: `plan_workflow` still never executes; to run a
plan over MCP, pass its `execution-plan/1.0` object (the 8 schema keys) to
`execute_workflow` with the caller's git HEAD as `source_sha`. Live three-entry
parity receipts (same plan over MCP and CLI on the trusted host: identical
`plan_sha256`, identical verdicts, distinct `run_id`s) live under
`validation/local-runtime-receipts/mcp-execute-*`.

## Run the real stdio acceptance smoke

```sh
node scripts/mcp-acceptance.mjs
```

This spawns `packages/runner/js/mcp.mjs` as a real child process and speaks
newline-delimited JSON-RPC over stdio — the same transport an external MCP
host uses: `initialize` → `tools/list` → `tools/call` across all 16 tools,
including fail-closed assertions (unknown capability ID, schema-invalid
`capabilities: []`, raw `argv` extension, unknown tool id, empty
`problem_text`, unknown workflow provider), `plan_workflow`
determinism, and the `execute_workflow` honest fail-closed receipt plus
`PLAN_HASH_MISMATCH` / missing-`source_sha` / tighten-only-`budget_caps` /
argv rejections. It writes a receipt to
`validation/local-runtime-receipts/mcp-acceptance.json` and exits 0 only
when every assertion holds; CI runs it as the `mcp-stdio-smoke` step in
`.woodpecker/formal-static.yaml`. No native binaries are needed.

Static offline parity guards additionally pin the tool set:
`tests/workflow-interfaces-smoke.test.mjs` asserts `mcp.mjs` `registerTool`
names == `EXPECTED_TOOLS` == `registry/INTERFACES.json` `mcp_tools` == exactly
16; `tests/tool-contract-parity.test.mjs` asserts the SDK/CLI/MCP catalog
faces. The end-to-end workflow contract itself (SDK plan/compile/execute,
CLI subprocess flows, real stdio `plan_workflow` + `execute_workflow`, real
DeepSeek when `DEEPSEEK_API_KEY` is set — skipped where absent) is covered by
`tests/workflow-interfaces-workflow.test.mjs`.
