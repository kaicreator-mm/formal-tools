# G4 — real store lifecycle receipt (2026-11-13)

Engineering receipt from the first real POSIX execution of
`benchmarks/llm-methods/g4/real-store-lifecycle.mjs` (Issue #11). Controller-run;
this directory only commits the resulting evidence afterwards.

## Host facts (as recorded in the receipt)

- Host: WSL2 Ubuntu, `linux/x64`, ext4 filesystem (directory fsync supported).
- Node: `v24.22.3`.
- Store dir: owner-provisioned with `mkdir` before the run (basename `g4-store`);
  the driver never creates the store directory.
- Run window (UTC, from the receipt): started `2026-11-13T14:55:05.563Z`,
  finished `2026-11-13T14:55:05.643Z`.

## Files

- `RECEIPT.json` — the driver-written receipt, byte-exact as produced on the
  POSIX host. sha256
  `22a7104e7483f82b881d53ed5430b391b87e550eb84e0f060991667753f4a332`.

## Outcome

`run_status: "PASSED_ENGINEERING_ONLY"`, driver exit 0. Candidate
`ba06f7e0ebc3ba7d39e4f9adf07561cb9ed2f1304c960e6090d4a64d06746aed`, bound to the
real G3 `NATIVE_PAIR.json` identities (z3 5.4.0 `executable_sha256`) and the
frozen R0 fixture. All 7 phases ok:

| Phase | Observed |
|---|---|
| persist | `CANDIDATE_PERSISTED`, `record_write: NEW`; stored bytes read back and re-hashed (`stored_file_sha256`) |
| re-persist | `CANDIDATE_PERSISTED`, `record_write: EXISTING` (idempotent, no silent overwrite) |
| inspect | `REPLAY_BLOCKED_UNQUALIFIED` (live candidate still not replayable/promotable) |
| drift | `STALE`, `changed_fields: ["tool_version"]` (z3 5.4.0 → 5.4.1) |
| revoke | `INVALIDATED`, `reason: OPERATOR_REVOKED` |
| inspect-after-revoke | `INVALIDATED`, `reason: EXPLICIT_REVOCATION` |
| no-resurrection | re-persisting identical bytes still `INVALIDATED` |

## Controller run (as executed)

```sh
# store dir owner-provisioned FIRST; the driver never creates it
mkdir -p "$PWD/g4-store"

node benchmarks/llm-methods/g4/real-store-lifecycle.mjs \
  "$PWD/g4-store" \
  receipt-g4.json
# exit 0, run_status PASSED_ENGINEERING_ONLY
```

## Observed store-contract behavior (first attempt failed honestly)

The first run attempt on this host **FAILED at `persist`**: the store directory
had not been owner-provisioned beforehand. The store contract requires a
pre-existing absolute local directory and fails closed with a generic `BLOCKED`
rather than creating or guessing the directory; the driver reported
`run_status: "FAILED"` and exited 1. The documented run above provisions the
directory with `mkdir` first, which is the run that produced `RECEIPT.json`.
This failure was a real observed behavior of the fail-closed store contract,
worth recording — not a driver defect.

## Honest limits

`g4_reusable: false` — this is an engineering receipt, not a Product G4 PASS.
No qualified Solution or Host exists: the synthetic oracle is source-authored
and not independently audited; the z3 binary supplier and execution process are
not independently attested; the faithful model's SAT/UNSAT solver verdicts are
not business verdicts on the original claim. Every record keeps
`replay_allowed: false`, `solution_promotable: false`,
`claim_result: UNVERIFIED`. The receipt records engineering behavior of the
fail-closed store against real evidence digests — nothing more.
