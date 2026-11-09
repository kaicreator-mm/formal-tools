---
name: formal-clingo
description: Use Clingo to check ASP 候选选择、互斥决策、默认否定、答案集枚举; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Clingo Formal Verification Skill

**Use for:** ASP 候选选择、互斥决策、默认否定、答案集枚举.

**Expected offline bundle version:** `5.8.3`. **Upstream reference:** https://potassco.org/clingo/. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
python3 -m clingo --version; python3 -m clingo plan.lp 0
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
candidate(a;b).
1 { choose(X) : candidate(X) } 1.
#show choose/1.
```

## Procedure

保存 `plan.lp`，通过匹配 wheel 的 Python 3.14 执行 `python -m clingo plan.lp 0`，期望恰有两个答案集。

## Negative and mutation check

增加 `:- choose(a).` 与 `:- choose(b).`，期望 `UNSATISFIABLE`；不要把无答案集自动视为程序错误。

## Model limits and failure modes

当前 Drive wheel 是 cp314，不能用默认 Python 3.10–3.13 强行 pip 安装；ASP 答案集是模型，不等于被证明的业务偏好。

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
