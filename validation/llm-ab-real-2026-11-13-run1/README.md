# G5 REAL paired A/B run — protocol v1 (2026-11-13, run 1)

Evidence for Issue #11 / G5: the real paired A/B run of
`benchmarks/llm-methods/g5/real-paired-run.mjs` over the frozen six-case
fixture, executed by the controller at repo head `89ebc02` with the real
DeepSeek API key. Files here are byte-identical copies of the driver output
(staged outside the repo, then committed verbatim; no regeneration, no
re-serialization).

## Protocol

- `protocol_id`: `g5-real-paired-deepseek-flash-2026-11-13` (protocol **v1**)
- Requested model `deepseek-flash`, endpoint
  `https://api.deepseek.com/chat/completions`, temperature 0, seed declared-only
  (never sent), **max_output_tokens 1024**, exactly one call per case per arm
  (12 total), zero retries, abort on non-2xx / transport error / missing usage.
- API key read from `process.env.DEEPSEEK_API_KEY` only; never logged or
  persisted.
- `protocol.json` was captured provably before the first API call
  (`frozen_at` 2026-11-13T14:35:10.082Z); `arms.json` was written after the
  12th call (`generated_at` 2026-11-13T14:35:43.817Z).

## Run outcome

- **12/12 calls OK** (all HTTP 200) at **2026-11-13T14:35Z**; **served model
  `deepseek-flash` on every trace** (`served_model` field, all 12 files).
- 11/12 calls finished `stop` with parseable verdicts.
- **One truncation (budget artifact):**
  `traces/LLM_ONLY__positive-sequential-same-writer.json` returned
  `finish_reason:"length"` with **empty content** — the served reasoning model
  consumed the entire `max_output_tokens:1024` budget on reasoning
  (`usage.completion_tokens:1024`, `completion_tokens_details.reasoning_tokens:1024`)
  before emitting any visible content. The driver's verdict parser behaved
  exactly as designed: `verdict_parse {"prediction":"UNKNOWN","parse":"no_content"}` —
  an honest UNKNOWN, no fabrication. The artifact hit the no-tools arm
  asymmetrically (the LLM_TOOLS call for the same case finished `stop`, PASS,
  722 output tokens).

## Scorer outcome (frozen scorer over these arms; `SCORED_UNATTESTED`)

| metric | LLM_ONLY (baseline) | LLM_TOOLS (augmented) | delta (TOOLS − ONLY) |
|---|---|---|---|
| correct | 5/6 (+1 truncation-UNKNOWN) | 6/6 | — |
| classified | 5 | 6 | — |
| accuracy_all_cases | 0.8333 | 1.0 | +0.1667 |
| accuracy_classified | 1.0 | 1.0 | 0 |
| false_pass | 0 | 0 | 0 |
| false_pass_rate_on_negatives | 0 | 0 | — |
| false_reject | 0 | 0 | 0 |
| unknown | 1 | 0 | −1 |
| coverage | 0.8333 | 1.0 | +0.1667 |
| cost_usd | 0.00323040 | 0.00339780 | +0.00016740 |
| latency_ms (arm total) | 17258 | 16461 | −797 |
| input_tokens | 1688 | 3102 | — |
| output_tokens | 2270 | 2056 | — |

The baseline's single UNKNOWN is the truncation artifact above, not a model
abstention: no content was ever emitted. Arms remain self-reported
observations: `independent_raw_trace_review: NOT_RUN`,
`business_oracle: SOURCE_AUTHORED_SYNTHETIC`, `g5_accepted: false`.

## Pre-declared revision rule (budget-inconclusive runs)

Declared before any re-run, binding for this experiment line:

- If **any** call in **either** arm returns `finish_reason:"length"`, the run
  is **budget-inconclusive**: the truncation is a budget artifact, not evidence
  about the arm.
- Remedy is **exactly one full paired re-run** (all 12 calls, both arms) at a
  raised output budget under a new protocol id — never a re-roll of individual
  calls or arms, which would break pairing and invite selection bias.
- **Both runs are retained** in the repo with their protocols and traces; the
  truncation and the revision are documented, not silently absorbed.

Per this rule, protocol **v2**
(`g5-real-paired-deepseek-flash-2026-11-13-v2`, `max_output_tokens` 1024 → 4096,
all other constants byte-identical) supersedes v1 for the next run; v1 and this
README remain as the record of why.

## Integrity anchors (sha256 of committed bytes)

- `protocol.json`: `1a351d2e5f70a4ac9e93721f251a1f3e1a71f4417914db40caec8ad4f837d277`
- `arms.json`: `be0741981d4671fca959a3758e3c265aae86737fe0650622f0147c9238396754`
- truncated trace `traces/LLM_ONLY__positive-sequential-same-writer.json`:
  `ec2c0a45555ef555832ea2a4192cc3f0473092c3af55c4c24af0821bbbdd51a4`
