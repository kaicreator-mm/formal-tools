# Issue #11 / G5 — frozen paired A/B score contract R0

This is a **measurement utility**, not a completed LLM-only vs LLM+Tools trial. The original 6-case D-ADS fixture from `benchmarks/llm-methods/r0/spec-fidelity-cases.json` is the only benchmark source; it is synthetic and its Oracle has not received an independent Domain sign-off.

`benchmarks/llm-methods/g5/score-ab.mjs` exports `frozenABManifest()` and `scoreFrozenPairedAB(baseline_json,augmented_json)`. Both arms must list the same six cases, each bound to its original SHA, with identical model ID/version, prompt template SHA, seed, temperature, max-output budget and protocol ID. The only allowed arm difference is whether allowlisted tools are available. LLM-only cannot cite tools; tool-augmented records must include a typed solver status and scoped receipt SHA; failed/UNKNOWN tool outcomes cannot be claimed PASS.

The metrics report preserves accuracy over all cases and classified cases, false-PASS **on true negatives**, false-reject, UNKNOWN, verification coverage, cost USD, latency milliseconds and token counts, plus both-arm deltas. All metrics are `SCORED_UNATTESTED` and `g5_accepted=false`, including passing synthetic tests, until real paired model API runs and independent raw-trace/cost metering are reviewed.

## To actually exit G5

1. Freeze a real experiment protocol and prompt before seeing outputs. Run the same model/version, sampling settings and token limit in both arms with six **identical original cases**, randomized presentation order if needed but matched by case SHA; tools are the intervention.
2. Persist **real raw model responses**, prompt texts, timestamps, exact model endpoint/revision, token counts, wall-clock durations, source/tool/method SHA, solver stdout/stderr status and per-case cost. Protect sensitive traces in an authorized artifact store; link immutable trace SHA here.
3. Run this scorer on the paired source records; have a distinct Reviewer independently recompute all scores and evaluate semantic Oracle boundaries, contamination, hallucinated claims and evidence of fair tool use. An LLM-only score is never inferred from tool outcomes or fabricated from the synthetic unit-test fixture.
4. Declare G5 qualified only if the protocol, raw traces and applicable Oracle/Tool claims are accepted; `SCORED_UNATTESTED` is not G5 PASS. No expansion of #24/#4; no reopening #7/#14.

`tests/llm-ab-metrics.test.mjs` is a **synthetic** regression of metric math and fail-closed input/fairness validation, not a real LLM experiment.
