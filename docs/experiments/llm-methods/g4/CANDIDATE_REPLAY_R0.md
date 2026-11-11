# Issue #11 / G4 candidate replay preflight R0

## Delivered and deliberately not delivered

`packages/runner/js/solution-candidate.mjs` creates a deterministic, content-hash-bound **CANDIDATE** package from JSON-text-only G2 ProblemSpec, Method and exact-version/hash provenance. It re-runs G2 static DAG admission, requires one frozen oracle source and a tool declared in the actual Method, then seals a SHA-256 over the candidate. `inspectCandidateReplay` rechecks the package digest and all provenance dimensions: original source, frozen oracle, model bytes, solver executable, version, platform and evidence receipt. Any change produces `STALE`. Identical metadata produces `REPLAY_BLOCKED_UNQUALIFIED`, **never execution or business PASS**.

This is the smallest G4 preflight that can be tested on the Web while original native execution and independent semantic review remain blocked. It does not duplicate an execution Runtime, ask a model to attest itself, sign a reviewer identity, or serialize sensitive raw source bytes into the package.

## Qualification and trust boundary

- G2 `STRUCTURALLY_VALID` is necessary, not sufficient.
- G3 byte-bound receipts have no host or process attestation and do not establish model fidelity. Thus `BYTES_BOUND_UNATTESTED` is allowed only as provenance metadata and always maps to `UNVERIFIED`.
- The original source hash, oracle hash, model hash, executable hash, version and platform in this preflight are still supplied by a caller. Matching hashes prevent accidental replay drift but **do not prove their origin**.
- User/agent-supplied `REUSABLE`, `QUALIFIED`, `SUPPORTED_WITH_SCOPE`, unknown evidence status and modified package contents are rejected.
- `REPLAY_BLOCKED_UNQUALIFIED` must remain the maximum output until trusted native host/process evidence, independent source-first semantic Oracle and authorized qualification are implemented. This PR does **not** release G4.
- A later G4 qualification stage must require independently verified, immutable source and model lineage, actual solver identity and native result, positive and negative Oracle cases, unknown/error/timeout abstention, bounded scope and revocation on changed inputs/tool ABI. No caller-provided boolean alone may bypass these gates.

## Follow-up critical path

1. Review/integrate PR #22's corrected versioned portable native recorder; its older 34 PASS records remain stale until new offline runs, regardless of green source CI.
2. Execute PR #21's source-frozen 24 SMT queries using exact vetted native Z3/cvc5 with input/output/exit/binary/OS hashes, and independently adjudicate the six source cases.
3. Complete G3 *Solve → Verify* with source ownership, model fidelity, false-PASS, timeouts and unknowns; only then add trusted G4 qualification and execute Replay/Invalidation.
4. Run real paired G5 experiments with LLM-only baseline and publish metrics/limitations; demonstrate a minimal actual G6 DIS/Domain App consumer against a qualified solution.

## Verification

`node --test tests/solution-candidate.test.mjs`, repository full Node tests, `npm run typecheck`, exact-SHA Woodpecker push/PR. No test in this PR invokes a native solver or constitutes formal qualification.
