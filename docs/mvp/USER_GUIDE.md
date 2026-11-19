# formal-tools — real-user E2E guide (MVP runbook, LIVE)

Status: **LIVE** (issue #186, V6 @ 646859f628c4595e66c490c00c887e54e02bc215).
The three journeys (CLI / MCP / Web) ran for real on the trusted Debian host
with the real DeepSeek planner and real z3 5.4.0 / cvc5 1.4.2 / HiGHS 1.15.1
binaries. Every receipt, transcript and screenshot below is committed under
`validation/mvp-user-e2e/evidence/` and pinned by `evidence/SHA256SUMS`
(re-verified by `node --test tests/workflow-user-e2e.test.mjs` on every run —
nothing can drift silently).

What you can reproduce: the exact commands below, on the trusted host, at the
pinned HEAD.

---

## 0. Prerequisites

| requirement | detail |
| --- | --- |
| Node.js | >= 20 locally (ESM only); the trusted host uses the bundled node 22.16.0 via `$B/bin/tool-runner node` |
| repo checkout | this repository at the pinned HEAD; `npm install` once (workspaces; the MCP path needs `@modelcontextprotocol/server` + `zod`) |
| trusted host | `ssh -o BatchMode=yes cc@192.168.100.200`; portable bundle `B=/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64` (z3 5.4.0, cvc5 1.4.2, HiGHS via `$B/bin/tool-runner run highs $B/tests/highs/solve-lp.py model.json`, solve-lp.py pinned `6b43add5…`) |
| env: `DEEPSEEK_API_KEY` | your real DeepSeek API key, read from the environment only; never hardcoded, never logged, never committed. On the host: write it to a `0600` file and source it per-run (`set -a; . ./.dsenv; set +a`), delete the file afterwards |
| host env pins | `FORMAL_PORTABLE_ROOT=$B` for any execution; `FORMAL_PORTABLE_RUNNER_SHA256=020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a` additionally required by the HiGHS portfolio gateway (without it the highs step fails closed `HIGHS_ADAPTER_FAIL_CLOSED` — that honest first-attempt receipt is committed too) |

Host run pattern (all journeys below):

```bash
cd /home/cc/formal-tools-build/wt-i180-v6b   # the synced worktree
B=/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64
set -a && . ./.dsenv && set +a               # DEEPSEEK_API_KEY, 0600 file
FORMAL_PORTABLE_ROOT=$B FORMAL_PORTABLE_RUNNER_SHA256=020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a \
  $B/bin/tool-runner node validation/mvp-user-e2e/harness/run-live-cli-journey.mjs \
  --source-sha 646859f628c4595e66c490c00c887e54e02bc215
```

Syncing the worktree to the host: `tar czf - --exclude=node_modules --exclude=.git --exclude=artifacts . | ssh cc@192.168.100.200 'rm -rf <tree> && mkdir -p <tree> && tar xzf - -C <tree>'`, then the same for `node_modules` (excluding `node_modules/.bin`; deps are pure JS).

---

## 1. Journey A — CLI (real LLM plan -> compile -> execute -> results)

The one-liner driver runs six real journeys and records everything under
`validation/mvp-user-e2e/evidence/live-cli/`:

| journey | what actually happened @ 646859f |
| --- | --- |
| J1 `j1-unsat-deepseek` | `workflow plan --problem-file scenario-a.smt2 --provider deepseek --compile` — first proves the provider path fails closed **without** a key (`BLOCKED_PROVIDER`), then ONE real `deepseek-chat` proposal (step ids `z3-solve` / `cvc5-solve` — the LLM's own naming, the template says `step-z3`) → compiled → executed: z3 **unsat** + cvc5 **unsat** → `AGREE_UNSAT`, claim **PASS**, exit 0 |
| J2 `j2-sat-template` | `scenario-a-sat.smt2` via the deterministic template → both solvers **sat** → `AGREE_SAT`, claim **PASS** |
| J3 `j3-prose-failclosed` | natural-language `user-prompt-a.txt` via DeepSeek: the LLM plans fine, but prose is not SMT-LIB — execution fails closed (`SOLVER_NONZERO_EXIT`, `UNSUPPORTED_BY_MVP`), never a guessed answer |
| J4 `j4-lp-koptimal` | feasible LP through the workflow-plan APIs (the CLI template is SMT-only by design) → HiGHS `kOptimal`, **objective 11** at vertex **(3,1)** — exactly the hand-proven optimum |
| J5 `j5-lp-kinfeasible` | infeasible LP → `kInfeasible` |
| J6 `j6-template-parity` | the deterministic scenario-A plan (uncompiled) used for the cross-entry comparison |

Trimmed real output (J1 execute):

```json
{"plan_id":"wf-1023fdabe42c64cbc0d5677766aa925f","run_id":"run-mwnix0kz-84624875",
 "overall":{"process_outcome":"OK",
   "solver_answer":{"kind":"solve-smt","value":"unsat","by_step":[
     {"step_id":"z3-solve","tool":"z3","answer":"unsat"},
     {"step_id":"cvc5-solve","tool":"cvc5","answer":"unsat"}]},
   "cross_tool_verdict":"AGREE_UNSAT","claim_verdict":"PASS"}}
```

Manual step-by-step (what the driver automates):

```bash
node packages/runner/js/cli.mjs workflow plan --problem-file validation/mvp-user-e2e/fixtures/scenario-a.smt2 \
  --provider deepseek --compile          # -> artifacts/<plan_id>/{plan.json,launcher.mjs,manifest.json}
node packages/runner/js/cli.mjs workflow execute --plan-file artifacts/<plan_id>/plan.json \
  --source-sha 646859f628c4595e66c490c00c887e54e02bc215   # -> artifacts/<plan_id>/receipt.json (exit 0 only on claim PASS)
node packages/runner/js/cli.mjs workflow results --receipt artifacts/<plan_id>/receipt.json
```

### What fail-closed looks like (negatives, all committed under `evidence/live-negatives/`)

| input | harness policy layer | real executor |
| --- | --- | --- |
| `negatives/unknown-tool.plan.json` (tool `magic-solver-9000`) | `PLAN_UNKNOWN_TOOL` | `PLAN_TOOL_NOT_ALLOWED`, exit 2, no receipt |
| `negatives/tampered-hash.plan.json` (input_sha256 binds the SAT sibling) | `PLAN_HASH_MISMATCH` | `PLAN_HASH_MISMATCH`, exit 2, no receipt |
| `negatives/timeout-crush.plan.json` (step 180s, budget 400s > caps) | `TIMEOUT_BUDGET` | `PLAN_TIMEOUT_INVALID`, exit 2, no receipt |
| `negatives/malformed.smt2` (unbalanced paren, planned+executed for real) | — | solvers fail: `FAILED` / `UNSUPPORTED_BY_MVP` / `SOLVER_NONZERO_EXIT` |

---

## 2. Journey B — MCP (JSON-RPC over stdio, planning-only)

```bash
node validation/mvp-user-e2e/harness/run-live-mcp-journey.mjs --out validation/mvp-user-e2e/evidence/live-mcp
```

12/12 real checks @ 646859f (committed transcript + plan + report):

- `initialize` handshake (`formal-tools-skill`), `tools/list` = **exactly the 15 registered tools** incl. `plan_workflow`;
- `plan_workflow` with the scenario-A problem (deterministic provider) returns a valid `formal-tools/execution-plan/1.0`, replay-deterministic (same `plan_id`);
- the CLI planner and the MCP planner return the **identical plan object** (`wf-e759e1d5b18abf629caa2398a609b56a`) for the same input;
- `provider:'deepseek'` returns a real LLM plan whose `plan_id` **reproduces the CLI DeepSeek journey's plan exactly** (temperature-0 determinism across entries);
- `provider:'deepseek'` **without a key fails closed** (`BLOCKED_PROVIDER` — never mocked);
- MCP never executes: plans carry `compiled: {null, null}` and `tool_execution: "NOT_RUN"`; execution happens via the SDK/CLI on a trusted host.

Manual session (what the harness automates):

```bash
node packages/runner/js/mcp.mjs
# then on stdin, one JSON per line:
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual","version":"0.0.1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"plan_workflow","arguments":{"problem_text":"(set-logic QF_LIA)\n(declare-const x Int)\n(assert (> x 0))\n(assert (< x 0))\n(check-sat)\n(exit)","assumptions":["bounded linear integer arithmetic"]}}}
```

---

## 3. Journey C — Web (HTTP + browser)

Start the bounded bridge on the trusted host:

```bash
PORT=8788 FORMAL_PORTABLE_ROOT=$B FORMAL_PORTABLE_RUNNER_SHA256=020f8f5e… nohup \
  $B/bin/tool-runner node apps/web/server.mjs > /tmp/formal-web-8788.log 2>&1 &
```

Browser from your workstation — port-forward recipe:

```bash
ssh -N -L 8788:127.0.0.1:8788 cc@192.168.100.200     # keep running; Ctrl-C to stop
# then open http://127.0.0.1:8788 in the browser
```

Committed browser journey (screenshots under `evidence/live-web/screenshots/`):

| file | shows |
| --- | --- |
| `01-input-scenario-a-deepseek.png` | scenario A pasted, "DeepSeek — real LLM proposal" selected, `engine: workflow-v2+v3 (real)` badge |
| `02-plan-deepseek-llm.png` | plan `wf-5a30b326…` review screen — steps table (z3-solve / cvc5-solve / step-agree), plan-source badge "DeepSeek (deepseek-chat) — LLM proposal, admitted as data via static validation", approve gate |
| `03-run-steps-real-solvers.png` | run screen mid-run (`status: running`, steps QUEUED — real z3/cvc5 executing on the host) |
| `04-results-agree-unsat.png` | results: process **OK**, solver answer **unsat**, cross-tool **AGREE_UNSAT**, claim **PASS**, environment line with the portable-root sha, evidence download links |
| `05-evidence-download-attempt.png` | the "⬇ Download receipt (JSON)" click (server answers `Content-Disposition: attachment; filename="receipt-<run_id>.json"`) |
| `06-lp-result-koptimal.png` | LP sample: `kOptimal` (objective 11 in the receipt; screen shows normalized `sat` + honest `NOT_APPLICABLE` cross-check for a single-solver plan) |

HTTP-level journey (what `run-web.mjs --live` automates; saved verbatim under
`evidence/live-web/journey-*`):

```bash
node validation/mvp-user-e2e/harness/run-web.mjs --live \
  --problem validation/mvp-user-e2e/fixtures/scenario-a.smt2 \
  --out validation/mvp-user-e2e/evidence/live-web/journey-smt-template
node validation/mvp-user-e2e/harness/run-web.mjs --live \
  --problem validation/mvp-user-e2e/fixtures/scenario-b-lp.json \
  --out validation/mvp-user-e2e/evidence/live-web/journey-lp
```

Real result: both journeys `ok: true`; the downloaded
`/api/runs/:id/evidence` bytes are **byte-identical** to the served run receipt
(`evidence-verification.json` files pin this). There is no `GET /api/runs`
list by design — run state is per-id, and unknown ids fail closed with
`404 RUN_NOT_FOUND`.

---

## 4. Comparing the three entries (committed result: MATCH)

```bash
node validation/mvp-user-e2e/harness/build-entry-reports.mjs
# reads the committed live evidence, writes evidence/live-compare/{cli,mcp,web}-report.json + comparison.json
```

Real outcome @ 646859f (`evidence/live-compare/comparison.json`): **overall MATCH** —

- `cli-vs-mcp` **MATCH (exact)**: identical plan object — same `plan_id`
  `wf-e759e1d5b18abf629caa2398a609b56a`, and the executed CLI receipt's
  `plan_sha256` equals the MCP plan's canonical hash; outcome fields SKIP
  honestly (MCP is planning-only by contract).
- `cli-vs-web` / `mcp-vs-web` **MATCH**: the bridge normalizes with
  `problem_kind: "smt2"` (CLI records `user_problem`), so plan envelopes
  differ; the comparison uses the step-set signature (identical z3/cvc5/compare
  steps with identical canonical input hashes) plus exact outcome parity
  (`AGREE_UNSAT` everywhere). The differing `plan_sha256` is reported as
  `MATCH_SEMANTIC`, never disguised as an exact hash match.
- DeepSeek determinism: the real LLM proposal reproduced the same plan
  (`wf-1023fdabe42c64cbc0d5677766aa925f`) through CLI and MCP at temperature 0.

Tolerance table: `run_id`, `created_at`, `elapsed_ms` may differ per entry;
outcome classes and cross-tool verdicts must match exactly; `plan_sha256` must
match exactly when the same plan object is used, or via the step-set signature
when only the envelope differs. A `SKIP`/`MATCH_SEMANTIC` is labeled as such —
the tool never fabricates an exact pass.

---

## 5. The real-provider planning probe (connectivity/shape)

```bash
DEEPSEEK_API_KEY must be set in your environment (never passed on the command line).
node validation/mvp-user-e2e/harness/run-deepseek-plan.mjs
```

Asks `deepseek-chat` (temperature 0) for a Method DAG proposal, checks it
against the allowlist, and saves the REAL response to
`evidence/deepseek-probe/transcript.json` (labeled `PROBE_NOT_FINAL_E2E`;
Authorization header redacted by construction). Exit `3` = `BLOCKED_PROVIDER`,
exit `4` = provider HTTP/network failure. The committed transcript predates the
live run; the LIVE DeepSeek planning evidence is now `evidence/live-cli/j1-*`
and `evidence/live-mcp/` (the same proposal, executed end-to-end).

---

## 6. Fixtures and expected relations

Everything under `validation/mvp-user-e2e/fixtures/` — see
`fixtures/README.md` for the binding hash conventions (V3: typed inline inputs,
canonical-JSON input hashes). Summary with the LIVE observed class:

- `scenario-a.smt2` → both solvers `unsat` → `AGREE_UNSAT` ✅ (CLI J1 DeepSeek, CLI J6 template, MCP plan, Web bridge, browser run)
- `scenario-a-sat.smt2` (witness x=y=1) → `AGREE_SAT` ✅ (CLI J2)
- `scenario-b-lp.json` → HiGHS `kOptimal`, objective exactly **11** (hand-derived; offline duality proof in the test suite) ✅ (CLI J4, Web journey, browser run)
- `scenario-b-infeasible.json` → `kInfeasible` ✅ (CLI J5)
- `negatives/` → `PLAN_UNKNOWN_TOOL` / `PLAN_HASH_MISMATCH` / `TIMEOUT_BUDGET` / `PARSE_ERROR` ✅ all failed closed before/during execution with no invented answers

Offline invariant suite + committed-evidence integrity (no binaries, no network — CI-safe):

```bash
node --test tests/workflow-user-e2e.test.mjs
```

---

## 7. Honest-status glossary

| class | meaning |
| --- | --- |
| `AGREE_UNSAT` / `AGREE_SAT` | z3 and cvc5 both answered unsat / sat (observed live) |
| `K_OPTIMAL_OBJECTIVE_11` / `K_INFEASIBLE` | HiGHS model status with the exact objective (observed live) |
| `BLOCKED_PROVIDER` | DeepSeek requested without `DEEPSEEK_API_KEY` — fails closed (observed live) |
| `SOLVER_NONZERO_EXIT` / `UNSUPPORTED_BY_MVP` | honest failure classes (prose input, malformed input) — no answer invented |
| `PLAN_UNKNOWN_TOOL` / `PLAN_HASH_MISMATCH` / `TIMEOUT_BUDGET` | deliberate negatives, rejected before any launch |
| `MATCH_SEMANTIC` | same step set + verdict across entries, different plan envelope — labeled, never an exact-hash pass |
| `SKIP_*` / `NOT_REGISTERED_YET` | honest not-run states (e.g. MCP outcome fields; no web server) |

Nothing in this harness fabricates solver internals; the only numeric claim
(LP objective 11) carries its offline duality proof, and the live receipts
reproduced it exactly. The committed evidence is hash-pinned by
`evidence/SHA256SUMS` and re-verified offline by the test suite.

---

## 8. R2 addendum (i180 closeout, branch `i180/r2-e2e` @ 7b85e82e434152e139d0d93bfb76ef72ad076f21)

R2 adds three real surfaces on top of the V6 runbook: the NL→model approval
lane (R2-C), the typed `execute_workflow` MCP tool (R2-B), and honest
full-stream vs bounded evidence labels (R2-D). The R2 E2E acceptance validator
(non-writer) re-ran everything end-to-end on the trusted host; evidence is
committed under `validation/mvp-user-e2e/evidence/r2/` (pinned by
`evidence/r2/SHA256SUMS`, re-verified offline by
`node --test tests/workflow-user-e2e-r2.test.mjs`).

### 8.1 NL journey (propose → review → approve → execute)

The real path is programmatic (`packages/runner/js/nl-model.mjs`,
docs/mvp/NL_MODEL.md). Reference driver:
`tests/nl-model.driver.mjs`; acceptance evidence driver:
`evidence/r2/drivers/j1-nl-journey.mjs` (two phases, so the approval gate
requires a separately authored review file):

```bash
cd /home/cc/formal-tools-build/wt-i180-r2e    # synced worktree (node_modules minus .bin)
B=/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64
set -a && . ./.dsenv && set +a                # DEEPSEEK_API_KEY, 0600 file, delete afterwards

# phase 1: ONE real DeepSeek proposal (untrusted data; nothing approved/executed here)
FORMAL_PORTABLE_ROOT=$B FORMAL_PORTABLE_RUNNER_SHA256=020f8f5e… \
  $B/bin/tool-runner node validation/mvp-user-e2e/evidence/r2/drivers/j1-nl-journey.mjs \
  --phase propose --source-sha 7b85e82e434152e139d0d93bfb76ef72ad076f21

# HUMAN STEP: read nl-journey/proposal.json; check every rendered assert against
# your text; author nl-journey/review.json with your per-line verdicts and the
# decision. If the translation is wrong: record NEEDS_CORRECTION and correct via
# approveModel's {approved:true, edited:{...}} path or re-propose — never fake
# an approval.

# phase 2: approve (hash-covered) -> plan -> real z3 + cvc5 -> witness on AGREE_SAT
FORMAL_PORTABLE_ROOT=$B FORMAL_PORTABLE_RUNNER_SHA256=020f8f5e… \
  $B/bin/tool-runner node validation/mvp-user-e2e/evidence/r2/drivers/j1-nl-journey.mjs \
  --phase approve-execute --proposal validation/mvp-user-e2e/evidence/r2/nl-journey/proposal.json \
  --review validation/mvp-user-e2e/evidence/r2/nl-journey/review.json \
  --source-sha 7b85e82e434152e139d0d93bfb76ef72ad076f21
```

Real outcome @ 7b85e82: a NEW Chinese puzzle (p,e ∈ [1,12]; 3p+2e=17; e−p≥2)
→ `MODEL_PROPOSED` → review 7/7 line checks MATCH → **AGREE_SAT** with z3
witness (p,e)=(1,7) (`evidence/r2/nl-journey/`). The witness proves the
RENDERED model's answer, not translation fidelity — that is what the review
gate is for. Vague texts fail closed: `NEEDS_CLARIFICATION` with the model's
own questions, approval impossible (`NL_NOT_APPROVABLE`).

### 8.2 MCP `execute_workflow` (R2-B, 16th tool)

`plan_workflow` stays planning-only; `execute_workflow` executes a
`formal-tools/execution-plan/1.0` plan through the SAME executor the CLI uses:

- input (strict zod): `plan` (≤ 64 KiB JSON), `source_sha` (**REQUIRED 40-hex
  git commit SHA — no anonymous runs**), optional tighten-only `budget_caps`
  (may only shrink the plan's own budgets);
- executor-owned gates are never duplicated or bypassed: plan re-validation,
  tool allowlist, canonical input hashes (`PLAN_HASH_MISMATCH` before anything
  runs), DAG closure, budgets;
- returns the receipt's verdict dimensions un-collapsed
  (process_outcome / solver_answer / cross_tool_verdict / claim_verdict),
  stream hashes with 512-byte bounded log copies, artifact pointers;
- without the pinned bundle: honest ABORTED receipt
  (`BLOCKED_TOOL_MISSING`, claim `BLOCKED`) as a NON-error result — never a
  fabricated PASS.

Minimal stdio session (see `evidence/r2/parity/mcp-transcript.json` for a full
real transcript):

```bash
node packages/runner/js/mcp.mjs
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual","version":"0.0.1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute_workflow","arguments":{"plan":<plan object>,"source_sha":"<40-hex git SHA of your source tree>"}}}
```

### 8.3 Three-entry parity (how to reproduce)

Build the plan ONCE and feed the SAME plan object to all three entries; the
web bridge also re-derives it deterministically from the same text:

```bash
# plan once (bridge deterministic template; save the plan object)
curl -s -X POST http://127.0.0.1:8788/api/plan -H 'Content-Type: application/json' \
  -d "$(node -e '...{"problem_text": <file content>}...')" > plan-response.json
# (a) CLI
node packages/runner/js/cli.mjs workflow execute --plan-file plan.json --source-sha <40-hex>
# (b) MCP: tools/call execute_workflow with the same plan + source_sha
# (c) Web: paste the same text in the UI (deterministic plan), approve, run
```

Real outcome @ 7b85e82 (`evidence/r2/parity/parity-report.json`, 14/14 PASS):
identical `plan_sha256 ae4979bf…` on all three receipts, identical
AGREE_UNSAT + claim PASS, run_ids pairwise distinct, source_sha recorded
everywhere. Honest labeling: CLI/MCP carry the required git SHA; the Web
bridge binds `receipt.source_sha` to `plan.source.problem_sha256` by design —
an expected difference, never claimed equal.

### 8.4 Evidence scope semantics (R2-D)

`GET /api/runs/:id/evidence` returns the receipt bytes; `?part=manifest` the
hash manifest; `?part=stdout|stderr&step=<id>&scope=full|bounded` the log
artifacts. The rules the bridge enforces (verified live in
`evidence/r2/evidence-check/`):

- `receipt.steps[].stdout_sha256 / stderr_sha256` hash the **FULL captured
  streams** — authoritative.
- `logs/<step>.<part>.bounded.txt` are display copies capped at 4096 bytes and
  carry their **own** sha256 in the manifest (`scope: "bounded-copy"`).
- A plain-named `logs/<step>.<part>.txt` (`scope: "full-stream"`) exists only
  when its bytes VERIFY against the receipt's full-stream hash.
- Response headers: `X-Formal-Evidence-Scope: full-stream|bounded-copy` and
  `X-Formal-Full-Stream-Sha256` = the receipt's full-stream hash on BOTH
  scopes (never the bounded hash).
- `bounded_matches_full_stream` is `true` only when verified or provable
  (< cap); **null means never claimed**. For short-output runs full and
  bounded exist and are identical — asserted only via hash verification.
- Unknown scope values fail closed (`422 EVIDENCE_SCOPE_INVALID`).

### 8.5 Non-loopback token rule (fail-closed)

The bridge binds `127.0.0.1` by default. A **non-loopback bind REQUIRES
`FORMAL_WEB_TOKEN`**: startup refuses otherwise (`fail-closed: non-loopback
bind requires FORMAL_WEB_TOKEN`), so anonymous execution beyond the loopback
interface is impossible. With a token set, every non-`/api/meta` request needs
`Authorization: Bearer <token>` (401 without, 403 on mismatch). `FORMAL_WEB_TOKEN`
must never be committed; set it per-run from your environment.

### 8.6 R2 negative journeys (committed)

`evidence/r2/negatives/`: vague NL → `NEEDS_CLARIFICATION` + `NL_NOT_APPROVABLE`;
tampered plan over MCP → `PLAN_HASH_MISMATCH` pre-execution; empty
`FORMAL_PORTABLE_ROOT` via CLI and via the web bridge → honest ABORTED
`BLOCKED_TOOL_MISSING` receipts (browser banner screenshot
`screenshots/07-blocked-tool-missing-banner.png`). An honest solver-UNKNOWN
case was deliberately **not** fabricated (recorded NOT_RUN in the report).

R2-A launcher stack (#197/#198) is NOT on this main — launcher external-cwd
remains a PENDING_EXTERNAL_REVIEW item and was not tested here.

