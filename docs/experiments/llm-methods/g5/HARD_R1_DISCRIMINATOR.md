# Issue #11 / G5 hard-r1 — source-frozen discriminating paired experiment

**Scope:** engineering benchmark and executable-run preparation only, NOT qualified Product/Oracle/Solution/Replay/G6.

## Why this suite exists

Real DeepSeek v2 frozen six-case experiment (validation/llm-ab-real-2026-11-13/) achieved 6/6 in BOTH arms, zero false-PASS, approximately 37% greater tool cost. This is a **ceiling effect**, neither tool superiority nor tool futility. Original G3 native 24×Z3 + 24×cvc5 receipts remain valid only for the earlier frozen six cases.

New hard-r1 source was frozen BEFORE new solver/model execution. It has 20 **different** synthetic ADS R1/R2/R3 scenarios: 10 PASS, 10 FAIL. Stressors include eight interleaved writers, case-sensitive resource IDs, negative/high timestamps, adjacency, fork/join, off-by-one collisions, a hidden race, three-cycle, self-loop, inverted/zero windows and predecessor misordering.

Bounded semantics: signed integer endpoints, end-exclusive intervals; A->B requires A.end <= B.start, resources compared exactly. This is a documented *interpretation* of the original Product, not an original professional ADS Owner or independently qualified semantic Oracle. Ambiguous cases must stay UNKNOWN until qualified by their Owner. Do not alter expected labels after seeing experimental outputs.

## Three strict, separate evidence layers

1. **Source-only finite checker:** hard-oracle.mjs independently checks the authored R1–R3 case labels using graph DFS, pairwise resource overlaps and interval guards, without reusing SMT clauses. Metamorphic regressions cover boundaries. Neither semantic review nor real native evidence is inferred.
2. **Real original typed Z3/cvc5 host run, not yet executed:** hard-native-run.mjs only accepts the SHA-pinned G3 original z3 5.4.0 and cvc5 1.4.2 executables; reuses existing planNative/executeNativePlan for exactly 20 faithful queries per solver. Requires explicit binary root and one standalone CLI process per engine (never a concurrent MCP/SDK shared-global environment). Outputs non-overwriting, input-hash-bound self-reported receipt files; no professional Tool/Host certificate is invented.
3. **Real paired model trial, not yet executed:** hard-paired-run.mjs requires BOTH 20-query native receipts with identical case IDs, SHA, and agreement; requires a real DEEPSEEK_API_KEY, otherwise ZERO network calls. Uses the same frozen DeepSeek model/template/sampling as real G5 v2, with only the EVIDENCE slot changed. 40 calls = 20 per arm, no retries, max 4096 completion tokens. Incomplete/truncated/unmetered calls BLOCK rather than count as accuracy. Raw request/response/usage/latency/served model trace stored; protocol written before first call; no secret serialized.

The added scoreHardPairedAB counts accurate/false-PASS/UNKNOWN/coverage/cost/latency/tokens against the separate hard-r1 source. Original six-case scoreFrozenPairedAB remains available and its old real traces are untouched. Also fixes prior reviewer P2-G5-03: semantically equivalent config objects now compare by defined key order rather than caller property insertion order. All source/mock reports say SCORED_UNATTESTED and g5_accepted=false.

## Formal Gate responsibilities

- **Before execution:** independent Source-First review the 20 authored labels, R1–R3 interpretation, pre-frozen source bytes, QF_LIA queries, tool SHA and protocol fairness. Freeze PR Exact SHA. Verify local cost policy and native executable availability.
- **During execution:** run actual SHA-pinned native tools on a provisioned Host (non-root and bounded process resources) and the paired DeepSeek API with credentials from environment only. Record actual process exit, output hashes, versions, host, source, raw traces and costs. Never cite synthetic test stubs as actual results.
- **After execution:** independent reviewer recomputes all actual trace hashes and scores, checks protocol/source/model/Tool/Host version and real endpoint responses, and adjudicates the actual original business Oracle ownership. Cases that fail independent semantics remain UNKNOWN. Never combine statistics from the incomparable six-case and twenty-case cohorts.

**Current status:** source/test/driver only; native hard-r1 20×2 and real model 40 calls are NOT_RUN; no qualified original business Oracle, reusable G4 Solution, or successful G6 Host/Solution consumption. No second Runtime, no original 36-tool scope changes, no modifications to closed #7/#14.
