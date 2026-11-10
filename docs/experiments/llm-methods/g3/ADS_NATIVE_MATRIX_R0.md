# D-ADS / G3 R0 — Source-first native SMT case matrix

**Authority:** [Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11). This is a narrow **replay preparation** on a new independent branch; it does not touch PR #18 or PR #20, and does not change Issue #7.

## Why

The frozen Research R0 example in `benchmarks/llm-methods/r0/spec-fidelity-cases.json` has six source cases with pre-authored reference outcomes and four candidate specifications (faithful, missing constraint, overstrong constraint, vacuous contradiction). This stage translates **candidate constraints and each case's fixed facts** into SMT-LIB QF_LIA for Z3. The source case's `expected` verdict is **not fed to the solver**.

`benchmarks/llm-methods/g3/ads-native-matrix.mjs` exports:
- `renderAdsQuery(case,model)`: declares time variables fixed to each source case; encodes finite-window, directed dependency acyclicity via integer ranking, temporal precedence, same-resource writer nonoverlap and optional global nonoverlap; emits `(check-sat)`.
- `generateAdsMatrix()`: deterministic 6 cases × 4 candidate models = **24 queries** with per-input SHA256, tool `z3`, typed `solve` operation, `NOT_RUN` execution.
- `scoreAdsMatrix(matrix,nativeResults)`: compares **provided native statuses** SAT/UNSAT against frozen case outcomes; tracks per-model false-PASS, false-reject, vacuous, and `INCONCLUSIVE` for UNKNOWN/TIMEOUT/ERROR/missing results. The score is `SCORED_UNATTESTED` and `original_claim_verdict=UNVERIFIED` even with 24/24 synthetically matching cases.
- `emitAdsMatrix(outputDirectory)`: writes 24 versioned-query .smt2 files plus manifest for an existing **trusted local native Runner** to consume. Generating queries does NOT spawn Z3.

### Minimal host usage (local agent only)

After source-review admission and on a trusted host that already has a vetted Z3 executable, the Agent may run `node benchmarks/llm-methods/g3/ads-native-matrix.mjs <OUTPUT_DIRECTORY>`, then invoke existing `planNative("z3","solve",...)` and `executeNativePlan` on each generated input, with strict timeout and byte-hash receipts. No arbitrary shell command supplied by LLM. Persist complete stdout/stderr, executable identity/version SHA, input SHA and status per query, distinguish host errors from logical UNSAT, and compare results with frozen reference cases. Record both **model-internal solver outcomes** and **source-first case fidelity**. Do not infer a general proof from six scenarios.

### Expected semantics (hypotheses, NOT native results)

- A faithful model should classify source-positive examples as SAT, source-negative examples as UNSAT.
- Weak model lacking writer mutual exclusion should admit a same-resource overlapping counterexample.
- Overstrong global exclusion should reject valid concurrency between writers on different resources.
- Vacuous always-false model should reject every input, including valid positives.
- `UNKNOWN`, solver crash, timeout, unavailable engine or a missing binary are not failures to be relabeled UNSAT or PASS.

The frozen source verdicts have **not yet received independent source-first semantic approval as business truth**. These examples are synthetically authored and cannot replace a domain-owner/independent Oracle.

### Acceptance and boundaries

`tests/ads-native-matrix.test.mjs` contains 12 source/SMT/result-classification cases. Test doubles feed manufactured native outcomes to the scorer; they are **not** Z3 runs.

Require final exact-SHA Woodpecker Node, TypeScript and CLI gates; an independent reviewer checks that SMT encoding matches the source language (especially edge-direction, resource equality, non-vacuity and the difference between SAT and original Claim truth). No G3 complete, G4 Solution qualification, or LLM-vs-tool improvement claim follows from CI alone.

**Dependency note:** PR #18 Z3 evidence currently remains candidate for native supply-chain review, and PR #20 byte-bound API has not received distinct independent reviewer clearance. This matrix may advance independently without changing those facts. Existing local Agent should only perform the incremental real Z3 calls when the responsible gate authorizes them.
