# Independent non-Writer Source-First review — PR #74 at Exact HEAD 50a2e77 (2026-11-14)

Reviewer: R7 session (`FORMAL_TOOLS_I11_G5_HARD_R1_REAL_LLM`), not the Writer of any
PR #74 source file. Base main `12032f1d5a759dca5a1b24eedbefae2dfe01d3e0`.

## Scope reviewed (all 10 PR files)

1. `docs/experiments/llm-methods/g5/HARD_R1_DISCRIMINATOR.md` — freeze semantics, three
   evidence layers, gate responsibilities; consistent with implemented code.
2. `benchmarks/llm-methods/g5/hard-cases-r1.json` — 20 cases, 10 PASS / 10 FAIL,
   authority block `NOT_RUN` markers present.
3. `hard-oracle.mjs` — schema/count/authority validation; independent finite interpreter
   (R3 strict start<end, R1 end≤start + three-color DFS acyclicity, R2 same-resource
   positive-overlap), worklist hash-stable.
4. `hard-native-run.mjs` — G3 pin preflight + post-run binary re-hash, one CLI process
   per engine, env restore in `finally`, temp cleanup, `wx` receipt.
5. `hard-paired-run.mjs` — receipt binding asserts (schema/version/binary SHA/20 obs/
   order/cross-engine agreement), trace-first-then-assert fail-closed, per-call
   served-model identity, `finish_reason=stop`, safe-integer usage, 40-call count
   assert, scorer status assert, no key serialization.
6. `score-ab.mjs` (hard additions) — canonical config key ordering (P2-G5-03 fix),
   bounded numerics, LLM_ONLY cannot cite tool metadata, inconclusive tool status
   forces UNKNOWN, six-case API untouched.
7. `real-paired-run.mjs` (reused) — MODEL/ENDPOINT/CONFIG/pricing/callModel single-shot.
8. `tests/llm-hard-discriminator.test.mjs`, `tests/llm-hard-run.test.mjs` — mock-only;
   negatives cover forged binary SHA, source drift, cross-engine disagreement,
   missing key zero-calls, served-model mismatch abort, config key-order equivalence.
9. `validation/g5-hard-r1-native-2026-11-13/*` — wrapper git blob re-hashed here =
   `d74a27c1c13f497a46fdec151c5f234efc88af2f` (matches #74 closeout claim);
   per-engine extraction SHA matches claimed originals byte-exact.

## Independent checks performed by reviewer (not trusting repo code)

- Own R1/R2/R3 finite checker written from the documented semantics only: agrees with
  all 20 authored labels (10 PASS / 10 FAIL, 0 mismatch). Repo oracle agrees 20/20.
- `prepareHardAB` full binding run against extracted real receipts: PASS.
- Scoped tests: 12/12 pass locally (node v26.13.0).
- Prompt-leak check: template carries only R1/R2/R3 text + TASKS/EDGES/EVIDENCE; no
  expected label; subset-requirement FAIL cases still evaluate all three requirements
  (by design, no leak).
- CI at exact HEAD: Woodpecker push #591 / PR #592 SUCCESS (GitHub checks API).

## Verdict

**P0=0, P1=0. Scoped engineering source admission: PASS** (engineering benchmark scope;
semantic Oracle qualification explicitly out of scope). Remaining non-blocking notes
(P2, recorded): driver has no in-process cost cap (enforced externally in the real run
with a pre-declared $0.50 cap + watchdog); bounded-integer interpretation (|v|≤1e6) is
a documented interpretation, not an Owner-certified semantics.

This admission authorized the real 40-call run recorded in this directory per the PR's
declared gate order. Native 20×2 was NOT re-run (committed receipts reused, verified).
