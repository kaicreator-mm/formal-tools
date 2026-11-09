---
name: apache-jena
description: Use Apache Jena to check RDF/Turtle 解析、SPARQL 查询、规则推理以及 DIS 语义消费; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Apache Jena Formal Verification Skill

**Use for:** RDF/Turtle 解析、SPARQL 查询、规则推理以及 DIS 语义消费.

**Expected offline bundle version:** `6.2.0`. **Upstream reference:** https://jena.apache.org/documentation/. The skill has source-reviewed instructions and unexecuted fixtures; `RUNTIME_NOT_VERIFIED` until signed execution receipts exist.

## Environment doctor

First obtain the executable from the [indexed Drive packages](https://drive.google.com/drive/folders/1GqX-Dn42Xi_STaoWYoq4aRXi3le2WPHB). The `formal-toolkit-linux-x86_64/install_offline.py` installer only covers its six named tools and dependencies; it **does not** install every skill in this repository. Use the appropriate standalone archive for other tools.

From this skill directory, after installing this specific tool and its dependencies:

```sh
riot --help
```

The doctor is version/help only; **do not** run a model before creating or locating the fixture. Do not claim any executed result from a command written in documentation.

## Reproducible fixtures

The version-controlled files in `examples/` are separate positive and mutation inputs. Use exactly the files below; do not paraphrase them and execute an unsaved prompt.

**Positive case** (working directory: `skills/apache-jena`):

```sh
riot --validate examples/data.ttl && arq --data examples/data.ttl --query examples/query.rq
```

**Negative/mutation case** (same working directory, different saved input):

```sh
riot --validate examples/invalid.ttl
```

**Expected outcome and judgment:** Positive query must return the (urn:a, urn:b) edge; negative malformed Turtle must fail validation. Jena 6 requires Java 21+. CLI `riot` / `arq` syntax is documented by Apache. No OWL inference is configured.

These are **statically prepared** test cases, NOT verified executions. Use `validation/SKILL_ACCEPTANCE_CASES.json` for the complete suite. Every run requires an exact input SHA-256, command, version, timeout, stdout/stderr and result status. Distinguish expected negative behavior from a tool error.

## Model limits and failure modes

Jena 6.x 需要 Java 21+；记录 entailment/推理规则集、数据集与查询文件 SHA。

## Shared verification contract
1. Determine the actual executable and locked version from the correct package index and (where present) its `MANIFEST.json`; run a version/doctor probe before any runtime claim. Drive files are **not automatically installed**.
2. Translate the human-language claim into explicit scope, assumptions, formal input and expected property. Separate *model correctness* from *solver correctness*.
3. Run positive and negative/mutation checks on the two separate saved fixture files; hash both. Use a bounded timeout and isolated writable directory.
4. Preserve input files, stdout, stderr, exit code, tool versions, environment, duration and SHA-256 in evidence. Expected negative tests may exit nonzero; classify against expectation.
5. Use statuses `PASS`, `COUNTEREXAMPLE`, `UNKNOWN`, `ERROR`, `NOT_RUN`. Never claim `PASS` for merely generated scripts or for `UNKNOWN`.
6. Never interpret bounded checking as universal proof, assume a library/tool is installed because a ZIP is present, or weaken the claim to force green.
7. For a contradiction across tools, stop, record a divergence case, and inspect encoding, assumptions and modes before adjudicating.


## Shared JavaScript CLI / MCP and Woodpecker integration

All commands in this Skill are native examples. For the curated repository fixtures, the shared runner also supports:

    node packages/runner/js/cli.mjs inspect apache-jena
    node packages/runner/js/cli.mjs run apache-jena --case positive
    node packages/runner/js/cli.mjs run apache-jena --case negative

After separately installing and connecting the optional MCP SDK v2 server, the same fixed fixture can be called through run_formal_fixture(tool="apache-jena", case="positive"). This is a *shared adapter*, not a claim that the upstream tool itself offers an official MCP server.

Read docs/tool-guides/apache-jena.md for the tool's theory, architecture, implementation and quick start. Read docs/CLI_MCP_CONTRACT.md for evidence semantics and docs/WOODPECKER_AGENT_INTEGRATION.md before CI integration. Those paths are relative to the Git repository root; the packaged ChatGPT Skill may not contain them.

R3 JavaScript integration is source-only and runtime remains NOT_RUN until executable/MCP/CI receipts exist.

## Experience reuse

On every real use, write evidence to the project's source-of-truth Git issue and propose a reusable lesson for the canonical repository `experience/EXPERIENCE_LOG.md` (do not assume the packaged Skill can mutate that Git path): exact SHA, CLI version, model hash, positive result, negative mutation, outcome and any corrected assumptions. Do not silently rewrite a historical receipt.

**Pure JS fallback:** for finite DAG/writer/CNF/state problems, use `packages/core/src/finite.mjs` without Node or native binaries. For this tool's full capabilities, the actual proof executable remains required. Do not confuse these two levels of evidence.
