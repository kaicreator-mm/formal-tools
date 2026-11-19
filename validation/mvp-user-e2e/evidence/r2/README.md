# R2 E2E acceptance evidence (i180 R2 closeout)

OUTPUT_LABEL=**FORMAL_TOOLS_I180_R2_E2E_ACCEPTANCE** · branch `i180/r2-e2e` · base main
**7b85e82e434152e139d0d93bfb76ef72ad076f21** (V1..V6 + R2-B #200 execute_workflow +
R2-D #199 evidence honesty + R2-C #201 nl-model).

Produced by the R2 **non-Writer** E2E acceptance validator (no R2 lane authored by
this agent). All live journeys ran on the trusted Debian host
`cc@192.168.100.200` with the pinned portable bundle
(`$B/bin/tool-runner` sha256 `020f8f5ed4281e477d74303194cc3b5b38064013c4fa8d20a13039f2eceeb65a`,
bundled node v22.16.0) and the REAL tools: DeepSeek `deepseek-chat` (API key from a
`0600` `.dsenv`, sourced per run, never logged/committed), **z3 5.4.0**,
**cvc5 1.4.2**. Every receipt records its `source_sha`; every journey driver is
committed under `drivers/` so each artifact below is reproducible. Hashes are
pinned by `SHA256SUMS` and re-verified offline by
`node --test tests/workflow-user-e2e-r2.test.mjs`.

## Journey 1 — NL → DeepSeek → review → approve → execute (P0 core)

`inputs/nl-sat-puzzle.txt` is a NEW Chinese bounded-integer puzzle authored by the
validator (deliberately different from the R2-C driver texts):

> 购买铅笔和橡皮:p 和 e 都是整数,各至少 1、不超过 12;3 元/铅笔、2 元/橡皮,
> 总价恰好 17 元;且 e − p ≥ 2。存在满足全部条件的 (p, e) 吗?

| step | file | outcome |
| --- | --- | --- |
| propose (real DeepSeek, 1 attempt) | `nl-journey/proposal.json` | `MODEL_PROPOSED`; variables `p,e ∈ [1,12]`, constraints `3p+2e==17`, `e−p≥2`, question `sat`, assumptions recorded |
| human-gate review (validator, agent surrogate) | `nl-journey/review.json` | line-by-line check of every rendered assert against the text: **7/7 MATCH**; approval input authored AFTER reading the proposal |
| approval (hash-covered) | `nl-journey/approved.json` | `USER_APPROVED`, `approved_sha256` binds reviewer+note |
| plan | `nl-journey/plan.json` | `wf-97ae30ca2ac1dcf5a287c4ac7fd8b122` (z3+cvc5+compare), provenance chain embedded |
| execute (real z3+cvc5) | `nl-journey/receipt.json` | **AGREE_SAT**, claim **PASS**, `source_sha=7b85e82e…` |
| witness probe (z3 get-value) | `nl-journey/witness.json` | `(p,e)=(1,7)`; every rendered bound/constraint holds — matches the validator's hand enumeration |
| summary | `nl-journey/report.json` | all checks true |

Honesty: the witness proves the RENDERED model's answer, never translation
fidelity; the approval was given by the E2E validator after actually checking
the rendering, and is labeled as an agent surrogate (not an independent human).

## Journey 2 — three-entry parity on ONE fixed plan

Fixed SMT input `inputs/scenario-r2.smt2` (hand-certain UNSAT: x,y∈[0,3] ⇒
x+y≤6 < 9). The plan was built ONCE by the bridge's deterministic template
(`POST /api/plan`, `parity/plan-api-response.json`) → plan
`wf-84b428d69985159a3ff634e51e8a3672`. Then:

| entry | driver step | receipt | verdict |
| --- | --- | --- | --- |
| (a) CLI `workflow execute` (real subprocess) | `parity/cli-receipt.json` | run `run-mwnoin47-c2aae129` | AGREE_UNSAT / PASS |
| (b) MCP `tools/call execute_workflow` (stdio JSON-RPC child, `source_sha=7b85e82e…`) | `parity/mcp-execute-response.json`, `parity/mcp-transcript.json` | run `run-mwnoind9-0a2b5645` | AGREE_UNSAT / PASS |
| (c) Web via REAL browser (submit same text → deterministic plan → approve → run) | `parity/web-run-summary.json`, `parity/web-receipt.json`, `screenshots/01..04` | run `run-mwnolhqi-56e1aaf1` | AGREE_UNSAT / PASS |

Assertions (`parity/parity-report.json`, 14/14 PASS):

- **identical `plan_sha256` `ae4979bff7d92f6b…` across all three receipts** (the
  browser re-derived the identical deterministic plan from the same text);
- identical overall verdicts (AGREE_UNSAT everywhere, claim PASS everywhere);
- the three `run_id`s are pairwise distinct;
- every receipt records a source_sha: CLI/MCP carry the required 40-hex git
  label `7b85e82e…`; the **Web bridge binds `source_sha` to
  `plan.source.problem_sha256` by design** — recorded as an expected design
  difference, never claimed equal.

A second browser run (`run-mwnon705-eda607c1`,
`parity/web-run-2-download-demo-summary.json`) exercised the in-browser
evidence download click.

## Journey 3 — negative fail-closed cases (4 + 1 honest skip)

`negatives/negatives-report.json` — all expectations held:

| case | observed |
| --- | --- |
| (a) vague NL `inputs/vague-nl.txt` → real DeepSeek | `NEEDS_CLARIFICATION` with 3 specific questions; `rendering: null`; `approveModel` threw `NL_NOT_APPROVABLE`. Never rendered, never executed. |
| (b) tampered plan over MCP `execute_workflow` (step input mutated, `input_sha256` kept) | tool error BEFORE anything ran: `isError:true`, `code:PLAN_HASH_MISMATCH`, `executed:false` (`negatives/mcp-tampered-*.json`) |
| (c) CLI with `FORMAL_PORTABLE_ROOT=<empty dir>` | honest ABORTED receipt: `fail_closed_reason=BLOCKED_TOOL_MISSING`, claim `BLOCKED`, every step `NOT_RUN`, exit 2, no crash (`negatives/cli-blocked-tool-missing.receipt.json`) |
| (d) Web bridge on :8789 with the empty bundle root | same honest ABORTED receipt; the browser rendered the "BLOCKED — TRUSTED TOOLS UNAVAILABLE (fail-closed, nothing simulated)" banner (`negatives/web-blocked-tool-missing.receipt.json`, `screenshots/07-blocked-tool-missing-banner.png`, run `run-mwnoo5qf-df6b1e68`) |
| UNKNOWN-class case | **NOT_RUN** (recorded, not fabricated): an honest solver-`unknown` is not cleanly constructible under the fixed budget without scripting a solver |

## Journey 4 — web evidence correctness (R2-D regression at E2E level)

`evidence-check/evidence-verification.json` + `evidence-check/http-headers.json`
(real HTTP against the running bridge for run `run-mwnolhqi-56e1aaf1`; browser
download in `screenshots/05/06`): 28/28 checks PASS —

- `receipt.json` bytes hash-verify against `manifest.receipt_sha256`;
- for every step stream, `X-Formal-Evidence-Scope` is exactly
  `full-stream` / `bounded-copy`; `X-Formal-Full-Stream-Sha256` equals the
  receipt's FULL-stream hash on BOTH scopes (never the bounded hash);
- `sha256(full bytes) == receipt stdout_sha256`; `sha256(bounded bytes) ==
  manifest bounded_sha256`; artifact scopes labeled
  `full-stream` / `bounded-copy` with their own hashes;
- `bounded_matches_full_stream === true` on this short-output run — asserted
  only because the manifest recorded verified identity AND the served bytes
  hash-verify; the >4KiB truncation split itself stays unit-proven
  (tests/workflow-evidence.test.mjs), no identity claim is made beyond the
  verified labels;
- wrong `scope` values are refused fail-closed (`422 EVIDENCE_SCOPE_INVALID`).

## Reproduction (trusted host)

```bash
cd /home/cc/formal-tools-build/wt-i180-r2e   # synced worktree (incl. node_modules minus .bin)
B=/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64
set -a && . ./.dsenv && set +a               # DEEPSEEK_API_KEY (0600), delete after
FORMAL_PORTABLE_ROOT=$B FORMAL_PORTABLE_RUNNER_SHA256=020f8f5e… \
  $B/bin/tool-runner node validation/mvp-user-e2e/evidence/r2/drivers/j1-nl-journey.mjs \
  --phase propose --source-sha 7b85e82e434152e139d0d93bfb76ef72ad076f21
# ... then --phase approve-execute with an authored review.json (see drivers)
```

See `docs/mvp/USER_GUIDE.md` §8 (R2 addendum) for the full runbook. Web servers:
`:8788` with the real bundle, `:8789` with an EMPTY `FORMAL_PORTABLE_ROOT`
(the blocked-path demo).

## PENDING_EXTERNAL_REVIEW

- The R2-A launcher stack (#197/#198) is **not on this main** (7b85e82); the
  launcher external-cwd behavior is NOT tested here and remains a
  PENDING_EXTERNAL_REVIEW item for the R2-A owner.

## Screenshots

| file | shows |
| --- | --- |
| `01-input-scenario-r2.png` | fixed SMT text pasted, deterministic template selected, real-engine badge |
| `02-plan-review-deterministic.png` | plan `wf-84b428d69985159a3ff634e51e8a3672` review screen (same plan_id as CLI/MCP) |
| `03-run-real-solvers.png` | results of browser run 1 top (AGREE_UNSAT / PASS) |
| `04-results-agree-unsat.png` | full results screen of browser run 2 (`run-mwnon705-eda607c1`) |
| `05-evidence-section-hash-lines.png` | evidence hash lines: full-stream vs bounded labeled, "verified identical to the full stream" |
| `06-evidence-download-attempt.png` | after the "Download receipt (JSON)" click (browser download observed) |
| `07-blocked-tool-missing-banner.png` | :8789 journey — honest BLOCKED banner, ABORTED/BLOCKED, "no solver answer is claimed" |
