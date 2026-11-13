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
