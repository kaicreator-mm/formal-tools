---
name: formal-vampire
description: Use Vampire to check 一阶逻辑 TPTP 自动证明、规范蕴含与一致性反例探索; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Vampire Formal Verification Skill

**Use for:** 一阶逻辑 TPTP 自动证明、规范蕴含与一致性反例探索.

**Expected offline bundle version:** `5.1.0`. **Upstream reference:** https://github.com/vprover/vampire. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
vampire --help; vampire problem.p
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
fof(a1, axiom, ! [X] : (p(X) => q(X))).
fof(a2, axiom, p(a)).
fof(goal, conjecture, q(a)).
```

## Procedure

保存 `problem.p`，执行 `vampire --mode casc problem.p`，检查 SZS status `Theorem` 和证明输出。

## Negative and mutation check

改为无法由公理推出的 `q(b)`，不得错误报告 `Theorem`；超时/不确定应归类 UNKNOWN。

## Model limits and failure modes

TPTP 的 `Theorem`、`CounterSatisfiable`、`GaveUp` 含义不同；严格记录公理集合，禁止加入结论作为公理。

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
