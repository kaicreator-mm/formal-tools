# Issue #11 G6 R17 — original DIS checkout source integrity repair

**Technical-only. No Product/Oracle/Host authority, qualified Solution, positive Replay, or Effect grant.**

The already merged R16 real DIS target driver checked the original `domain-harness` Git HEAD plus ten pinned original source blobs. That is insufficient to establish the actual **complete tracked checkout** was unmodified: its two selected original tests import *additional* executable Git-tracked modules, which could be edited or staged while `git rev-parse HEAD` and all ten selected pins remain unchanged. A previously untracked injected import is also possible. The original R16 engineering receipt must not be mistaken for complete source/Host attestation.

## R17 bounded fix

- New `packages/runner/js/verified-git-worktree.mjs` requires the **original repository root** and reads `git --no-optional-locks status --porcelain=v1 --untracked-files=all --ignore-submodules=none`, under scrubbed `GIT_*` process variables; any staged, modified, removed, or non-ignored untracked path blocks original target execution. No caller-provided flag may override it.
- The existing `real-dis-v020-target-consumer.mjs` now checks the worktree **before and after** original selected native DIS test processes. Exact Git HEAD + original ten Git blobs remain mandatory. This does not change real DIS SDK/KDP implementation.
- The new `tests/verified-git-worktree.test.mjs` creates actual fresh local Git repositories and verifies clean PASS plus modified tracked, staged, untracked-injected and invalid repository refusal. Local Linux Node22: **5/5 PASS**.
- Existing historical R16 `validation/g6-dis-target-real-2026-11-14/RECEIPT.json` remains byte-for-byte **immutable**, pinned to the original R16 driver Git Blob `3b8f6045247dc8819da3a85068668147d64840ad`. The existing receipt test distinguishes that actual prior Host run from the **new R17 guarded source**, rather than falsely rewriting its provenance. A NEW real Node24 Linux/x64 run of R17 original DIS child processes requires its own separate recorded receipt; Node24 CI on R17 only proves the checked-in tests/contract, **not** such a new Host run unless it explicitly executes it.

## Explicit exclusions and remaining risk

The Git status guard does **not** independently verify ignored `node_modules` or generated artifacts, does not prove the Host identity, and cannot eliminate a simultaneous change-and-restore race between two checks. It is a narrower source-integrity improvement, not a complete dependency supply-chain or atomic execution proof. Original Product Owner Source/Claim + independent professional Oracle + trusted Host credentials, actual authorized G4 Solution/Replay, and a separately qualified DIS Effect remain **BLOCKED**. Do not close #11, modify #7/#14, or expand #24/#4.

## Reproduction

```sh
node --test tests/verified-git-worktree.test.mjs
node --test tests/llm-g6-real-dis-target.test.mjs
```

Use the original `domain-harness` HEAD and original source pins from the versioned R16 receipt. Never treat the original 3/3 + 9/9 execution as an R17 execution at new source bytes.
