---
name: formal-z3
description: Use Z3 to check 通用 SMT、约束可满足性、模型/unsat core 及第二求解器对照; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Z3 Formal Verification Skill

**Use for:** 通用 SMT、约束可满足性、模型/unsat core 及第二求解器对照.

**Expected offline bundle version:** `5.3.3`. **Upstream reference:** https://github.com/Z3Prover/z3/blob/master/.github/skills/README.md. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
z3 -version; z3 -smt2 problem.smt2
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

将 SMT-LIB 内容写入 `problem.smt2` 后执行 `z3 -smt2 problem.smt2`，期望 `unsat`。

## Negative and mutation check

改为 `(assert (< x 10))` 应得 `sat`；单纯 `sat` 不意味着用户要求的性质已获证明。

## Model limits and failure modes

优先复用 Z3 官方仓库 `solve`/`prove`/`encode` 的思路；必须记录逻辑片段、选项、版本、模型或 unsat 核心。

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
