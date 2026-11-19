# UI_VISUAL_ACCEPTANCE.md — V5-b Web UI real-browser evidence (OUTPUT_LABEL=FORMAL_TOOLS_I180_V5B_LIVE_ENGINE)

Date: 2026-11-19 · Worktree `wt-i180-v5b` (branch `i180/v5b`, base `f2b6a8d`) · Server:
`node apps/web/server.mjs` on http://127.0.0.1:8788/ (`mode: local-only`,
`mocked_contracts: false`, engine `workflow-v2+v3` — the REAL V2 planner/compiler + V3
executor behind the bounded bridge). The MOCKED badge of V5-a is gone; the header now
carries a persistent `engine: workflow-v2+v3 (real)` badge.

**Honest scope note (read first):** the trusted native tool host (cc@192.168.100.200
portable bundle) is currently UNREACHABLE, and this Windows machine has no z3/cvc5/highs
binaries. Therefore every real run on this machine honestly fails closed BEFORE any tool
starts: the V3 executor returns a REAL `formal-tools/execution-receipt/1.0` receipt with
`overall.process_outcome=ABORTED`, `fail_closed_reason=BLOCKED_TOOL_MISSING`,
`claim_verdict=BLOCKED`, all steps `NOT_RUN`, and `tool_versions={}` (no probes were
possible). That blocked state is what the browser walk below shows and what the receipts
under `apps/web-tests/.runs/` contain — nothing is simulated and no solver answer is
claimed. The full happy-path browser walk with real solver output happens in **V6** on
the trusted host and is deliberately NOT faked here.

The one real LLM integration point IS real this round: `provider:"deepseek"` plans made
an actual DeepSeek API call (`deepseek-chat`, key from `DEEPSEEK_API_KEY`), and the
proposal entered the plan only through the V2 static validation gates.

Browser: ZCode in-app browser (IAB / Chromium), viewport 1280×800. All screenshots are
of the live running app; DOM snapshots were verified around every interaction.

## Artifacts (all under `apps/web-tests/artifacts/`)

| File | Screen | What it proves |
|---|---|---|
| `live-1-blocked-run.png` | 4 · Results (blocked) | Distinct **BLOCKED banner** (warn tones, dashed border + left accent): "BLOCKED — TRUSTED TOOLS UNAVAILABLE (fail-closed, nothing simulated)" with `fail_closed_reason: BLOCKED_TOOL_MISSING` and the plain-language fail-closed explanation. Verdict rows: `process_outcome=ABORTED`, `solver_answer=null (kind: none)`, `cross_tool_verdict=NOT_APPLICABLE`, `claim_verdict=BLOCKED`; environment line `host: 127.0.0.1 · node: v26.13.0 · portable root sha: none · receipt run_id: run-mwng24dx-…`; receipt + hash-manifest download buttons (no per-step stream links — none exist, honestly) |
| `live-2-deepseek-plan.png` | 2 · Plan review (real LLM) | Plan source badge **"DeepSeek (deepseek-chat) — LLM proposal, admitted as data via static validation"**; the LLM-proposed method rendered as steps `z3-solve` (z3/solve-smt, 30s) → `cvc5-solve` (cvc5/solve-smt, depends on z3-solve, 30s) plus the executor-side `step-agree` compare (5s) appended by the bridge; approve gate disabled |
| `live-3-negative-422.png` | 1 · negative path | Malformed prose input → red fail-closed status `fail-closed (422) UNSUPPORTED_PROBLEM: …neither SMT-LIB2 text … nor an LP JSON model with exactly sense/objective/variables/constraints keys`; stays on input screen, nothing executes |
| `live-4-plan-template.png` | 2 · Plan review (template) | Deterministic template badge "smt-cross-check@v1 — built-in, offline"; real V2 plan `wf-c8a68ee6…` with steps `step-z3`/`step-cvc5`/`step-agree`, real compiled manifest hash; **`Approve & run` disabled until the review checkbox is ticked** (verified `approveDisabledBeforeReview=true`, and enabled=true after check during the walk) |

## Journeys performed (server-side receipts persisted in `apps/web-tests/.runs/`)

1. **Scenario A (SMT cross-check) → honest BLOCKED run** — load sample A → Generate plan
   (deterministic template, plan `wf-c8a68ee603a810d9a5ef4a7f049be057`, 3 steps) → tick
   review checkbox (approve button flips disabled→enabled; verified both states) →
   Approve & run (`run-mwng24dx-125c1c30`) → results screen renders the blocked state
   (live-1). Persisted artifacts: `.runs/run-mwng24dx-125c1c30/{receipt.json,
   manifest.json, logs/}` — the same files the evidence endpoints serve byte-identically
   (asserted in `apps/web-tests/api.test.mjs`).
