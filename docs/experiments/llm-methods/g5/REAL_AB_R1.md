# Issue #11 / G5 — REAL paired A/B run R1 (deepseek-flash, 2026-11-13)

First **real** paired LLM_ONLY vs LLM_TOOLS observation over the frozen
six-case fixture, executed by `benchmarks/llm-methods/g5/real-paired-run.mjs`
against the live DeepSeek API. This document is the comparison record across
the two retained runs. It follows the score contract of
`docs/experiments/llm-methods/g5/FROZEN_AB_R0.md`: everything here is
`SCORED_UNATTESTED`, `g5_accepted=false` — a real paired observation, **not**
a G5 qualification.

## What ran

1. **Protocol v1** (`g5-real-paired-deepseek-flash-2026-11-13`,
   `max_output_tokens` 1024), frozen provably before the first API call
   (`frozen_at` 2026-11-13T14:35:10.082Z), run at repo head `89ebc02`.
   Result: 12/12 calls OK, but one **budget-truncation artifact** —
   `LLM_ONLY__positive-sequential-same-writer` returned
   `finish_reason:"length"` with empty content (the reasoning model consumed
   all 1024 output tokens before emitting any visible text), which the
   driver's parser honestly recorded as UNKNOWN.
2. The **pre-declared single-revision rule** for budget-inconclusive runs
   (declared in the v1 README before any re-run): exactly one full paired
   re-run of all 12 calls at a raised output budget under a new protocol id —
   never a re-roll of individual calls or arms.
3. **Protocol v2** (`g5-real-paired-deepseek-flash-2026-11-13-v2`,
   `max_output_tokens` 1024 → 4096, all other constants byte-identical),
   frozen at `frozen_at` 2026-11-13T14:52:16.259Z, run at repo head `4cd5dcf`.
   Result: 12/12 calls OK, **zero truncation** — every call finished
   `finish_reason:"stop"` with a parseable verdict.

**Both runs are retained byte-exact** in the repo: v1 at
`validation/llm-ab-real-2026-11-13-run1/`, v2 at
`validation/llm-ab-real-2026-11-13/`. Each contains the frozen
`protocol.json`, the driver-written `arms.json`, and 12 raw trace files whose
sha256 match the per-case `raw_trace_sha256` anchors inside `arms.json`.

## Real run facts (protocol v2, the budget-conclusive run)

Constants: requested model `deepseek-flash`, endpoint
`https://api.deepseek.com/chat/completions`, temperature 0, seed declared-only
(never sent), one call per case per arm, zero retries. **Served model was
`deepseek-flash` on every trace of both runs** (all 24 calls). Pricing per
the protocol binding: DeepSeek official pricing page
(api-docs.deepseek.com/quick_start/pricing, read 2026-11-13), peak tier,
USD 0.3 / 1M input tokens (cache miss) + USD 1.2 / 1M output tokens,
`cost_usd = (prompt_tokens*0.3 + completion_tokens*1.2)/1e6`.

Scores recomputed from the committed `arms.json` with the merged frozen
scorer (`scoreFrozenPairedAB`); status `SCORED_UNATTESTED`:

| metric | LLM_ONLY (baseline) | LLM_TOOLS (augmented) | delta (TOOLS − ONLY) |
|---|---|---|---|
| correct | 6/6 | 6/6 | — |
| accuracy_all_cases | 1.0 | 1.0 | 0 |
| accuracy_classified | 1.0 | 1.0 | 0 |
| false_pass | 0 | 0 | 0 |
| false_pass_rate_on_negatives | 0 | 0 | — |
| false_reject | 0 | 0 | 0 |
| unknown | 0 | 0 | 0 |
| coverage | 1.0 | 1.0 | 0 |
| cost_usd | 0.00259320 | 0.00355500 | +0.00096180 (~+37%) |
| latency_ms (arm total) | 14086 | 17113 | +3027 |
| input_tokens | 1688 | 3102 | — |
| output_tokens | 1739 | 2187 | — |

Timestamps: v2 protocol `frozen_at` 2026-11-13T14:52:16.259Z; v2 `arms.json`
`generated_at` 2026-11-13T14:52:47.478Z (all 12 calls inside that window).
The truncated v1 run for comparison: baseline 5/6 correct with 1
truncation-UNKNOWN (accuracy_all_cases 0.8333, coverage 0.8333,
cost 0.00323040, latency 17258 ms), augmented 6/6 (accuracy 1.0,
cost 0.00339780, latency 16461 ms) — recorded in
`validation/llm-ab-real-2026-11-13-run1/README.md`.

## Honest findings

1. **The infrastructure works end-to-end.** A frozen protocol captured before
   any API call, a paired driver with per-case raw trace receipts, real
   per-call token/cost/latency metering bound to a published pricing source,
   and a frozen scorer whose recomputation over the committed arms reproduces
   the reported numbers exactly. The v1 truncation incident additionally
   demonstrated that the pipeline records failures honestly (UNKNOWN, no
   fabrication) and that the pre-declared revision rule works as designed.
2. **Zero false-PASS across 24 paired calls on trap-containing cases.** In
   both runs and both arms, every negative case (overlap same writer, cycle,
   predecessor order, zero duration) was judged FAIL and every positive PASS;
   no arm ever claimed PASS on a violating scenario.
3. **Ceiling effect: no accuracy delta at this fixture/model combination.**
   With a sufficient output budget the served model solves all six synthetic
   cases in BOTH arms, so tool augmentation shows zero accuracy and coverage
   gain while costing ~37% more USD and ~3 s more wall-clock. This is
   **explicitly not evidence that tools never help** — only that this
   six-case synthetic fixture at this model cannot demonstrate a difference.
   Harder frozen case sets are required for a real G5 qualification.

## Limits

- Traces remain **self-reported** pending independent raw-trace review
  (`independent_raw_trace_review: NOT_RUN`). A controller recomputation of
  the scores from the committed arms exists, and an independent non-Writer
  recompute is recorded in the PR review.
- The oracle is **source-authored synthetic and unaudited**
  (`business_oracle: SOURCE_AUTHORED_SYNTHETIC`); the six cases carry no
  independent Domain sign-off.
- Status stays `SCORED_UNATTESTED`, `g5_accepted=false`. No tools-advantage
  claim may be derived from these runs.
- Single model, single endpoint, single temperature; **temperature 0 is not
  determinism** — reruns can differ, and one paired run per protocol is an
  observation, not a distribution.
