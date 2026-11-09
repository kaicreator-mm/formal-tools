---
name: formal-lean4
description: Use Lean 4 to check 核心定理证明、归纳不变量、算法性质的内核检查; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Lean 4 Formal Verification Skill

**Use for:** 核心定理证明、归纳不变量、算法性质的内核检查.

**Expected offline bundle version:** `4.35.0`. **Upstream reference:** https://github.com/leanprover/lean-beam/blob/main/skills/lean-beam/SKILL.md. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
lean --version; lake --version
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
theorem add_zero_demo (n : Nat) : n + 0 = n := by simp
```

## Procedure

将定理写入 Main.lean，使用 `lean Main.lean`；项目级使用 `lake build`。

## Negative and mutation check

把目标改为 `n + 1 = n`，应拒绝编译证明；区分证明目标错误和 Lean 语法错误。

## Model limits and failure modes

lean-beam 是可选加速层，需要单独安装；已有的 Lean 4 归档并不自动包含 beam。严禁 `sorry`、`admit`、额外无依据公理冒充证明。

## Shared verification contract
1. Determine the actual executable and locked version from `MANIFEST.json`, and run a version/doctor probe before any claim. Files on Drive are **not automatically installed**.
2. Translate the human-language claim into explicit scope, assumptions, formal input and expected property. Separate *model correctness* from *solver correctness*.
3. Run positive and negative/mutation checks on exactly the saved source file; use a bounded timeout and isolated writable directory.
4. Preserve input files, stdout, stderr, exit code, tool versions, environment, duration and SHA-256 in evidence. Expected negative tests may exit nonzero; classify against expectation.
5. Use statuses `PASS`, `COUNTEREXAMPLE`, `UNKNOWN`, `ERROR`, `NOT_RUN`. Never claim `PASS` for merely generated scripts or for `UNKNOWN`.
6. Never interpret bounded checking as universal proof, assume a library/tool is installed because a ZIP is present, or weaken the claim to force green.
7. For a contradiction across tools, stop, record a divergence case, and inspect encoding, assumptions and modes before adjudicating.


## Experience reuse

On every real use, append a small entry to `../../experience/EXPERIENCE_LOG.md` or the project's source-of-truth Git issue: exact SHA, CLI version, model hash, positive result, negative mutation, outcome and any corrected assumptions. Do not silently rewrite a historical receipt.
