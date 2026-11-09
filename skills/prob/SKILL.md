---
name: formal-prob
description: Use ProB to check B/Event-B 模型检查、规范精化、状态不变量; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# ProB Formal Verification Skill

**Use for:** B/Event-B 模型检查、规范精化、状态不变量.

**Expected offline bundle version:** `1.16.0`. **Upstream reference:** https://prob.hhu.de/w/index.php?title=ProB_CLI. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
probcli -version; probcli -help
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
MACHINE Counter
VARIABLES n
INVARIANT n : NAT & n <= 2
INITIALISATION n := 0
OPERATIONS inc = PRE n < 2 THEN n := n + 1 END
END
```

## Procedure

保存 `Counter.mch`，通过 `probcli Counter.mch -model_check` 检查可达状态；先核对当前版本 `probcli -help` 输出。

## Negative and mutation check

把 `inc` 前置条件去掉，让状态可能超过 2，应出现不变量违反或可证实的错误输出。

## Model limits and failure modes

版本约束和 CLI 标志依发行包核实；仅记录下载时哈希并不等于独立发行者签名验证。

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