2. **Real DeepSeek plan** — planning source = DeepSeek → Generate plan → a real
   `deepseek-chat` call proposed the two-solver method (live-2; `method_sha256` recorded
   in the plan response). The proposal is untrusted data: it passed `assessMethod` +
   `buildExecutionPlan` before the plan existed.
3. **Negative (fail-closed)** — "Negative · malformed" sample → Generate plan → HTTP 422
   `UNSUPPORTED_PROBLEM` rendered in red on the input screen (live-3); no plan, no run.
4. **Evidence endpoints over HTTP** (cross-checked outside the browser):
   `GET /api/runs/:id/evidence` serves the persisted `receipt.json` bytes as an
   attachment; `?part=manifest` serves the hash-bound artifact manifest; per-step stream
   downloads honestly 404 with `ARTIFACT_NOT_FOUND` ("step never produced a stdout
   stream") on this binary-less machine.

## Checklist

| Item | Result |
|---|---|
| Page loads at configured address, server live | PASS — http://127.0.0.1:8788/, title `formal-tools — task console` |
| Submit a real supported model | PASS — scenarios A (SMT) and B (LP, exercised via API tests + earlier walks) |
| Inspect/approve plan (explicit gate) | PASS — approve disabled until review checkbox ticked (verified both states, live-4) |
| Plan source honesty | PASS — deterministic template vs DeepSeek (deepseek-chat) badges (live-2 / live-4) |
| Live run status | PASS — 1s polling; on this machine the run completes as an honest fail-closed ABORT within ~1s |
| Actual result / blocked display | PASS — distinct BLOCKED banner + `ABORTED / null / NOT_APPLICABLE / BLOCKED` verdict rows (live-1); no solver answer claimed |
| Evidence open/download | PASS — receipt + hash-manifest attachments verified over HTTP; byte-identical to persisted files (API tests) |
| Negative fail-closed message | PASS — 422 rendered on-screen, no execution (live-3) |
| Mocked-ness removed | PASS — `MOCKED CONTRACTS` badge deleted from HTML (asserted in api.test.mjs), `/api/meta.mocked_contracts=false`, engine `workflow-v2+v3 (real)` badge shown |
| Real LLM disclosure | PASS — DeepSeek plans labeled with the real provider + model name; no key ⇒ honest `BLOCKED_PROVIDER` (API test) |
| Keyboard order / focus / labels | PASS — unchanged from V5-a (native controls, explicit labels, skip-link, focus-visible ring); not re-walked this round |

## Honest gaps / limitations

1. **Trusted tool host unreachable (this round)** — no real z3/cvc5/highs execution and
   therefore no AGREE_SAT/UNKNOWN/CONTRADICTION happy-path walks in the browser. The
   BLOCKED state shown is the true, fail-closed behavior of a binary-less machine, not a
   mock. **V6 on the trusted host must re-walk the happy paths** (sat agreement, unknown,
   contradiction, LP optimal) with real receipts.
2. **Download materialization** — the in-app browser fires the download event but cannot
   save files to a host path in this sandbox; receipt/manifest bytes + `Content-Disposition`
   headers were verified over HTTP instead (and by API tests).
3. **Automation input path** — in this IAB session neither Playwright locator
   `click()` nor DOM-CUA node-path clicks dispatched to the page (same degradation V5-a
   documented). All journeys were driven via in-page genuine `el.click()` calls through
   `evaluate` — the same handler paths a user click takes, but not OS-level input
   events. Checkbox/enable/disable gate states were read back before/after.
4. **Results-screen banner placement bug fixed this round** — the verdict banner is now
   rendered on the results screen itself (`#resultNote`); V5-a wrote it to an element on
   the hidden run screen.
5. One transient blank full-viewport capture occurred (IAB capture glitch, V5-a gap #4
   recurrence); the affected screenshot was retaken.
6. `claim_verdict` renders as `BLOCKED` on this machine (receipt-derived); the
   `NOT_APPLICABLE` no-claim case and `PASS`/`UNSUPPORTED_BY_MVP` semantics await V6
   happy-path receipts.

## V5-a (mock round) evidence

The mocked-engine round (V5-a, PR #191) evidence lives in git history
(`docs/mvp/UI_VISUAL_ACCEPTANCE.md` @ `5a9085e`); its `[SIMULATED]` walkthroughs are
obsolete now that the real engine is wired and the mock artifacts were removed.
