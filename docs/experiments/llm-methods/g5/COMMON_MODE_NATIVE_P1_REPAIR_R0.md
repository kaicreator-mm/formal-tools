# Issue #11 G5 — repair historical hard-r1 common-mode solver mismatch P1

**Status:** original merged G5 #74 pair-binding safety fix, **engineering only**. This fixes a real logic flaw on the actual main branch, not an improvement in professional Source/Model/Oracle/Host qualification and not a new LLM A/B trial.

## Original defect: two native tools agree but are both wrong

Original main file `benchmarks/llm-methods/g5/hard-paired-run.mjs` Git Blob **`9544d0913b8eae00b10a76084bed4abf6a9052df`** in main `9edcb4c2698ef9733215a8281962268152a7eab9`. Its exported `bindHardNativePair()` asserted frozen source SHA, case ID, case/SMT input SHA, real solver version/executable identity, terminal exit and Z3/CVC5 agreement — **but not the independent expected source-semantic outcome**. Therefore a same-case SAT→UNSAT or UNSAT→SAT mutation to *both* receipts could pass the pair binder and be supplied to the `LLM_TOOLS` arm, even though it contradicted original frozen R1/R2/R3 task facts. This was identified in prior independent PR #74 review [P1 technical finding](https://github.com/kaicreator-mm/formal-tools/issues/11#issuecomment-6860494113).

## Minimal root-cause fix

Within the original G5 source only, reuse the **already existing** source-only finite interpreter `inspectSchedulingSemantics()` from `hard-oracle.mjs` Git Blob **`a7403e4a3b650165ba61f5976f786b4f9ac73217`**. Before returning any tool evidence, recompute **each original frozen case** independently of the SMT query emitter. Require **both** Z3 and cvc5 results to agree **and** equal the finite source-first result. Bind the exact case IDs and 20-case source SHA again. Any mismatch throws; the paired LLM runner aborts *before* injecting misleading tool evidence or starting new network calls. Existing receipt validation, input hashes, timeouts, output/exit constraints, pricing and LLM prompt remain unchanged.

`tests/llm-hard-run.test.mjs` adds positive and negative common-mode disagreement regressions. Both receipts are modified *together* while preserving every other source/exit/tool identity field. One positive source case is forged to UNSAT (false reject); one negative source case is forged to SAT (false PASS). The new binder rejects both while the previous agreement-only binder would have accepted both. It also rejects `prepareHardAB()` in these cases before model API use.

## True existing receipt compatibility; no new solver/LLM calls

The ChatGPT Linux/Node22.16.0 runtime used the already-preserved **original genuine non-root JS native** pair from the earlier evidence ZIP, with per-engine full JSON SHA256:

- Z3 20 observations: `d4d7dfab29d9d4a909752f368878f9b4f3a432679576ba59379a631e81912767` (10 SAT, 10 UNSAT).
- cvc5 20 observations: `6de8167e7c397ceb9e3843ce2fb3d20e26daae0899199c6dd422817d591ce544` (10 SAT, 10 UNSAT).

The **repaired original module** `bindHardNativePair(z3,cvc5)` actually re-ingested these two raw records: **20/20 aligned and source-semantic-matched**; 20 typed receipt digests returned. No actual Z3/cvc5 process was re-executed, no DeepSeek API invoked, and historical 40 real model traces have not been re-scored as a new experiment. Old experiment observations remain historical with existing scope/limitations.

Incremental G5 tests: **6/6 PASS** in actual Node22 container. Context-wide *reconstructed subset* regression (not full exact current main): **299 tests / 298 PASS / 0 FAIL / 1 SKIP** (local snapshot lacks latest #24 `portable-tool-runner.test.mjs`); only final Exact HEAD Woodpecker checks the full current repository. Professional independent Oracle and real source/supplier/Host attestations remain `NOT_QUALIFIED`. `g5_accepted=false`; do not claim formal Source verification or a tool-improves-accuracy result. No edits to #7/#14, #24 generic tools or #4 runtime.
