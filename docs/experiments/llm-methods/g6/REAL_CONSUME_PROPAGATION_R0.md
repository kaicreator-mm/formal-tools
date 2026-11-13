# Issue #11 / G6 — real consumption/invalidation propagation R0 (engineering receipts only)

## Scope

`benchmarks/llm-methods/g6/real-consume-propagation.mjs` drives the real-bound G4 candidate (shared builder, `benchmarks/llm-methods/g4/real-provenance.mjs`) through the DIS v0.2.0 consumer preflight around a revocation, proving that invalidation propagates to the consumer path **before any dispatch could occur**. The consumer is the pinned `inspectDisV020Consumption` envelope (`dis-v020-consumer-preflight.mjs`), referencing domain-harness PR #1497 HEAD `f21514deb0a4b5b4b2d6e3dae2cd5e8ec2f71120`, example blob `e44e2be5b66ad9e6b8961c4ec2cfdedadc0467c9`, target `linux/x64/node`. Every envelope must be `kind:UNKNOWN`, `authority:NONE`, `effect_dispatched:false`, `host_invocations:0`, `g6_accepted:false` — this change cannot and does not accept a DIS consumption.

## Observed real run (2026-11-13)

Controller-executed on a real POSIX host: WSL2 Ubuntu, `linux/x64`, ext4 store, Node `v24.22.3`; run window `2026-11-13T14:55:05.776Z` → `14:55:05.826Z` (UTC, from the receipt). The store directory (basename `g6-store`, distinct from the G4 run's) was owner-provisioned with `mkdir` before the run — the driver never creates it. Evidence is committed under `validation/g6-real-consume-2026-11-13/`:

- `RECEIPT.json` — byte-exact driver receipt, sha256 `8a9d6e26688c5772d8bc1917fa4cd90469fa9f34e35d6bc0c482c2121311574b`.
- `DIS_BOUNDED_DEMO_RUN.log` — controller-captured log of the real G4+G6 run, sha256 `8bdfba04d5ae00d00fe16b2accfcbdbe6ca15dd8136e7e86ab20eaccedbed125`.
- `README.md` — host facts, phase table, honest limits.

Outcome: `run_status:"PASSED_ENGINEERING_ONLY"`, driver exit 0, candidate `ba06f7e0ebc3ba7d39e4f9adf07561cb9ed2f1304c960e6090d4a64d06746aed` (the same real-bound candidate as the G4 lifecycle run). All 4 phases ok: `seal+persist` (`CANDIDATE_PERSISTED`/`NEW`), `consumer-preflight-pre-revoke` (no-authority refusal envelope `REPLAY_BLOCKED_UNQUALIFIED`), `revoke` (`INVALIDATED`/`OPERATOR_REVOKED`), `consumer-reinspect-post-revoke` (store `INVALIDATED`/`EXPLICIT_REVOCATION` observed first, same bytes refused again).

DIS demo context — the controller held the real bounded DIS demo log and passed its digest as `DIS_REAL_RUN_LOG_SHA256`, so the receipt embeds `real_dis_host_context`: pinned consumer `kaicreator-mm/domain-harness` PR #1497 source head `f21514deb0a4b5b4b2d6e3dae2cd5e8ec2f71120`, example `examples/dis-v020-native-sdk/bounded-engineering-demo.mjs` blob `e44e2be5b66ad9e6b8961c4ec2cfdedadc0467c9`, target `linux/x64/node`, contract `dis.v0.2`; real bounded demo log sha256 `c56f2f9398cb7daf62b0f081f708defc5ac365d32bbdc52ff3738092ea4fb4e5` (`bounded_demo_log_sha256`); demo facts: real SDK load READY and `KDP_RECEIPT` `authority=KDP` admitted **engineering-only** from the pinned domain-harness demo, `effectExecutionProven=false`.

Propagation statement: after the `OPERATOR_REVOKED` revocation, the consumer path re-inspects the store **BEFORE any dispatch** and obtains `INVALIDATED` (`EXPLICIT_REVOCATION`); the same candidate bytes are then refused again by the consumer envelope, and every recorded `formal-tools/dis-v020-preflight/0.1` envelope has `host_invocations:0` and `effect_dispatched:false`.

```sh
mkdir -p "$PWD/g6-store"   # owner-provisioned; the driver never creates it
DIS_REAL_RUN_LOG_SHA256=c56f2f9398cb7daf62b0f081f708defc5ac365d32bbdc52ff3738092ea4fb4e5 \
node benchmarks/llm-methods/g6/real-consume-propagation.mjs \
  "$PWD/g6-store" \
  receipt-g6.json
# observed: exit 0, run_status PASSED_ENGINEERING_ONLY, g6_accepted false
```

General semantics (unchanged): use a store directory of its own — reusing the G4 run's directory is handled honestly (a prior tombstone makes `seal+persist` return `INVALIDATED`, which fails the phase instead of being hidden); expectation miss → receipt with `run_status:"FAILED"` plus actual values, exit non-zero; when `DIS_REAL_RUN_LOG_SHA256` is absent the `real_dis_host_context` field is omitted entirely, and a malformed value fails the run.

## What each phase proves

- `seal+persist` — the real-bound candidate persists as `CANDIDATE_PERSISTED`, honestly reported `NEW` or `EXISTING`.
- `consumer-preflight-pre-revoke` — the live candidate still receives only the no-authority refusal envelope (`REPLAY_BLOCKED_UNQUALIFIED`, `UNKNOWN`/`NONE`, zero effects, zero host invocations).
- `revoke` — `OPERATOR_REVOKED` tombstone lands (`INVALIDATED`).
- `consumer-reinspect-post-revoke` — the store-level `INVALIDATED` is observed via `inspectStoredReplay` first, then the same candidate bytes are refused again by the consumer envelope; a final sweep asserts every recorded envelope has `host_invocations:0` and `effect_dispatched:false`.

## Honest limits

`g6_accepted:false` always. No qualified Solution/Replay/Host exists; the DIS side is a typed refusal envelope, not a second DIS Runtime or an E2E proof; the synthetic oracle is not independently audited; faithful SAT/UNSAT observations are not business verdicts. The receipt demonstrates fail-closed propagation of revocation into the consumer path against real evidence digests — nothing more.

## Windows-safe coverage

The Windows-safe unit coverage lives in `tests/real-lifecycle.test.mjs` (no store persistence, no POSIX assumptions); store persistence and the POSIX run itself are covered by the observed real run above.
