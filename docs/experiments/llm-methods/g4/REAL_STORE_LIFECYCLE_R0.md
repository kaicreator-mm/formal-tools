# Issue #11 / G4 — real store lifecycle R0 (engineering receipts only)

## Scope

`benchmarks/llm-methods/g4/real-provenance.mjs` builds a G2 Problem/Method/provenance bound to **real committed evidence**: the frozen `benchmarks/llm-methods/r0/spec-fidelity-cases.json` fixture and the G3 dual-solver native receipt `validation/ads24-native-2026-11-13/NATIVE_PAIR.json` — the real z3 5.4.0 `executable_sha256`, the faithful model's six SAT/UNSAT observations, both files hashed in checkout-agnostic git-object (LF) byte form. `benchmarks/llm-methods/g4/real-store-lifecycle.mjs` drives that candidate through the owner-local store and writes a receipt. This is an **engineering receipt, not a Product G4 PASS**: `evidence_gate` stays `BYTES_BOUND_UNATTESTED` and every record keeps `g4_reusable:false`, `replay_allowed:false`, `solution_promotable:false`, `claim_result:UNVERIFIED`.

One binding note: `sealSolutionCandidate` accepts a provenance only when `oracle_sha256` equals the frozen source hash (`solution-candidate.mjs`), so the sealed provenance binds `oracle_sha256 = source_sha256 = fixture_sha256`. The content digest of the `reference_requirements` array itself is exported separately as `ORACLE_CONTENT_SHA256` and recorded in the receipt header for reviewer readback; the same applies to `model_sha256` over the canonical faithful model object.

## Observed real run (2026-11-13)

Controller-executed on a real POSIX host: WSL2 Ubuntu, `linux/x64`, ext4 store, Node `v24.22.3`; run window `2026-11-13T14:55:05.563Z` → `14:55:05.643Z` (UTC, from the receipt). The store directory (basename `g4-store`) was owner-provisioned with `mkdir` before the run — the driver never creates it. Evidence is committed under `validation/g4-real-store-lifecycle-2026-11-13/`:

- `RECEIPT.json` — byte-exact driver receipt, sha256 `22a7104e7483f82b881d53ed5430b391b87e550eb84e0f060991667753f4a332`.
- `README.md` — host facts, phase table, honest limits.

Outcome: `run_status:"PASSED_ENGINEERING_ONLY"`, driver exit 0, candidate `ba06f7e0ebc3ba7d39e4f9adf07561cb9ed2f1304c960e6090d4a64d06746aed` bound to the real G3 `NATIVE_PAIR.json` identities (z3 5.4.0 `executable_sha256`). All 7 phases ok: `persist` (`CANDIDATE_PERSISTED`/`NEW`, stored bytes read back and re-hashed), `re-persist` (`EXISTING`), `inspect` (`REPLAY_BLOCKED_UNQUALIFIED`), `drift` (`STALE`, `changed_fields:["tool_version"]` for z3 5.4.0→5.4.1), `revoke` (`INVALIDATED`/`OPERATOR_REVOKED`), `inspect-after-revoke` (`INVALIDATED`/`EXPLICIT_REVOCATION`), `no-resurrection` (identical bytes still `INVALIDATED`).

Observed store-contract behavior worth recording: the first run attempt on this host **FAILED at `persist`** because the store directory had not been owner-provisioned — the store contract requires a pre-existing absolute local directory and fails closed with a generic `BLOCKED` (receipt `FAILED`, exit 1). The successful run provisions with `mkdir` first:

```sh
mkdir -p "$PWD/g4-store"   # owner-provisioned; the driver never creates it
node benchmarks/llm-methods/g4/real-store-lifecycle.mjs \
  "$PWD/g4-store" \
  receipt-g4.json
# observed: exit 0, run_status PASSED_ENGINEERING_ONLY
```

General failure semantics (unchanged): on a host without directory fsync (win32/NTFS) the store fails closed with zero writes and the driver reports `run_status:"FAILED"` with exit 1 rather than fabricating a lifecycle; any expectation miss writes the receipt with `FAILED`, the actual phase values, and exits non-zero.

## What each phase proves

- `persist` — the real-bound candidate seals as `CANDIDATE` and is published `NEW`; the exact stored bytes read back from disk hash to the recorded `stored_file_sha256` and parse to the same `candidate_sha256`.
- `re-persist` — identical bytes are idempotent (`EXISTING`), never a silent overwrite.
- `inspect` — live matching provenance still yields only `REPLAY_BLOCKED_UNQUALIFIED` (no replay, no promotion).
- `drift` — `tool_version` 5.4.0→5.4.1 yields `STALE` naming `tool_version` in `changed_fields`.
- `revoke` / `inspect-after-revoke` — `OPERATOR_REVOKED` tombstone takes effect and dominates readback (`INVALIDATED`).
- `no-resurrection` — re-persisting the exact same bytes after revocation still returns `INVALIDATED`.

## Honest limits

`G4_REUSABLE=false`. No qualified Solution, Replay, or Host exists: the synthetic oracle is source-authored and not independently audited, the z3 binary supplier and execution process are not independently attested, and faithful-model SAT/UNSAT solver verdicts are not business verdicts on the original claim. The receipt records engineering behavior of the fail-closed store against real evidence digests — nothing more.

## Windows-safe coverage

`tests/real-lifecycle.test.mjs` covers the Windows-safe subset only: builder sealing, real z3 binding, hash stability across invocations, faithful-observation shape, and the `expectPhase` recorder — no store persistence. Store persistence itself is exercised by the observed POSIX run above.
