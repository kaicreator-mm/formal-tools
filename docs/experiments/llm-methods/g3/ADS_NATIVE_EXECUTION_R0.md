# G3 D-ADS 24 — bounded real native execution path (Issue #11)

## What this increment implements

The source-frozen 6-case × 4-model QF_LIA matrix was already accepted and merged through PR #21. This increment adds a **local-only** real-execution entry point using the already shipped `planNative("z3"|"cvc5","solve")` and `executeNativePlan` implementation; it does not add a parallel solver runtime or new tool registry.

From a trusted local shell with an independently sourced executable path and its **actual exact file SHA-256**, run:

```sh
node benchmarks/llm-methods/g3/ads-native-replay.mjs z3 /absolute/directory/of/z3 <64-hex-expected-binary-sha256> /private/output/ads24
```

A matching cvc5 invocation changes the tool ID to `cvc5`. The executor validates the full frozen worklist, pins the on-disk binary hash before and after, executes all 24 through typed operations with a per-query bounded timeout, records stdout/stderr SHA-256, true native exit codes, timeout and input hashes, then invokes the existing `scoreAdsMatrix` diagnostics.

The frozen sample oracle deliberately tests false-PASS, overstrong and vacuous models. SAT/UNSAT alone cannot establish correctness of a business claim. The strict observation gate requires **exactly one standalone SAT, UNSAT or UNKNOWN answer on stdout, empty stderr and exit 0**; malformed, duplicate, nonzero or unexpected solver output becomes ERROR, and a timeout stays TIMEOUT.

**Critical limitation:** The caller-supplied expected executable hash and self-observed process metadata are not an independent supply-chain/process attestation. The frozen six-case oracle is not a certified independent ADS Product truth source. Every receipt has `original_claim_verdict=UNVERIFIED`, `host_process_attested=false`, `independent_oracle_review=NOT_RUN`, `solution_promotable=false`. A modified/hostile mock executable can produce a correct-looking 24/24 stdout record; this is why the new regression runs a deliberately fake binary and proves that **no** such record is promoted.

Native execution requires a local tool source (e.g. separately verified and extracted App/packages). **Woodpecker Node source checks only cover structure, adversarial parser tests and fake subprocess non-promotion.** Do not report native Z3 24/24 from the CI. Actual native receipts, externally verified tool origins and an independent source-first Oracle are needed to admit G3.

## Minimal next closure

1. Run the exact branch/source in an isolated Debian13 host with the genuine Z3/cvc5 binaries, appropriate containment, pinned hashes and real 24-query receipts. Never substitute the fake test binary as evidence.
2. Compare real SAT/UNSAT observations against the six frozen cases and independently adjudicate the original model fidelity, including weak/overstrong/vacuous failure detection.
3. Review exact branch/CI and receipt SHA; merge this source increment only as a **native execution capability**, not G3 certification.
4. When G3 receives an actual independently qualified Method, complete G4 Solution/Replay, G5 honest LLM-only A/B and G6 actual consumer, preserving all fail-closed gates.

No Issue #7 tasks, no GitHub Actions, no historical-R1 mutation.
