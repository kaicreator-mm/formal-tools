---
name: formal-rdf-shacl
description: Use pySHACL / SHACL to check RDF 数据形状约束、必需属性、类型、数量和语义约束验证; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# pySHACL / SHACL Formal Verification Skill

**Use for:** RDF 数据形状约束、必需属性、类型、数量和语义约束验证.

**Expected offline bundle version:** `pySHACL 0.40.2; SHACL 1.5.0 artifact`. **Upstream reference:** https://github.com/RDFLib/pySHACL. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
pyshacl --help; python -m pyshacl --help
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
使用 Turtle 数据 `ex:x a ex:Package .`；shape 要求 `ex:Package` 必须有 `ex:version`，设置 minCount 1。
```

## Procedure

执行 `pyshacl -s shapes.ttl -df turtle -sf turtle data.ttl`，记录 validation report graph、`conforms` 与实际 exit code。

## Negative and mutation check

缺失 `ex:version` 应输出 Violation；补上版本属性应通过，区分约束检查与 OWL 蕴含。

## Model limits and failure modes

包中有 Python3.13 离线 wheel，首次运行先核对解释器；SHACL 规则规范本身不是独立 executable。

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
