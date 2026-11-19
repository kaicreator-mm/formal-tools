# UI_VISUAL_ACCEPTANCE.md — V5 Web UI real-browser evidence (OUTPUT_LABEL=FORMAL_TOOLS_I180_V5_WEB_UI)

Date: 2026-11-19 · Worktree `wt-i180-v5` (branch `i180/v5`) · Server: `node apps/web/server.mjs`
on http://127.0.0.1:8788/ (`mode: local-only`, `mocked_contracts: true`, engine `mock-v1`).
Engine is MOCKED this round — every visible simulated stream is prefixed `# [SIMULATED]` and
the header carries a persistent `MOCKED CONTRACTS` badge; no "real solver" claims are made.

Browser: ZCode in-app browser (IAB / Chromium), viewport 1280×720 (plus a 360×720 pass).
All screenshots below are of the **live running app** (server started in background, page
driven by real browser automation; DOM snapshots verified before every interaction).

## Artifacts (all under `apps/web-tests/artifacts/`)

| File | Screen | What it proves |
|---|---|---|
| `screen-1-input.png` | 1 · Problem input | Sample A loaded into the textarea; assumption line edited (focused, visible focus ring); `mode: local-only` + `MOCKED CONTRACTS` badges; stepper state |
| `screen-2-plan.png` | 2 · Plan review | Plan banner (`plan-f5f19188a1f55830 · kind: smt2`, problem_sha256, budget, compiled manifest hash); steps table s1 z3 / s2 cvc5 / s3 compare deps s1,s2; assumptions editor; **`Approve & run` disabled (grayed) until review checkbox is ticked** |
| `screen-3-run.png` | 3 · Run (mid-flight) | Live 1s-polling DAG: `s1 EXECUTED` (green chip, 520 ms, result JSON) while `s2 RUNNING`, `s3 QUEUED`; run_id + plan_id shown |
| `screen-4-results.png` | 4 · Results | Four separately labeled verdict rows: `process_outcome=OK`, `solver_answer=sat`, `cross_tool_verdict=AGREE_SAT`, `claim_verdict=NOT_APPLICABLE`; evidence download buttons |
| `screen-5-responsive-360.png` | results @ 360×720 | Single-column stacked verdict rows, readable at 360px (mobile floor per issue #185) |
| `screen-6-negative-failclosed.png` | 1 · negative path | Malformed prose input → red fail-closed status `fail-closed (422): input is neither SMT-LIB2 text … nor an LP JSON model…`; stays on input screen, nothing executes |
| `screen-7-unknown-results.png` | 4 · UNKNOWN walk | `solver_answer=unknown`, `cross_tool_verdict=UNKNOWN` (purple chip), banner: "honest outcome — not sat, not unsat, not an error" |
| `screen-8-lp-results.png` | 4 · LP walk (scenario B) | `solver_answer=optimal`, `cross_tool_verdict=NOT_APPLICABLE` for the HiGHS LP plan (`plan-502a24b099e8123a`, kind `lp-json`) |
| `screen-9-run-expanded-excerpt.png` | 3 · expanded excerpt | s1 stdout excerpt expanded across 1s re-renders: `# [SIMULATED] mock engine output — no real solver process was executed.` / `z3 4.13.0-SIMULATED` / `sat`; `(stderr empty)`; s2 EXECUTED, s3 RUNNING |

## Journeys performed (server-side receipts persisted in `apps/web-tests/.runs/`)

1. **Scenario A (SMT cross-check, sat)** — load sample A → edit assumption → Generate plan
   (plan `plan-f5f19188a1f55830`, 3 steps) → review → tick review checkbox (approve button
   flips disabled→enabled; verified before/after) → Approve & run (`run-mwndednl-8ec5b897`)
   → watch live DAG progression (screenshot mid-run) → results `OK / sat / AGREE_SAT /
   NOT_APPLICABLE` → evidence links rendered. Receipt persisted:
   `.runs/run-mwndednl-8ec5b897.json`.
2. **UNKNOWN walk** — sample `;; @expect: unknown` → plan `plan-306b76bf179423fb` → approve →
   run → `OK / unknown / UNKNOWN / NOT_APPLICABLE` with purple UNKNOWN banner (not an error
   display). Receipt persisted.
3. **Scenario B (HiGHS LP)** — sample B → plan `plan-502a24b099e8123a` (kind `lp-json`, 1 step
   highs solve-lp) → approve → run → `OK / optimal / NOT_APPLICABLE`. Receipt persisted.
4. **Negative (fail-closed)** — "Negative · malformed" sample (`this is not a model, just
   prose !!!`) → Generate plan → HTTP 422 with fail-closed message rendered in red on the
   input screen; no plan, no run. (An earlier probe also showed the empty-input fail-closed
   variant `EMPTY_PROBLEM`.) Additionally verified over HTTP: `UNSUPPORTED_PROBLEM`,
   `MALFORMED_LP_JSON` codes (see api.test.mjs).
5. **Evidence download** — real click on `⬇ Download receipt + streams (JSON)` (href
   `/api/runs/run-mwndednl-8ec5b897/evidence`) fired a browser **download event**; the same
   URL over HTTP returns `Content-Disposition: attachment; filename="receipt-….json"` and the
   per-step links return `attachment; filename="stdout-…-s1.txt"` with the exact
   `[SIMULATED]` stream bytes (verified live via curl; sha256 equality receipt↔stream is
   asserted in `apps/web-tests/api.test.mjs`).

## Checklist (per issue #185)

| Item | Result |
|---|---|
| Page loads at configured address, server live | PASS — http://127.0.0.1:8788/, title `formal-tools — task console` |
| Submit a real supported model | PASS (mocked engine; contract shapes real) — scenarios A and B |
| Inspect/approve plan (explicit gate) | PASS — approve disabled until review checkbox ticked (verified both states) |
| Live tool status during run | PASS — 1s polling, EXECUTED/RUNNING/QUEUED chips observed mid-flight |
| Actual result / UNKNOWN display | PASS — AGREE_SAT, UNKNOWN (purple, honest), optimal, fail-closed FAILED paths; each verdict dimension labeled separately |
| Evidence open/download | PASS with caveat — download event fired on real click; attachment headers + content verified over HTTP; **file materialization to disk not available in the IAB sandbox** (see gaps) |
| Negative fail-closed message | PASS — 422 rendered on-screen, no execution |
| Responsive 360px | PASS — single column, no horizontal overflow observed on results screen |
| Keyboard order / focus | PASS — Tab walk on screen 1: `problemText → sample-a → sample-b → sample-unknown → sample-invalid → assumptionsInput → generate-plan`; visible focus ring on focused textarea/button (screen-1); skip-link present |
| Labels / contrast | PASS — all text token pairs measured ≥ 4.5:1 (table in UI_DESIGN.md §2.2); controls have explicit labels |
| Mocked-ness disclosure | PASS — `MOCKED CONTRACTS` badge in header (tooltip explains V5-a), `/api/meta.mocked_contracts=true`, every stream prefixed `[SIMULATED]`, receipt `environment.simulated=true` |

## Honest gaps / limitations

1. **Engine is mocked (by design this round)** — no real z3/cvc5/highs process runs; stdout
   excerpts are simulated and labeled. Wiring the real V2/V3 engine is V5-b (master).
2. **Download materialization** — the in-app browser fires the download event but cannot save
   files to a host path in this sandbox; content and `Content-Disposition` headers were
   verified over HTTP instead (and by API tests). A desktop browser will save normally.
3. **Automation input path** — Playwright locator `click/check` never dispatched in this IAB
   session (`document.hasFocus()` was false at session start; the input pipeline later
   degraded entirely). Journeys A/UNKNOWN/negative were driven via the browser's DOM-CUA
   **node-path clicks** (genuine dispatched input). The LP walk and excerpt re-capture used
   in-page `el.click()` events through `evaluate` after the dispatch pipeline died — same
   handler paths as a user click, but not OS-level input events; noted for honesty.
   Keyboard walk used dispatched Tab keypresses while they still worked.
4. **Full-page screenshot glitch** — IAB `fullPage` capture duplicated the render once
   (screen-1 first attempt); replaced with viewport screenshots. Not an app defect.
5. `claim_verdict` is always `NOT_APPLICABLE` in this MVP round (no user claim submitted);
   it is rendered as its own labeled row so the four dimensions are never conflated.
6. Token-auth mode (`FORMAL_WEB_TOKEN`) is exercised by API tests (401/403), not shown in
   screenshots (local-only mode was the acceptance environment).
