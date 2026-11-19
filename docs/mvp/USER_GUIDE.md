# formal-tools — real-user E2E guide (MVP runbook draft)

Status: **PREPARATION DRAFT** (issue #186, r0 @ 33bd3d0, branch i180/v6).
The live E2E execution happens after the V1–V5 workflow lanes merge; sections that
will receive real screenshots/outputs are marked `PENDING-LIVE-RUN`.

What you can do today: run the three harness entries and see honest, fail-closed
reports (`SKIP_NOT_WIRED` / `NOT_REGISTERED_YET` / `SKIP_WEB_NOT_RUNNING`) —
real subprocesses against the current CLI and MCP surfaces, with no fabricated
passes. What you will do after V1–V5: plan → execute → inspect → evidence for
three real journeys (CLI, MCP, Web).

---

## 0. Prerequisites

| requirement | detail |
| --- | --- |
| Node.js | >= 20 (repo `engines` field); ESM only |
| repo checkout | this repository; `npm install` once (workspaces; the MCP path needs `@modelcontextprotocol/server` + `zod`) |
| trusted host (real runs) | `ssh -o BatchMode=yes cc@192.168.100.200`, portable bundle at `/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64` (z3 5.4.0, cvc5 1.4.2, HiGHS via `$B/bin/tool-runner run highs $B/tests/highs/solve-lp.py model.json`) |
| env: `DEEPSEEK_API_KEY` | your real DeepSeek API key, read from the environment only; the harness never hardcodes or logs it |
| env (optional): `HTTPS_PROXY` | fallback proxy for the DeepSeek probe when direct egress fails |
| env (optional): `WEB_E2E_BASE_URL` | base URL of a running apps/web server (default `http://127.0.0.1:8787`) |

Host note: real portfolio/tool execution requires Debian/Linux x86_64 (the portable
runner fails closed with `PORTABLE_HOST_UNSUPPORTED` elsewhere, by design).

All harness commands below run from the repo root:

```bash
node validation/mvp-user-e2e/harness/<entry>.mjs
```

Exit-code convention (all entries): `0` report produced (a SKIP class is honest
progress, not a failure) · `2` executed-but-mismatched · `3` `BLOCKED_PROVIDER`
(probe only) · `4` provider HTTP/network failure (probe only) · `5` harness error.

---

## 1. Journey A — CLI

Intended workflow (subcommands land with V4-b):

```bash
# 1. plan: natural language -> ExecutionPlan (formal-tools/execution-plan/1.0)
node packages/runner/js/cli.mjs plan --user-prompt validation/mvp-user-e2e/fixtures/user-prompt-a.txt

# 2. execute: plan -> ExecutionReceipt (formal-tools/execution-receipt/1.0)
node packages/runner/js/cli.mjs execute --plan <plan.json>

# 3. status / 4. results
node packages/runner/js/cli.mjs status --run-id <run_id>
node packages/runner/js/cli.mjs results --run-id <run_id>
```

Run the harness entry for this journey:

```bash
node validation/mvp-user-e2e/harness/run-cli.mjs          # probe mode (default)
node validation/mvp-user-e2e/harness/run-cli.mjs --help   # documents the intended workflow
```

What it does: spawns the real CLI as a subprocess, proves the CLI itself is
invocable (`list` → 13 native tools), then probes the intended workflow
invocations and reports honestly. Today's expected report:
`entry_outcome_class: "SKIP_NOT_WIRED"` with the raw CLI responses recorded.

What you will see after V4-b (PENDING-LIVE-RUN): a plan for `user-prompt-a.txt`
whose steps stay inside the allowlist (`z3|cvc5|highs|compare` ×
`solve-smt|solve-lp|cross-check`), an execution receipt on the trusted host, and
`AGREE_UNSAT` for scenario A.

### What fail-closed looks like

- Unknown tool in a plan (`fixtures/negatives/unknown-tool.plan.json`) →
  rejected with class `PLAN_UNKNOWN_TOOL` before any launch.
- Wrong input hash (`tampered-hash.plan.json`) → `PLAN_HASH_MISMATCH`.
- Timeouts above policy (`timeout-crush.plan.json`, steps sum 360s > 300s cap)
  → `TIMEOUT_BUDGET`.
- Broken SMT-LIB input (`negatives/malformed.smt2`, unbalanced paren) → the
  parser fails closed `PARSE_ERROR`; you never get a guessed `sat`/`unsat`.

---

## 2. Journey B — MCP (JSON-RPC over stdio)

```bash
node validation/mvp-user-e2e/harness/run-mcp.mjs
```

What it does: spawns `packages/runner/js/mcp.mjs` as a real child and speaks
newline-delimited JSON-RPC (initialize → tools/list → tools/call) — the same
transport an external MCP host uses. It sanity-calls a tool registered today
(`list_formal_tools`: 13 native + 36 portfolio), then looks for the workflow
tools by name from a small config table at the top of the file.

Today's expected report: handshake OK, 14 tools listed,
`entry_outcome_class: "NOT_REGISTERED_YET"` for the workflow tools
(`plan_workflow` / `execute_workflow` / `workflow_status` / `workflow_results`
are the current name guesses; when V4-b ships with different names, only the
`WORKFLOW_MCP_TOOLS` table changes).

After V4-b (PENDING-LIVE-RUN): `tools/call plan_workflow` with the user prompt,
then `execute_workflow`, then the results tools — each answer JSON-parsed and
shape-checked against the pinned contracts.

Direct manual session (what the harness automates):

```bash
node packages/runner/js/mcp.mjs
# then on stdin, one JSON per line:
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual","version":"0.0.1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

---

## 3. Journey C — Web (HTTP)

```bash
# start the web app once it exists (PENDING-LIVE-RUN), then:
node validation/mvp-user-e2e/harness/run-web.mjs
```

Endpoints exercised: `GET /api/meta`, `POST /api/plan` (user prompt →
ExecutionPlan), `GET /api/runs`, `GET /api/runs/:id` (→ ExecutionReceipt),
`GET /api/runs/:id/evidence` (evidence download). Responses are shape-checked
against the pinned contracts exactly like the CLI/MCP entries.

Today's expected report: `entry_outcome_class: "SKIP_WEB_NOT_RUNNING"`
(`apps/web` does not exist at r0 — the refusal is detected and reported, never
worked around).

Evidence download (after V4-b): `/api/runs/:id/evidence` returns the run's
evidence bundle (plan, receipt, bounded stdout/stderr hashes, tool versions).
Keep the whole bundle; `plan_sha256` inside the receipt is what makes a claim
auditable — an evidence file whose hashes do not re-verify is worth nothing.

---

## 4. Comparing the three entries

```bash
node validation/mvp-user-e2e/harness/run-cli.mjs > /tmp/cli.json
node validation/mvp-user-e2e/harness/run-mcp.mjs  > /tmp/mcp.json
node validation/mvp-user-e2e/harness/run-web.mjs  > /tmp/web.json
node validation/mvp-user-e2e/harness/compare.mjs --cli /tmp/cli.json --mcp /tmp/mcp.json --web /tmp/web.json
```

Tolerance table: `run_id`, `created_at`, `elapsed_ms` may differ per entry;
`plan_sha256`, `outcome_class`, `cross_tool_verdict` must match exactly.
Entries that did not execute compare as `SKIP` — the tool never fabricates a
match. `PENDING-LIVE-RUN` for real three-way output.

---

## 5. The real-provider planning probe

```bash
DEEPSEEK_API_KEY must be set in your environment (never passed on the command line).
node validation/mvp-user-e2e/harness/run-deepseek-plan.mjs
```

Reads `fixtures/user-prompt-a.txt`, asks `deepseek-chat` (temperature 0) for a
Method DAG proposal, checks it against the allowlist, and saves the REAL
response to `validation/mvp-user-e2e/evidence/deepseek-probe/transcript.json`
(labeled `PROBE_NOT_FINAL_E2E`; the Authorization header is redacted by
construction). Exit `3` = `BLOCKED_PROVIDER` (no key), exit `4` = provider
HTTP/network failure. One committed probe transcript from 2026-11-19 already
exists: HTTP 200, 3-node DAG (z3 → cvc5 → compare cross-check), fully inside
the allowlist.

---

## 6. Fixtures and expected relations

Everything under `validation/mvp-user-e2e/fixtures/` — see
`fixtures/README.md` for the binding hash conventions. Summary:

- `scenario-a.smt2` → both solvers `unsat` → class `AGREE_UNSAT`;
  `scenario-a-sat.smt2` (witness x=y=1) → `AGREE_SAT`.
- `scenario-b-lp.json` → HiGHS `kOptimal`, objective exactly **11**
  (hand-derived; offline duality proof in the test suite);
  `scenario-b-infeasible.json` → `kInfeasible`.
- `negatives/` → `PLAN_UNKNOWN_TOOL`, `PLAN_HASH_MISMATCH`, `TIMEOUT_BUDGET`,
  `PARSE_ERROR` — every one fails closed before any solver launch.

Offline invariant suite (no binaries, no network):

```bash
node --test tests/workflow-user-e2e.test.mjs
```

---

## 7. Honest-status glossary

| class | meaning |
| --- | --- |
| `SKIP_NOT_WIRED` | the V4-b CLI workflow subcommands are not present yet |
| `NOT_REGISTERED_YET` | the MCP workflow tools are not registered yet |
| `SKIP_WEB_NOT_RUNNING` | no web server reachable at the base URL |
| `BLOCKED_PROVIDER` | planning probe ran without `DEEPSEEK_API_KEY` |
| `PLAN_UNKNOWN_TOOL` / `PLAN_HASH_MISMATCH` / `TIMEOUT_BUDGET` / `PARSE_ERROR` | deliberate fail-closed negatives |
| `AGREE_UNSAT` / `AGREE_SAT` / `K_OPTIMAL_OBJECTIVE_<n>` / `K_INFEASIBLE` | cross-tool/solver outcome classes |

A `SKIP`/`NOT_*` status is recorded progress, not a pass and not a failure.
Nothing in this harness fabricates solver internals; the only numeric claim
(LP objective 11) carries its offline duality proof.
