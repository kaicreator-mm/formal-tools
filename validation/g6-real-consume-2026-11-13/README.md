# G6 — real consumption/invalidation propagation receipt (2026-11-13)

Engineering receipt from the first real POSIX execution of
`benchmarks/llm-methods/g6/real-consume-propagation.mjs` (Issue #11).
Controller-run; this directory only commits the resulting evidence afterwards.

## Host facts (as recorded in the receipt)

- Host: WSL2 Ubuntu, `linux/x64`, ext4 filesystem (directory fsync supported).
- Node: `v24.22.3`.
- Store dir: owner-provisioned with `mkdir` before the run (basename `g6-store`),
  distinct from the G4 store dir; the driver never creates the store directory.
- Run window (UTC, from the receipt): started `2026-11-13T14:55:05.776Z`,
  finished `2026-11-13T14:55:05.826Z`.

## Files

- `RECEIPT.json` — the driver-written receipt, byte-exact as produced on the
  POSIX host. sha256
  `8a9d6e26688c5772d8bc1917fa4cd90469fa9f34e35d6bc0c482c2121311574b`.
- `DIS_BOUNDED_DEMO_RUN.log` — byte-exact copy of the controller-captured log
  of the real G4+G6 run (node banner, both driver exit codes, per-receipt phase
  summaries). sha256
  `8bdfba04d5ae00d00fe16b2accfcbdbe6ca15dd8136e7e86ab20eaccedbed125`.

## Outcome

`run_status: "PASSED_ENGINEERING_ONLY"`, driver exit 0. Candidate
`ba06f7e0ebc3ba7d39e4f9adf07561cb9ed2f1304c960e6090d4a64d06746aed` (same
real-bound candidate as the G4 lifecycle run). All 4 phases ok:

| Phase | Observed |
|---|---|
| seal+persist | `CANDIDATE_PERSISTED`, `record_write: NEW` |
| consumer-preflight-pre-revoke | no-authority refusal envelope `REPLAY_BLOCKED_UNQUALIFIED` (`kind: UNKNOWN`, `authority: NONE`, `effect_dispatched: false`, `host_invocations: 0`) |
| revoke | `INVALIDATED`, `reason: OPERATOR_REVOKED` |
| consumer-reinspect-post-revoke | store re-inspected BEFORE any consumer re-evaluation → `INVALIDATED` / `EXPLICIT_REVOCATION`; same candidate bytes refused again by the consumer envelope |

Final sweep: every recorded `formal-tools/dis-v020-preflight/0.1` envelope has
`host_invocations: 0` and `effect_dispatched: false` — invalidation propagated
to the consumer path before any dispatch could occur.

## Real DIS host context (embedded in the receipt)

The controller supplied the real bounded DIS demo log digest via
`DIS_REAL_RUN_LOG_SHA256`, so the receipt carries `real_dis_host_context`:

- Consumer reference: `kaicreator-mm/domain-harness` PR #1497, source head
  `f21514deb0a4b5b4b2d6e3dae2cd5e8ec2f71120`, example
  `examples/dis-v020-native-sdk/bounded-engineering-demo.mjs`, example blob
  `e44e2be5b66ad9e6b8961c4ec2cfdedadc0467c9`, target `linux/x64/node`, contract
  `dis.v0.2`.
- Real bounded demo log sha256
  `c56f2f9398cb7daf62b0f081f708defc5ac365d32bbdc52ff3738092ea4fb4e5`
  (`bounded_demo_log_sha256`; the demo log itself is held controller-side, its
  digest is what binds here).
- Demo run facts: real SDK load READY; `KDP_RECEIPT` with `authority=KDP`
  admitted **engineering-only** from the pinned domain-harness demo,
  `effectExecutionProven=false`.

## Controller run (as executed)

```sh
# store dir owner-provisioned FIRST; the driver never creates it
mkdir -p "$PWD/g6-store"

DIS_REAL_RUN_LOG_SHA256=c56f2f9398cb7daf62b0f081f708defc5ac365d32bbdc52ff3738092ea4fb4e5 \
node benchmarks/llm-methods/g6/real-consume-propagation.mjs \
  "$PWD/g6-store" \
  receipt-g6.json
# exit 0, run_status PASSED_ENGINEERING_ONLY, g6_accepted false
```

## Honest limits

`g6_accepted: false` — this is an engineering receipt, not a Product G6 PASS and
not a DIS consumption acceptance. No qualified Solution or Host exists; the DIS
side is a typed refusal envelope, not a second DIS Runtime or an E2E proof; the
synthetic oracle is source-authored and not independently audited; the faithful
model's SAT/UNSAT solver verdicts are not business verdicts on the original
claim. Every envelope keeps `replay_allowed: false`,
`solution_promotable: false`, `claim_result: UNVERIFIED`. The receipt
demonstrates fail-closed propagation of revocation into the consumer path
against real evidence digests — nothing more.
