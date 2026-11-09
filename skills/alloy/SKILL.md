---
name: formal-alloy
description: Use Alloy Analyzer to check 关系模型、依赖图、唯一性、有限域结构反例; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Alloy Analyzer Formal Verification Skill

**Use for:** 关系模型、依赖图、唯一性、有限域结构反例.

**Expected offline bundle version:** `6.2.0`. **Upstream reference:** https://alloytools.org/. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
优先先确认官方发行包内 CLI / jar 入口；不要猜测 jar 参数
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
sig Node { next: lone Node }
assert NoSelfLoop { no n: Node | n in n.next }
check NoSelfLoop for 4
```

## Procedure

通过 Alloy Analyzer 打开 `.als` 并运行 `check`；若发行包带可用 CLI，先从 `--help` 记录准确命令，再自动化执行。

## Negative and mutation check

构造允许自环的节点，预期反例；scope=4 不能外推到所有规模。

## Model limits and failure modes

仅在边界 scope 内模型检查；图结构和 Element 分解适用，软件库 Titanium Alloy 不是同一个工具。

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
