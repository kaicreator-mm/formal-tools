# Issue #11 / G6 — real consumption/invalidation propagation R0 (engineering receipts only)

## Scope

`benchmarks/llm-methods/g6/real-consume-propagation.mjs` drives the real-bound G4 candidate (shared builder, `benchmarks/llm-methods/g4/real-provenance.mjs`) through the DIS v0.2.0 consumer preflight around a revocation, proving that invalidation propagates to the consumer path **before any dispatch could occur**. The consumer is the pinned `inspectDisV020Consumption` envelope (`dis-v020-consumer-preflight.mjs`), referencing domain-harness PR #1497 HEAD `f21514deb0a4b5b4b2d6e3dae2cd5e8ec2f71120`, example blob `e44e2be5b66ad9e6b8961c4ec2cfdedadc0467c9`, target `linux/x64/node`. Every envelope must be `kind:UNKNOWN`, `authority:NONE`, `effect_dispatched:false`, `host_invocations:0`, `g6_accepted:false` — this change cannot and does not accept a DIS consumption.

## How to run (POSIX host, controller-executed)

```sh
install -d -m 700 /tmp/ft-g6-real-store
node benchmarks/llm-methods/g6/real-consume-propagation.mjs \
  /tmp/ft-g6-real-store \
  validation/g6-real-consume-2026-11-13/RECEIPT.json
```

Use a store directory of its own; reusing the G4 run's directory is handled honestly (a prior tombstone makes `seal+persist` return `INVALIDATED`, which fails the phase instead of being hidden). Same failure semantics as the G4 driver: expectation miss → receipt with `run_status:"FAILED"` plus actual values, exit non-zero; success → `PASSED_ENGINEERING_ONLY`, exit 0.

When the controller holds the real bounded DIS demo log, it passes its digest as `DIS_REAL_RUN_LOG_SHA256` (64-hex). The driver then embeds `real_dis_host_context` (`bounded_demo_log_sha256`, target, pinned `source_head`/`example_blob`, and the engineering-only `kdp_receipt` note with `effectExecutionProven=false`); when the variable is absent the field is omitted entirely.

## What each phase proves

- `seal+persist` — the real-bound candidate persists as `CANDIDATE_PERSISTED`, honestly reported `NEW` or `EXISTING`.
- `consumer-preflight-pre-revoke` — the live candidate still receives only the no-authority refusal envelope (`REPLAY_BLOCKED_UNQUALIFIED`, `UNKNOWN`/`NONE`, zero effects, zero host invocations).
- `revoke` — `OPERATOR_REVOKED` tombstone lands (`INVALIDATED`).
- `consumer-reinspect-post-revoke` — the store-level `INVALIDATED` is observed via `inspectStoredReplay` first, then the same candidate bytes are refused again by the consumer envelope; a final sweep asserts every recorded envelope has `host_invocations:0` and `effect_dispatched:false`.

## Honest limits

`g6_accepted:false` always. No qualified Solution/Replay/Host exists; the DIS side is a typed refusal envelope, not a second DIS Runtime or an E2E proof; the synthetic oracle is not independently audited; faithful SAT/UNSAT observations are not business verdicts. The receipt demonstrates fail-closed propagation of revocation into the consumer path against real evidence digests — nothing more.

## Receipt custody

The receipt is produced by a controller run on a POSIX host and committed afterwards to the placeholder path `validation/g6-real-consume-2026-11-13/RECEIPT.json` (not created by this change). The Windows-safe unit coverage lives in `tests/real-lifecycle.test.mjs` (no store persistence, no POSIX assumptions).
