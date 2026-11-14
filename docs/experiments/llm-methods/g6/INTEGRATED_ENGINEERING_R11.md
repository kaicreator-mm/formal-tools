# #11 R11 — Source-first independent finite check + actual G3→G6 technical chain

**Qualification: `PASSED_ENGINEERING_ONLY`; `QUALIFIED_SOLUTION=false`; `QUALIFIED_REPLAY=false`; `G6_FULL=false`.** This work does **not** claim Original ADS Product authority, independent *professional* semantic Oracle, independently authenticated Host, or real DIS AOT→SDK/KDP/signed Host execution. There are **zero new solver or DeepSeek API calls** in this R11 workload.

## Real receipts reused — not executed again

- Original merged G3 [PR #62](https://github.com/kaicreator-mm/formal-tools/pull/62) Z3 **5.4.0** and cvc5 **1.4.2** native 24×2 executions, original `validation/ads24-native-2026-11-13/NATIVE_PAIR.json` Git Blob **`cee8f188cce20b042df505f824cccae64d2c9b1c`**. Frozen 6 cases×4 models; generator Blob **`ce3a2dc2dde0ce7805c610e1caf4dfa524904e2e`**, fixture Blob **`33952ec8f460f022e750f91543c7dafbae35c9e2`**.
- Original solver executable SHA256 pinned separately: Z3 `e9d7e6e6d76c81b5ea3f06d165fc4cfd8afab92b74cdf94417380b5eed10845d`; cvc5 `6aecddf466552b83bb5883756c7955e0c9d5ddcc6d7f45b48c2f6e06a741b102`. These are **technical executable identities**, not independent vendor/supply-chain or Host authority.
- G4 original `buildRealLifecycleCandidate()`, native-linked immutable candidate, POSIX persistence/revocation/tombstone in `solution-store.mjs`. G6 original `runRealTallyBusinessConsumption()` uses original Tally source exact Git Blob `54015fb63ffb13b4f4e562f660d2172098b5f7f4`, with byte-backed data-URL ESM loader as previously independently scoped-reviewed and merged in PR #78. No changes to existing G3, G4, G5, G6 implementation.

## Independent *algorithm* check (not a professional Oracle)

`benchmarks/llm-methods/g3/independent-finite-verifier.mjs` implements a **separate finite graph/time/resource interpreter** of R1 dependency DAG and precedence, R2 exact shared-writer interval exclusion, and R3 finite strict task windows. It **does not** parse SMT or use frozen authored expected labels to decide satisfiability. It recomputes the original six labels from the faithful model and all 24 model/case satisfiability results from model constraints.

It binds original Git Blob hashes for fixture/generator/receipt; each original SMT input's SHA256; immutable solver executable SHAs/versions; original 24 rows' IDs, ordering, tool statuses, stdout fingerprint and exit codes. Only then are historical 48 real native observations scored against **independently computed finite reference semantics**:

| Source model | Independently computed SAT | UNSAT | Technical diagnostic |
|---|---:|---:|---|
| faithful | 2 | 4 | Matches 6 authored case labels; no professional attestation |
| weak-omits-writer | 3 | 3 | False-PASS on overlapping same-resource writers |
| overstrong-global-exclusion | 1 | 5 | False-reject on legitimate distinct-resource parallelism |
| vacuous-always-false | 0 | 6 | Rejects even positive cases |

Adversarial tests exercise both engines changed to the **same wrong status** (ordinary cross-engine agreement would accept it), author-rewritten PASS label with repinned fixture Blob, input hash drift, reordered/missing rows, source bytes drift, executable version/SHA mismatch, stdout digest mismatch and native nonzero exit. All fail closed. This removes a technical *common-mode agreement* gap. It does **not** make the original authored R1/R2/R3 specification a formally approved ADS Product Oracle.

## One real technical execution path

`benchmarks/llm-methods/g6/integrated-engineering-chain.mjs` invokes in order:

1. **Capability**: existing `readCapabilityRegistry()` resolves `logic.smt`→Z3/cvc5; registry remains `DISCOVERY_ONLY_NOT_NATIVE_VALIDATED`. Historical native receipt provides separate technical observations.
2. **Method**: existing `assessMethod()` validates frozen `ProblemSpec` / Method DAG as `STRUCTURALLY_VALID`.
3. **Solve**: reuses 24×2 historical real native solver observations; **new process invocations = 0**.
4. **Independent Verify**: separate finite algorithm checks all original 6 labels and 24×2 source-bound native outcomes; `SCORED_INDEPENDENT_ALGORITHM_UNATTESTED`, no professional Oracle.
5. **Solution**: existing G4 byte/digest-bound `CANDIDATE`, persisted in owner-local POSIX durable store with `NOT_ADMITTED`, `UNVERIFIED`.
6. **Replay**: actual persisted-store inspections under matching input (`REPLAY_BLOCKED_UNQUALIFIED`), version drift (`STALE`) and permanent tombstone (`INVALIDATED`). No authorized positive replay.
7. **Domain App**: calls the **actual source-pinned Tally Business Function** four times; all deny `admitted/taskPass`. A forged `dependenciesComplete:true` yields only `OBSERVED_INPUT_ONLY`.
8. **DIS SDK/Host**: **NOT EXECUTED**. Existing preflight is `UNKNOWN/NONE`; no KDP admission, Host call, signed Effect, formal SAP or Release.

### Reproducibility

From an exact checkout of this PR and on a provisioned owner-local POSIX directory supporting directory fsync:

```sh
node --test tests/ads-independent-finite-verifier.test.mjs tests/i11-integrated-engineering-chain.test.mjs
node benchmarks/llm-methods/g6/integrated-engineering-chain.mjs /absolute/new/owned/posix-store 9edcb4c2698ef9733215a8281962268152a7eab9
```

Actual ChatGPT Linux/x64/Node v22.16.0 execution as unprivileged **UID/GID 65534** produced **one new 7,975-byte original JSON receipt** at `validation/i11-integrated-engineering-2026-11-14/REAL_INTEGRATED_NONROOT_RECEIPT.json`, with a committed snapshot of the original exact source driver and independently generated verifier Git Blob. The signer/Host/consumer identity in this local receipt is self-reported and not independently attested. Current-container regression on a **reconstructed subset**, not a complete current main checkout: 39/40 baseline test files (the newer `portable-tool-runner.test.mjs` was unavailable in the source-transfer snapshot) plus both new tests, **41 test files / 298 tests / 297 PASS / 0 FAIL / 1 SKIP** on Node22. The full current repository has 40 baseline test files and this PR adds 2; only the exact-head Woodpecker run evaluates all current files. Incremental tests **9/9 PASS**. The final PR's full `npm ci`, Node24 and TypeScript gate is separately verified only by final Exact-SHA Woodpecker status; we do not replace it with local Node22 results.

**Minimum remaining formal path:** Original Product Owner and qualified independent professional Oracle select and attest **one** Source/Claim with version, rights and applicability; separate trusted Source/Model/Tool/Host credentials; implement **actual qualified positive Solution and persistent authorized Replay** (currently blocked intentionally); pass a qualified Solution into *real* DIS `loadDisV020Aot`→SDK/KDP→signed Host and verify output, invalidation and Effect limits. This new finite checker is not a substitute for either authority or actual DIS SDK/Host consumption. Keep #11 open and preserve #7/#14 unchanged; #24/#4 own 36-tool generic work.
