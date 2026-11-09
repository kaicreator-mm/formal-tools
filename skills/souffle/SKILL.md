---
name: formal-souffle
description: Use Soufflé to check 递归 Datalog、DAG 可达性、传递闭包、规则关系推导; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Soufflé Formal Verification Skill

**Use for:** 递归 Datalog、DAG 可达性、传递闭包、规则关系推导.

**Expected offline bundle version:** `2.5`. **Upstream reference:** https://souffle-lang.github.io/. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
souffle --version; souffle reach.dl
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
.decl edge(a:symbol,b:symbol)
.decl reach(a:symbol,b:symbol)
edge("A","B").
edge("B","C").
reach(x,y) :- edge(x,y).
reach(x,z) :- reach(x,y), edge(y,z).
.output reach
```

## Procedure

保存为 `reach.dl`，运行 `souffle reach.dl -D output` 并检查 `A,C` 可达结果。

## Negative and mutation check

加入 `edge("C","A")`，运行循环检测规则并确认产生非空循环结果。

## Model limits and failure modes

Datalog 单调推理不等同于 ASP 的默认否定/非单调选择；输入数据变化必须重新计算并记录 fact 摘要。

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
