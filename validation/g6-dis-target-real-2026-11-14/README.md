# G6 real DIS v0.2.0 target consumption — bounded Linux/x64 Node24 receipt (2026-11-14)

Issue #11 R15/R16. One bounded execution consuming the **original**
`kaicreator-mm/domain-harness` DIS v0.2.0 SDK/KDP target at the pinned draft
PR #1497 HEAD `90afefa81ef9ad0d42087ffc8a0dbaa32757811f` — no reimplementation,
no modified original bytes, no new solver or LLM calls.

## What ran

Driver: `benchmarks/llm-methods/g6/real-dis-v020-target-consumer.mjs`
(git blob `3b8f6045247dc8819da3a85068668147d64840ad`, LF form).

1. Byte-verified the original checkout: exact HEAD + 10 source pins
   (consumer test, selected build + its test, the three `dis-v020.mjs`
   package entries, native fixture, cross-project consumer/manifest, and the
   original Tally business snapshot `54015fb6…` — the exact blob already
   consumed by formal-tools G6 PR #78).
2. Sealed the real pinned G3 Method/Solution candidate
   (`ba06f7e0…`, `STRUCTURALLY_VALID`, claim `UNVERIFIED`) and persisted it in
   a durable owner-local store on ext4.
3. Witness stage: shipped trust registry has **no PRODUCT_APPROVED anchors**
   (no real Product Owner / independent Oracle / trusted Host credentials
   exist), so the Owner/Oracle/Host witness is **strictly BLOCKED**
   (`PRODUCT_TRUST_ROOTS_NOT_APPROVED`) before any signature is read.
   Positive Replay stays BLOCK.
4. Durable store boundary revalidation: STALE under provenance drift,
   tombstone dominates after `OPERATOR_REVOKED`, identical bytes cannot
   resurrect.
5. Original chain, executed as **unmodified child processes** of the verified
   original checkout (`node --import tsx --test`, Node v24.21.0, linux/x64):
   - `examples/dis-v020-native-sdk/b05-target-consumer.test.mjs`: 3/3 pass —
     real AOT compile → qualify → load; Tally observation receipts with
     `authority NONE`, KDP `ADMITTED` with execution `NOT_PROVEN`,
     forged-claim refusal, stale/missing source-pin boot denials.
   - `examples/dis-v020-cross-project/selected-build.test.mjs`: 9/9 pass —
     canonical BUILD selects byte-locked Tally/xDownload sources; a declared
     external Effect cannot be invoked through the DIS consumer adapter.

## What this receipt is NOT

- Not a Product PASS, business attestation or formal G5 acceptance.
- Not a Host attestation: the execution host is not an independently
  credentialed formal-tools Host (`host_independently_attested: false`).
- Not an authorized positive Replay: qualification is BLOCK on all gates.
- Not new Z3/cvc5 or DeepSeek work: zero new solver/LLM invocations.

## Reproduce

```sh
git clone https://github.com/kaicreator-mm/domain-harness.git
git -C domain-harness checkout 90afefa81ef9ad0d42087ffc8a0dbaa32757811f
cd domain-harness && npm ci --ignore-scripts
STORE=$(mktemp -d)
node benchmarks/llm-methods/g6/real-dis-v020-target-consumer.mjs \
  "$STORE" <formal-tools HEAD sha> "$(cd .. && pwd)/domain-harness"
```

Run on Linux/x64 with Node >= 24. Any drift of the original HEAD or any of
the 10 pinned sources aborts the driver before the chain executes.
`tests/llm-g6-real-dis-target.test.mjs` verifies this receipt on any
checkout; the formal-tools store/witness phases additionally re-run live
inside the committed test suite (POSIX durable-directory cases skip on
platforms without directory fsync).
