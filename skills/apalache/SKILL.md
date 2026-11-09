---
name: formal-apalache
description: Use Apalache to check TLA+ 有界符号模型检查、状态约束与 SMT 后端验证; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Apalache Formal Verification Skill

**Use for:** TLA+ 有界符号模型检查、状态约束与 SMT 后端验证.

**Expected offline bundle version:** `0.62.4`. **Upstream reference:** https://apalache-mc.org/. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
apalache-mc --version; apalache-mc check --help
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
复用 `tla-tlc` 技能中 `Toggle.tla`，明确 `Init`、`Next` 与待验证不变量。
```

## Procedure

在确定的 Apalache 发行版本中，通过 `apalache-mc check --init=Init --next=Next --inv=Inv --length=10 Toggle.tla` 执行有界检查；先确认参数版本。

## Negative and mutation check

用错误不变量 `x = 0` 期待反例；更改 `--length` 应明确改变边界，不能称为无界证明。

## Model limits and failure modes

Apalache 与 TLC 语义/覆盖范围不同；记录界长、算法、SMT 求解器与超时，`unknown` 不是 PASS。

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
