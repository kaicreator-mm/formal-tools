# Issue #11 / G4 — persistent candidate and fail-closed replay R1

## Engineering deliverable (not Product G4 PASS)

PR #23 shipped in-memory `CANDIDATE` envelopes. This change adds `packages/runner/js/solution-store.mjs`: an owner-provisioned **absolute, local directory**, content-addressed `candidate-<SHA>.json`, exclusive create-only storage, exact readback/integrity check, version/provenance drift rejection, and a non-overwritable revocation tombstone.

Public functions: `persistSolutionCandidate`, `inspectStoredReplay`, `revokeStoredCandidate`. The store accepts original G2 Problem/Method/provenance JSON text, calls `sealSolutionCandidate` and `inspectCandidateReplay`, and never accepts LLM/self-attested `QUALIFIED` or `SUPPORTED_WITH_SCOPE`. All statuses preserve `replay_allowed=false`, `solution_promotable=false`, `claim_result=UNVERIFIED`. Matching live provenance returns `REPLAY_BLOCKED_UNQUALIFIED`, drift returns `STALE`, and tombstone returns `INVALIDATED`. Read/mutation errors return `BLOCKED`.

The store saves **only metadata and content hashes**, not raw private sources or executable commands. A local owner must provision the store directory with appropriate permissions. The API is not an MCP endpoint or a multi-tenant service; it does not provide Host identities, process isolation, cryptographic witness authority, or a signed semantic Oracle. Manual tampering with the filesystem is rejected on readback, but the host itself is not independently attested.

## Acceptance scope and negatives

`tests/solution-store.test.mjs` covers original G2 candidate sealer integration, durable readback, idempotent same-bytes write, source/provenance drift, explicit revocation and non-resurrection, evidence status forged as PASS, stored `REUSABLE` tampering, overwrite refusal, malformed SHA/traversal, and fail-closed status. Unit tests are **synthetic** and cannot themselves qualify a business Solution.

The existing Z3/cvc5 24×2 true native receipts from PR #62 are reusable as scoped G3 evidence, **not** this G4 project's independent source/model/oracle/host/tool qualification. Do not count this component as a real qualified Solution or successful executable Replay.

## Remaining G4 gate

To permit `REUSABLE` and actual Replay, a distinct qualification stage must validate immutable original Source and Model, independently qualified semantic Oracle with original R1–R3 positive/negative and UNKNOWN/ERROR/TIMEOUT evidence, trusted tool/platform/version/ABI identity, native execution receipts, revocation lineage, authorised acceptance and fresh exact-SHA review. A compatible consumer must reject stale evidence and carry typed outcome and scope; a caller-provided boolean or synthetic test-only credential is never sufficient.

G5 requires honest LLM-only vs LLM+Tools observations under a frozen workload, and G6 a real DIS/Domain App consumer after G4 qualification. Keep these BLOCKED where not independently demonstrated. The new source path does not change tool portfolio #24, CLI/MCP/SDK #4 or historical closed #7/#14.
