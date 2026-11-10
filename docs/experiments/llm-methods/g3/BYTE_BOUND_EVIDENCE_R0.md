# Issue #11 — G3 Byte-Bound Evidence Preflight R0

**Authority:** [Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11) · **Branch seed:** `main@74130272c114c2ff4266b9caec7b5603d7a19a6f` (accepted G2 PR #13, G3 static gate PR #15 + security repair PR #19). **Status:** source implementation, not native execution or business-claim verification.

## Why this is needed

G2 `assessMethod` validates a Method DAG but does not execute it. G3 `inspectEvidenceBundle` validates *caller-declared* SHA links but has no access to the bytes those SHA strings supposedly identify. Neither may promote `LINKED_UNVERIFIED` to a verified answer. This component closes **one narrower gap**: it independently computes SHA-256 over **provided** exact source, SMT/model, tool binary, invocation and output byte buffers and compares them to the existing G2/G3 metadata.

## Integration

`packages/runner/js/byte-evidence.mjs` exports `inspectByteBoundClaim({problem,method,claim_id,source_id,bundle,artifacts})`.

- Re-run accepted G2 **structural** Method validation. Candidates not native-adapted remain blocked. Method's own digest, goal Claim, tool ID, typed operation, direct/ancestor source chain, original permission policy and G3 required receipt-step closure must match.
- G3 static evidence gate must accept the receipt schema and deny forged status/prototype methods *before* this module follows its step IDs.
- **Independent P1 hardening:** the direct byte-boundary API rejects nested hostile JS contracts (Proxy objects, accessor records, sparse arrays, array-instance method overrides, symbols and exotic prototypes) **before** calling G2 `assessMethod`. Otherwise arrays that pretend to authorize tools could launder a forbidden Method into `BYTES_BOUND_UNATTESTED`. This is limited to this G3 adapter; G2's direct exported API remains a separate future hardening surface.
- **Independent Exact-SHA P1 repair:** G3 must agree with the original G2 atomic Claim **kind**; its full declared tool/typed-operation permissions (including unused entries) must be a subset of G2 authorization. Evidence policy must not underreport original source sensitivity; receipt input labels must reflect source and upstream Method-output taint. A syntactically valid G3 receipt cannot grant extra tools, forge a Claim category, or down-label private bytes.
- Match actual supplied `Uint8Array`/Buffer byte hashes against the ProblemSpec source SHA and bundle source/model/Method SHA, each required step's binary/invocation/output SHA. Reject missing/extra receipts, changed source, model, invocation, output, policy or dependency, and bound data over size limits.
- At this stage support only **one original source per atomic Claim** (no silent multi-source merging). Every file/byte array must come from a trusted host if later used as execution evidence; JS callers can forge all supplied bytes. There is **no host identity, artifact chain of custody, supply-chain trust or post-execution assertion** in this API.
- Status `BYTES_BOUND_UNATTESTED` means SHA comparison **of supplied buffers only**; `native_host_attested:false`, `claim_result:UNVERIFIED`, `independent_oracle_review:NOT_RUN`, `solution_promotable:false`. Solver `SAT/UNSAT` or exit zero is never an original-requirement proof. `UNKNOWN/ERROR/TIMEOUT/NOT_RUN` is `INCONCLUSIVE`; external facts need independent authoritative sources.

## What remains for actual G3 end-to-end

1. Connect existing approved `native.mjs` runner and `planNative` (never raw LLM-provided executable or shell) to a **trusted host** that supplies bytes from actual file descriptors, OS process launch, executable hash, stdout/stderr and authority-bound policy. This pure byte gate is NOT such a host.
2. Compare native Z3 result semantics against an **independently frozen source-first semantic Oracle**, including weak/overstrong/vacuous and false-PASS cases; the synthetic six-case corpus alone does not confer independent expert validation.
3. Review [G3 native smoke PR #18](https://github.com/kaicreator-mm/formal-tools/pull/18) separately; its current receipt is still `CANDIDATE_FOR_REVIEW` with unaudited Z3 supply chain, cvc5 `NOT_RUN`. Do not mix its Windows host data into this source-only PR.
4. Record Solve/Verify/Both provenance, cost, failures and actual LLM-only baseline *before* G4 Solution promotion. The ability to hash strings is not a reason to mark `NATIVE_VERIFIED`.

## Validation

`tests/byte-evidence.test.mjs` contained 15 original adversarial declarations; 4 earlier post-review regressions and 4 independent Exact-SHA regressions cover nested hostile arrays and direct-call permission bypasses: matching simulated bytes remain unverified, modified source/model/binary/argv/output fails, Method digest and claimed step closure mismatch, unauthorized tool choice, missing or unrelated evidence, UNKNOWN/ERROR/TIMEOUT, privacy/policy misuse, multi-source refusal, transitive upstream step, malformed and oversized payloads.

**Mandatory gate:** exact final-SHA `node --test tests/*.test.mjs`, `npm run typecheck`, Woodpecker push+PR, independent source/security review and P0/P1 repair. This PR should be reviewed as G3 incremental source, not prematurely merged as fully validated Solve+Verify. Do not modify Issue #7.
