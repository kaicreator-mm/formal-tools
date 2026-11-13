# Issue #11 / G6 — controlled DIS v0.2.0 consumption PRE-FLIGHT R0

**Status: ENGINEERING_NEGATIVE_PRECHECK_ONLY. Not a true DIS invocation, not G6 Product PASS.**

## Real external contract evidence (read-only)

- Consumer repository: `kaicreator-mm/domain-harness`, ongoing DIS Demo [PR #1497](https://github.com/kaicreator-mm/domain-harness/pull/1497), source HEAD `f21514deb0a4b5b4b2d6e3dae2cd5e8ec2f71120`.
- Actual runnable bounded selected-target example: `examples/dis-v020-native-sdk/bounded-engineering-demo.mjs`, Git blob `e44e2be5b66ad9e6b8961c4ec2cfdedadc0467c9`, target `linux/x64/node`, Node >=24. The original example invokes `loadDisV020Aot(...)` and selected functions `tally.assessTaskEvidence`, `xdownload.describePolicy`, `orders.approve`. Its bounded result has typed `kind` and `authority`, with `taskClaimAttested=false` / `effectExecutionProven=false`; this is not business Oracle or production trusted effect.
- This R0 formal-tools source does **not** vendor or implement the DIS microkernel, and does not alter that PR or its original Code/Test. A future real DIS Host must independently check Source/Model/Oracle/Tool/Host and invoke under its own KDP permits.

## Current bounded integration

`packages/runner/js/dis-v020-consumer-preflight.mjs` uses the already-integrated original G4 candidate/Replay contract (`solution-candidate.mjs`) from PR #23. It enforces current DIS target HEAD identity, checks the actual SHA-sealed candidate against current model/source/oracle/tool/evidence/host provenance, and emits an immutable evidence-limited typed envelope:

- exact same-but-unqualified candidate => `status=REPLAY_BLOCKED_UNQUALIFIED; kind=UNKNOWN; authority=NONE`
- changed Source/Oracle/Model/Tool/Evidence/Platform or DIS source HEAD => `status=STALE; kind=UNKNOWN; authority=NONE`
- tampered, fake REUSABLE/PASS, corrupt or oversized input => `status=BLOCKED; kind=UNKNOWN; authority=NONE`

All outcomes carry `attested=false`, `independent_oracle=false`, `effect_dispatched=false`, `host_invocations=0`, `claim_result=UNVERIFIED`, `g6_accepted=false`. No caller-supplied permission flag is accepted. The G4 content-addressed owner-local persistence from pending PR #66 is **not yet merged**, so this R0 consumes its *pre-persistence candidate inspection* contract only. It MUST NOT be represented as executing Method, Qualified Solution, DIS AOT or Host.

`tests/dis-v020-consumer-preflight.test.mjs` covers source-pinned target, normal UNQUALIFIED abstention, field-by-field stale provenance, DIS target evolution, forgeries, malformed and bounded inputs. This is a source/CI test, **not a real native DIS observation**.

## Exit obligations (not satisfied)

1. G3 original Product Source/Model/Oracle identity and Host/Tool provenance independently qualified; SAT/UNSAT alone cannot establish the original business Claim.
2. G4 #66 source, atomic store, revocation/STALE and future admission/permission boundary independently accepted and integrated; actual qualified, immutable Solution/Method package exists with a real replay credential.
3. At **the current real domain-harness HEAD**, use its existing SDK/KDP/Host loader and selected Target to consume the genuinely qualified Method/Solution. Capture raw input/trace/result/evidence/revocation and exact Git/Tool/Host identity with original independent reviewer. On drift/revocation/UNKNOWN, propagate no-authority typed outcome to Domain App; prove no Host effect occurred.
4. Independent cross-repo reviewer and Product gate must evaluate actual execution, not treat this negative preflight as G6 PASS. If DIS contract changes, update the pin, rerun affected integration, and retain old results as historically scoped.

No duplicate Runtime, no tool expansion (portfolio #24 / runtime #4), no changes to closed #7/#14. Existing G3 24×Z3/24×cvc5 receipts reused, not rerun.
