---
name: formal-dafny
description: Use Dafny to check 程序级前置/后置条件、循环不变量、自动程序证明; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Dafny Formal Verification Skill

**Use for:** 程序级前置/后置条件、循环不变量、自动程序证明.

**Expected offline bundle version:** `4.11.0`. **Upstream reference:** https://dafny.org/latest/DafnyRef/DafnyRef. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
dafny --version; dafny verify Example.dfy
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
method AddOne(x: int) returns (y: int)
  ensures y == x + 1
{
  y := x + 1;
}
```

## Procedure

保存 `Example.dfy`，运行 `dafny verify Example.dfy`，检查验证通过和验证条目数量。

## Negative and mutation check

把后置条件改为 `ensures y == x + 2`，应得到验证失败；不应通过跳过验证掩盖错误。

## Model limits and failure modes

Dafny 4.11.0 包依赖 .NET 8；严格区分编译通过、测试通过、证明通过，并保存证明器版本/超时。

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
