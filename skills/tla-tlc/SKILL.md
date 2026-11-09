---
name: formal-tla-tlc
description: Use TLA+ / TLC to check 状态迁移、并发流程、可达性、死锁和安全性/活性检查; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# TLA+ / TLC Formal Verification Skill

**Use for:** 状态迁移、并发流程、可达性、死锁和安全性/活性检查.

**Expected offline bundle version:** `tla2tools.jar (version via runtime)`. **Upstream reference:** https://github.com/younes-io/agent-skills/blob/main/skills/tla-check/SKILL.md. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
java -cp tla2tools.jar tlc2.TLC -help
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
---- MODULE Toggle ----
VARIABLE x
Init == x = 0
Next == x' = 1 - x
Inv == x \in {0,1}
Spec == Init /\ [][Next]_x
====
```

## Procedure

将模型写为 `Toggle.tla`、配置写为 `Toggle.cfg`（`SPECIFICATION Spec`、`INVARIANT Inv`），执行 `java -cp tla2tools.jar tlc2.TLC -config Toggle.cfg Toggle.tla`。

## Negative and mutation check

将 `Inv` 改为 `x = 0`，预期出现状态轨迹反例；在报告中记录检查范围和 fairness 假设。

## Model limits and failure modes

TLC 通过仅表示指定有限或可枚举模型及假设内未发现违规；不得升级为对任意规模系统的数学证明。

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
