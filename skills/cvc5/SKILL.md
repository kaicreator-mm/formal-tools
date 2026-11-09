---
name: formal-cvc5
description: Use cvc5 to check SMT-LIB 约束求解、Z3 独立对照及模型差异检测; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# cvc5 Formal Verification Skill

**Use for:** SMT-LIB 约束求解、Z3 独立对照及模型差异检测.

**Expected offline bundle version:** `1.4.2`. **Upstream reference:** https://cvc5.github.io/docs/latest/. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
cvc5 --version; cvc5 --lang smt2 problem.smt2
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
(set-logic QF_LIA)
(declare-const x Int)
(assert (> x 0))
(assert (< x 0))
(check-sat)
```

## Procedure

保存 `problem.smt2` 并执行 `cvc5 --lang smt2 problem.smt2`；期望 `unsat`。

## Negative and mutation check

将 `< x 0` 改为 `< x 10`，应得到 `sat`；再由 Z3 对同一文件做交叉对照。

## Model limits and failure modes

求解器输出 `unknown` 或超时不得视为 PASS；对比不同求解器前固定逻辑、随机种子、超时和编码。

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
