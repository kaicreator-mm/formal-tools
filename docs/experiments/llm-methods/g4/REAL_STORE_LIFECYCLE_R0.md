# Issue #11 / G4 — real store lifecycle R0 (engineering receipts only)

## Scope

`benchmarks/llm-methods/g4/real-provenance.mjs` builds a G2 Problem/Method/provenance bound to **real committed evidence**: the frozen `benchmarks/llm-methods/r0/spec-fidelity-cases.json` fixture and the G3 dual-solver native receipt `validation/ads24-native-2026-11-13/NATIVE_PAIR.json` — the real z3 5.4.0 `executable_sha256`, the faithful model's six SAT/UNSAT observations, both files hashed in checkout-agnostic git-object (LF) byte form. `benchmarks/llm-methods/g4/real-store-lifecycle.mjs` drives that candidate through the owner-local store and writes a receipt. This is an **engineering receipt, not a Product G4 PASS**: `evidence_gate` stays `BYTES_BOUND_UNATTESTED` and every record keeps `g4_reusable:false`, `replay_allowed:false`, `solution_promotable:false`, `claim_result:UNVERIFIED`.

One binding note: `sealSolutionCandidate` accepts a provenance only when `oracle_sha256` equals the frozen source hash (`solution-candidate.mjs`), so the sealed provenance binds `oracle_sha256 = source_sha256 = fixture_sha256`. The content digest of the `reference_requirements` array itself is exported separately as `ORACLE_CONTENT_SHA256` and recorded in the receipt header for reviewer readback; the same applies to `model_sha256` over the canonical faithful model object.

## How to run (POSIX host, controller-executed)

```sh
install -d -m 700 /tmp/ft-g4-real-store
node benchmarks/llm-methods/g4/real-store-lifecycle.mjs \
  /tmp/ft-g4-real-store \
  validation/g4-real-store-lifecycle-2026-11-13/RECEIPT.json
```

The driver never creates the store directory; the owner provisions it. On a host without directory fsync (win32/NTFS) the store fails closed with zero writes and the driver reports `run_status:"FAILED"` with exit 1 rather than fabricating a lifecycle. Success is `run_status:"PASSED_ENGINEERING_ONLY"`, exit 0. Any expectation miss writes the receipt with `FAILED`, the actual phase values, and exits non-zero.

## What each phase proves

- `persist` — the real-bound candidate seals as `CANDIDATE` and is published `NEW`; the exact stored bytes read back from disk hash to the recorded `stored_file_sha256` and parse to the same `candidate_sha256`.
- `re-persist` — identical bytes are idempotent (`EXISTING`), never a silent overwrite.
- `inspect` — live matching provenance still yields only `REPLAY_BLOCKED_UNQUALIFIED` (no replay, no promotion).
- `drift` — `tool_version` 5.4.0→5.4.1 yields `STALE` naming `tool_version` in `changed_fields`.
- `revoke` / `inspect-after-revoke` — `OPERATOR_REVOKED` tombstone takes effect and dominates readback (`INVALIDATED`).
- `no-resurrection` — re-persisting the exact same bytes after revocation still returns `INVALIDATED`.

## Honest limits

`G4_REUSABLE=false`. No qualified Solution, Replay, or Host exists: the synthetic oracle is source-authored and not independently audited, the z3 binary supplier and execution process are not independently attested, and faithful-model SAT/UNSAT solver verdicts are not business verdicts on the original claim. The receipt records engineering behavior of the fail-closed store against real evidence digests — nothing more.

## Receipt custody

The receipt is produced by a controller run on a POSIX host and committed afterwards to the placeholder path `validation/g4-real-store-lifecycle-2026-11-13/RECEIPT.json` (not created by this change). `tests/real-lifecycle.test.mjs` covers the Windows-safe subset only: builder sealing, real z3 binding, hash stability across invocations, faithful-observation shape, and the `expectPhase` recorder — no store persistence.
