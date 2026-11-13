# G5 REAL paired A/B run — protocol v2 (2026-11-13, run 2)

Evidence for Issue #11 / G5: the real paired A/B run of
`benchmarks/llm-methods/g5/real-paired-run.mjs` over the frozen six-case
fixture, executed by the controller at repo head `4cd5dcf` with the real
DeepSeek API key. Files here are byte-identical copies of the driver output
(staged outside the repo, then committed verbatim; no regeneration, no
re-serialization). The controller's `score.json` is intentionally **not**
committed: the reviewer recomputes scores from `arms.json` with the merged
frozen scorer (`scoreFrozenPairedAB`).

## Protocol

- `protocol_id`: `g5-real-paired-deepseek-flash-2026-11-13-v2` (protocol **v2**)
- v2 = v1 (`g5-real-paired-deepseek-flash-2026-11-13`) with
  `max_output_tokens` 1024 → 4096, under the pre-declared single-revision rule
  for budget-inconclusive runs; all other constants byte-identical. The v1
  truncation artifact that triggered the rule is documented in
  `validation/llm-ab-real-2026-11-13-run1/README.md`
  (`LLM_ONLY__positive-sequential-same-writer` returned `finish_reason:"length"`
  with empty content → honest UNKNOWN).
- Requested model `deepseek-flash`, endpoint
  `https://api.deepseek.com/chat/completions`, temperature 0, seed declared-only
  (never sent), exactly one call per case per arm (12 total), zero retries,
  abort on non-2xx / transport error / missing usage.
- API key read from `process.env.DEEPSEEK_API_KEY` only; never logged or
  persisted.
- `protocol.json` was captured provably before the first API call
  (`frozen_at` 2026-11-13T14:52:16.259Z); `arms.json` was written after the
  12th call (`generated_at` 2026-11-13T14:52:47.478Z).
- Pricing bound in the protocol: DeepSeek official pricing page
  (api-docs.deepseek.com/quick_start/pricing, read 2026-11-13), peak tier,
  USD 0.3 / 1M input (cache miss) + USD 1.2 / 1M output;
  `cost_usd = (prompt_tokens*0.3 + completion_tokens*1.2)/1e6` rounded to 8
  decimals.

## Run outcome

- **12/12 calls OK** (all HTTP 200) at **2026-11-13T14:52Z**; **served model
  `deepseek-flash` on every trace** (`served_model` field, all 12 files).
- **Zero truncated calls**: all 12 calls finished `finish_reason:"stop"` with
  parseable verdicts (`verdict_parse.parse:"ok"`). The v1 budget artifact is
  fully resolved by the raised output budget.

## Scorer outcome (frozen scorer over these arms; `SCORED_UNATTESTED`)

| metric | LLM_ONLY (baseline) | LLM_TOOLS (augmented) | delta (TOOLS − ONLY) |
|---|---|---|---|
| correct | 6/6 | 6/6 | — |
| classified | 6 | 6 | — |
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

**Honest headline: ceiling effect.** With a sufficient output budget the
served model solves all six synthetic cases in BOTH arms; tool augmentation
produced no accuracy gain on this fixture while costing ~37% more USD. Zero
false-PASS in both arms, here and in the v1 run. **No tools-advantage claim
may be derived from this run** — and symmetrically, it is not evidence that
tools never help; this fixture simply cannot demonstrate a difference.
Harder frozen case sets are required for a real G5 qualification.

Arms remain self-reported observations: `independent_raw_trace_review:
NOT_RUN`, `business_oracle: SOURCE_AUTHORED_SYNTHETIC`, `g5_accepted: false`.
This is a real paired observation, not a qualification.

## Prior runs

- Protocol **v1** run (budget-truncation artifact, pre-declared revision rule,
  12/12 calls with one `finish_reason:"length"` → UNKNOWN):
  `validation/llm-ab-real-2026-11-13-run1/` — retained byte-exact as the
  record of why v2 exists.

## Integrity anchors (sha256 of committed bytes)

- `protocol.json`: `5fe2b06eefa0073f4814b8b4d8e0f031f352d87cd80787905de8cd5c5e6c960f`
- `arms.json`: `47287c5035bb39e17fea3d6291caaa55f3742194477a5fbb9ad1565806314f2c`
- Per-case `raw_trace_sha256` values in `arms.json` equal the sha256 of the
  committed `traces/<ARM>__<case_id>.json` files (verified at commit time).
