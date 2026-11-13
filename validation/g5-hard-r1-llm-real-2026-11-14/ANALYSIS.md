# G5 hard-r1 real 40-call paired run — independent analysis (2026-11-14)

Evidence dir: `validation/g5-hard-r1-llm-real-2026-11-14/`
Executor: R7 session, independent non-Writer Source-First reviewer + real-run executor.
Exact source HEAD: `50a2e77a73e75d00fe79272e9196f84f5ced7850` (PR #74, branch `experiment/i11-g5-hard-discriminator-r0`).

## What ran

- **Native:** NOT re-run. The committed 20×2 receipts (Z3 5.4.0 / cvc5 1.4.2, uid 65534,
  `validation/g5-hard-r1-native-2026-11-13/REAL_JS_NATIVE_UID65534.json`, git blob
  `d74a27c1c13f497a46fdec151c5f234efc88af2f`) were re-verified offline and extracted
  byte-exact (per-file SHA-256 match the #74 closeout claims: z3 `d4d7dfab…`,
  cvc5 `6de8167e…`). `prepareHardAB` accepted both receipts against this worktree's
  frozen source (`source_sha256=b4dce007…`, 20 cases, 10 SAT/10 UNSAT, cross-engine
  agreement 20/20).
- **LLM:** 40 real DeepSeek API calls via the frozen driver
  `benchmarks/llm-methods/g5/hard-paired-run.mjs` (protocol `g5-hard-r1-20-cases-deepseek-flash-v1`):
  20 LLM_ONLY + 20 LLM_TOOLS, temperature 0, max_tokens 4096, zero retries,
  served-model identity checked per call, `finish_reason=stop` enforced,
  `DEEPSEEK_API_KEY` read from process env only and never serialized (grep-clean).

## Pre-declared controls (RUN_CONFIG.json, written before the first call)

- Hard cost cap **$0.50** with external watchdog (actual total **$0.030763**, headroom $0.469237; cap never triggered).
- Anomaly policy: driver is assert-fail-closed (HTTP/served-model/truncation/usage) — any anomaly aborts the whole run.
- Restart policy: at most one restart, only if 0 calls succeeded for environmental reasons. Not needed (40/40 OK first attempt).

## Results (independently recomputed from the 40 raw traces, `recompute-analysis.mjs`, findings=0)

| metric | LLM_ONLY | LLM_TOOLS | Δ |
|---|---|---|---|
| correct / 20 | **20** | **20** | 0 |
| false-PASS | 0 | 0 | 0 |
| false-reject | 0 | 0 | 0 |
| UNKNOWN | 0 | 0 | 0 |
| coverage | 1.0 | 1.0 | 0 |
| cost USD | 0.015520 | 0.015243 | −0.000277 |
| latency ms (sum) | 73,203 | 60,425 | −12,778 |

All 40 calls: `served_model=deepseek-flash`, `finish_reason=stop`, verdict parse ok,
2xx, usage safe integers. arms.json rows match recomputed traces byte-for-byte
(SHA-256 per trace) and the frozen scorer (`scoreHardPairedAB`) agrees with every
aggregate. Protocol document was frozen 5 ms before the first call.

## Honest finding — ceiling persists

Even on the harder pre-frozen 20-case hard-r1 suite, **both arms are 20/20 with zero
false-PASS and zero UNKNOWN**. The tool arm shows **no measured accuracy advantage
(Δ=0)**; this round it was marginally cheaper and faster (noise-level, and the sign
flips the v2 six-case round's +37% cost delta). Per the predeclared protocol:
no tool-superiority claim, no tool-futility claim, cases are not re-mined, and the
next difficulty revision may only be declared by a predeclared protocol change.
The 20-case cohort is NOT comparable with the six-case cohort; statistics are never
combined.

## Qualification boundaries (unchanged)

`SCORED_UNATTESTED` / `g5_accepted=false` / `actual_qualification=NOT_RUN` (protocol field),
`independent_semantic_oracle=false`. The authored 20 labels were re-verified by the
reviewer's own independent finite checker (20/20 agreement) but the semantic Oracle
remains source-authored, NOT an independently credentialed ADS Product Owner.
No G4 Qualified Solution/Replay and no G6 real DIS SDK/KDP/Host consumption PASS is
claimable from this evidence: those remain gated by professional
Source/Model/Oracle/Tool/Host qualification outside this session's authority.

## Files

- `RUN_CONFIG.json` — pre-declared cap/policy (before first call)
- `protocol.json` — driver-frozen protocol (before first call)
- `traces/*.json` — 40 raw per-call traces (request/response/usage/latency/served model)
- `arms.json` — driver-produced observations (LLM_ONLY + LLM_TOOLS)
- `native-receipts/` — byte-exact extracted reused receipts (inputs, SHA-bound)
- `recompute-analysis.mjs` + `ANALYSIS.json` — independent recomputation + machine report
- `REVIEW.md` — independent non-Writer Source-First review record
