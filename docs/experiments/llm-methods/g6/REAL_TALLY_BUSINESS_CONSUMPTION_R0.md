# Issue #11 G6 — actual source-pinned Tally Domain Business Function consumption

**Status:** bounded **real technical Domain App Business Function** invocation, **NOT** a qualified Solution/Replay, DIS AOT/SDK/Host call, Kernel admission, professional Oracle, or physical Effect.

## Provenance and single executable boundary

- Original, unchanged [Tally Business v2 source](https://github.com/kaicreator-mm/tally/blob/e988321439f65b55936a691c02250b6d62a29409/packages/tally-engineering-business/src/index.mjs), commit `e988321439f65b55936a691c02250b6d62a29409`, exact **Git blob `54015fb63ffb13b4f4e562f660d2172098b5f7f4`**.
- That same source blob is already pinned in the real [DIS v0.2.0 cross-project consumer manifest](https://github.com/kaicreator-mm/domain-harness/blob/f21514deb0a4b5b4b2d6e3dae2cd5e8ec2f71120/examples/dis-v020-cross-project/manifest.json) (manifest Git blob `39e14468723c4211d1e55d6a7c3aa1a16204c5a8`).
- Offline source fixture lives at `benchmarks/llm-methods/g6/snapshots/tally-business.mjs` and MUST have exactly that original Tally Git blob. `loadPinnedTallyBusiness` rechecks the bytes **before** importing executable code; drift throws, never falls back to an unpinned local tool or a caller-controlled module path.
- Actual production-shaped Function invoked: original `assessTaskEvidence(input)` (not a fake or rewritten Tally function). Source is purely advisory; neither its `dependenciesComplete` field nor any Git source-looking string grants Kernel/Claim authority.
- Formal source candidate: `buildRealLifecycleCandidate` binds existing original G3 **6 faithful real native SAT/UNSAT observations** (from frozen G3 24×Z3+24×cvc5 history), plus original Source/Model/Tool/Evidence candidate; `persistSolutionCandidate` is executed on POSIX file storage with durable tombstone gates. **This workload does not repeat original 48 solver executions or hard-r1 40×2 native checks.**

## Actually executed phases

The script `benchmarks/llm-methods/g6/real-tally-business-consumer.mjs` accepts only `STORE_DIR FORMAL_HEAD` and *actually calls Tally's immutable pinned business function* four times:

| Phase | G4 store status | Actual Tally output | Admission |
|---|---|---|---|
| Unqualified persisted Solution candidate | `REPLAY_BLOCKED_UNQUALIFIED` | `UNQUALIFIED_INPUT` / `DEPENDENCIES_UNVERIFIED` | false |
| Version drift (tool 5.4.1) | `STALE` | `UNQUALIFIED_INPUT` | false |
| Forged `dependenciesComplete:true` | `REPLAY_BLOCKED_UNQUALIFIED` | `OBSERVED_INPUT_ONLY` / `REQUIRES_NATIVE_CLAIM_AND_KERNEL_ADMISSION` | false |
| Durable revocation / reinspection | `INVALIDATED` | `UNQUALIFIED_INPUT` | false |

The DIS v0.2 preflight also returns `kind=UNKNOWN`, `authority=NONE`, and zero Host invocations. This is a distinct **real Domain App Business Function call**, **not** a real DIS AOT→SDK→signed Host→Effect route. The phase statuses prove negative propagation and policy refusal only.

## Reproducibility and honesty

On a provisioned Linux/POSIX durable store, from an exact checkout of this PR:

```sh
node benchmarks/llm-methods/g6/real-tally-business-consumer.mjs /absolute/new/local/store ed6d0fbb6815b6d9445a5deacf8dab56de003c84
node --test tests/llm-g6-real-tally-business.test.mjs
```

The real current ChatGPT Linux/x64 execution used **non-root UID/GID 65534, Node 22.16.0**, yielded **4/4 Tally Function calls** and every `admitted=false/taskPass=false`, no effect or Host dispatch, and a source-bound candidate with `UNVERIFIED` claim. The complete actual process JSON is stored under `validation/g6-tally-business-real-2026-11-14/REAL_TALLY_BUSINESS_RECEIPT.json`; self-reported Host context is **not** independent Host credential. A real child-process CLI argc defect (`args.length===3` for two args) was found on first actual run, fixed at `4d4bac54dcc720709f6221234e53725630ac0201`, and now has a dedicated end-to-end CLI success + malformed-invocation regression. Source bytes verified with original Git Blob; full original monorepo Node 22 tests **288 total, 287 PASS / 0 FAIL / 1 SKIP**. Node24 Woodpecker CI must be checked at the PR's final Exact SHA.

**Remaining G6 formal exit:** original qualified Source/Model/Oracle/Tool/Host credentials; G4 true authorized reusable Solution with exact persistent replay/durable invalidation; actual DIS Function AOT→SDK/KDP/Host consumer (not merely Tally advisory source); fresh independent non-Writer source review. Do not infer formal SAP/Task Claim, trusted Effect or Release from this negative engineering observation. #4/#24 own generic runtime/36-tool work, and #7/#14 remain closed.


## R1 P1 repair — verified bytes are now exactly the executed bytes (2026-11-14)

The independent R0 reviewer found a real security P1 at HEAD `2c7d1f08…`:
`readFileSync(SNAPSHOT)` checked the source Git Blob but `import(SNAPSHOT.href)`
could load a *different* cached/path-replaced ESM module. **That old
receipt cannot establish verified-byte execution.** The prior receipt is
retained unchanged as an historical engineering observation.

The Writer fixed the loader in the source commit
`45e25f75dafce67f7d94fa7910a12101105227f9`:
`loadPinnedTallyBusinessFromBytes(Buffer)` verifies the **fixed original Tally
Git Blob** and immediately imports the `data:text/javascript;base64,…` URL
derived from the **same validated Buffer**, with no separate path reopen. It
accepts no caller-selected expected hash or executable path. The original
pinned Tally module contains no imports/import.meta; the imported module is
therefore self-contained and content-backed.

`tests/llm-g6-real-tally-business.test.mjs` now reproduces the reviewer's
actual ESM cache poisoning counterexample in an isolated temporary module:
the file URL returns `UNPINNED_CACHED_MODULE` even after the on-disk file
is restored to correct bytes. The repaired, **same code path used in
production** via `loadPinnedTallyBusinessFromBytes` executes only the
verified original Tally bytes. A later pathname replacement leaves the
bound bytes unchanged; a malicious Buffer is rejected before import.
New scoped tests 6/6 PASS in the current Linux Node22 container.

**Actual non-root repair receipt:** see
`validation/g6-tally-business-real-2026-11-14/REAL_TALLY_BUSINESS_P1_REPAIR.json`.
This is a new, actual Linux x64 / Node 22.16.0 / UID=GID=65534 execution,
**not** a rewritten R0 receipt. All four real Tally calls remain
`admitted=false` and `taskPass=false`; G4 candidate is unqualified and
tool-version `STALE`, then durable `INVALIDATED`; `host_invocations=0`,
`effect_dispatched=false`, `g6_accepted=false`. It explicitly separates
the historical G4 candidate subject `source_head` from the reported
`consumer_execution.source_commit=45e25f75dafce67f7d94fa7910a12101105227f9`,
and records Git blobs **`34c2a2f577618764795d7a9907504153ed9a96aa`**
for the consumer driver and
**`2e296c4b2c26181cf8268efceee14236331fa800`** for its tests.
Independent reviewers should compare those to GitHub's source commit; the
execution report itself marks `source_commit_independently_attested=false`.

**Scope and CI:** the local source-transfer staging used verified Git Blob
matches for all modified G6 files and corrected one stale G5 baseline test
using its exact main Blob. Full local tests then passed
**289 total / 288 PASS / 0 FAIL / 1 SKIP**. Full Node24 CI is determined
only from the Woodpecker status at the *final* PR HEAD, not this local Node22
run. The actual Node24 minor version must not be called independently
attested without the corresponding Woodpecker log. Do not infer any
professional Source/Oracle/Host authorization or qualified Solution/Replay
from this negative Function-consumer exercise.
