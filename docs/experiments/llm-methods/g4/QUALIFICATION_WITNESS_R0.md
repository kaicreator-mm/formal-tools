# Issue #11 G4 — bounded signed-qualification readiness (R13)

**Status:** real cryptographic verification and persisted-candidate/stale/revoked refusal, **NOT** qualified Solution, authorized Replay, Product/Source Owner/Oracle/Host admission, or DIS SDK/KDP/Host execution. The existing runtime remains the only G4 candidate store; no second executor or persistence store is introduced.

## Missing original authority, now explicit in code

There is currently **no Product-approved Source Owner, independent semantic Oracle or trusted Host public signing anchor**. The production registry `registry/G4_QUALIFICATION_ANCHORS.json` deliberately declares `status=NOT_CONFIGURED` and `anchors=[]`. Ordinary users, LLMs or HTTP callers cannot pass their own verification keys to the production function `inspectQualificationPreflight`. Thus a real persisted candidate still returns `BLOCKED` and never `replay_allowed=true`.

The new `packages/runner/js/qualification-witness.mjs` performs the future contract's **cryptographic portion**, without conflating it with professional authority. Three **distinct** Ed25519 signers are required: `SOURCE_OWNER`, `INDEPENDENT_ORACLE` and `TRUSTED_HOST`, each with a separately versioned key, exact allowed scope, role-specific signature over canonical `{role,subject}`, and a valid time window. Signed subject fields bind:

- Exact G4 candidate, `problem_sha256`, `method_sha256`, original `source_id/source_sha256`, original `oracle_id/oracle_sha256`, original `model_sha256`, tool identity/version/binary SHA256, native evidence SHA256.
- A bounded `claim_ref`, intended Product scope, `valid_from_ms` and `valid_until_ms`.
- No caller-provided roots, executable path, state override, `approved:true`, Product/Host role claim, or unpinned tool version is accepted as authority.

The gate first asks the **existing** `inspectStoredReplay()` to check durable content-addressed G4 candidate bytes, tool/source/model/provenance drift, and permanent revocation tombstones; it then confirms caller-provided sealed candidate bytes match the exact already-inspected persistent fingerprint. Only after those checks does it parse the versioned approved-root registry and verify signatures. This is a **preflight**, not an atomic execution permit: a future real Host must recheck current G4 state, credential validity, expiration and revocation at the exact consumption boundary. A previously checked signature or G4 inspection is never permission for Effect dispatch.

For test coverage, the pure `inspectWitnessCrypto()` accepts *explicitly synthetic, ephemeral test public keys* and can return `CRYPTOGRAPHICALLY_BOUND_UNQUALIFIED` with `replay_allowed=false`, `qualified_solution=false`, `claim_result=UNVERIFIED`. Its caller-supplied test anchors **cannot be passed to** `inspectQualificationPreflight`, which always reads the installed empty Product registry. The test-only valid crypto result is not a Product approval or separate professional Oracle; it verifies the protocol implementation only.

## Actual engineering verification

The Node22 current-container `tests/qualified-witness.test.mjs` suite covers:

1. Three actually generated Ed25519 test keypairs, three role-separated signatures, and all bindings; correct signatures verify **without** promoting Replay.
2. Source Owner signature forgery, duplicate role, reused signer public key, unknown key ID.
3. Candidate/source/oracle/model/tool/evidence drift; expired and premature credentials.
4. Actual POSIX persisted original G4 candidate + missing Product trust anchors: `BLOCKED`.
5. Original G4 tool-version drift: `STALE`; durable revocation tombstone: `BLOCKED/G4_STORE_INVALIDATED`.
6. Malformed JSON, missing resources, caller-chosen trust key denial.

**New focused results:** 7/7 PASS. **Node22 historical reconstruction subset:** 306 total, 305 PASS/0 FAIL/1 SKIP; this is not the current complete monorepo or Node24 CI. All provenance/Host identity claims remain bounded to their actual source and environment. Exact HEAD Woodpecker and non-Writer Source-First review remain required before limited engineering integration.

## Shortest actual positive path

1. Legitimate original Product/Source Owner selects one bounded original claim and independent Oracle positive+negative cases, scope, source/model/tool/evidence and rights/version/expiry; distinct Oracle and trusted Host establish real keys and attestations through existing ADS/Product process. An arbitrary GitHub Writer's new root key is **not** itself sufficient original Product authorization.
2. After independent review of the approved trust roots and original signed evidence, implement the **separate final professional admission/authorization step**. Do not change this preflight's `replay_allowed=false` semantics by flipping literals. The final Host must enforce currentness, tamper/revocation and one-time or repeatable-use policy at execution time, safely with concurrent revoke.
3. Wire the actually authorized replay through existing real DIS v0.2 AOT→SDK/KDP→signed Host, preserve refusal/STALE/INVALIDATED/effect-denied tests. This R13 PR **does not** execute the DIS Host or implement authorized replay; #11 remains OPEN and Full G3/G4/G5/G6 stays blocked.

This scope does not modify closed #7/#14 or #24/#4 general 36-tool Runtime work. No Z3/cvc5 or DeepSeek reruns are required.
