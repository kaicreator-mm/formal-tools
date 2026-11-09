---
name: formal-apache-jena
description: Use Apache Jena to check RDF/Turtle 解析、SPARQL 查询、规则推理以及 DIS 语义消费; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Apache Jena Formal Verification Skill

**Use for:** RDF/Turtle 解析、SPARQL 查询、规则推理以及 DIS 语义消费.

**Expected offline bundle version:** `6.2.0`. **Upstream reference:** https://jena.apache.org/documentation/. The skill is `SOURCE_REVIEWED / RUNTIME_NOT_VERIFIED` until an actual executable receipt is recorded.

## Environment doctor

```sh
riot --help; arq --help
```

Never claim verification unless the command ran in an actual compatible environment and its exact version was recorded. When offline installation is needed, use the `formal-toolkit-linux-x86_64` archive's `install_offline.py` and checksum verification; do not assume the tools were automatically installed by Drive.

## Minimal model

```text
在 data.ttl 中写 `<urn:a> <urn:dependsOn> <urn:b> .`，使用 SELECT 查询关系。
```

## Procedure

先 `riot --validate data.ttl` 检查语法，再用 `arq --data data.ttl --query query.rq` 执行 SELECT 或 ASK 查询。

## Negative and mutation check

故意提供无效 Turtle 期望解析失败；未配置 reasoner 时不能将 SPARQL 结果当作 OWL 推理闭包。

## Model limits and failure modes

Jena 6.x 需要 Java 21+；记录 entailment/推理规则集、数据集与查询文件 SHA。

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
