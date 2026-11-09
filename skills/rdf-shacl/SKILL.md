---
name: rdf-shacl
description: Use pySHACL / SHACL to check RDF 数据形状约束、必需属性、类型、数量和语义约束验证; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# pySHACL / SHACL Formal Verification Skill

**Use for:** RDF 数据形状约束、必需属性、类型、数量和语义约束验证.

**Expected offline bundle version:** `pySHACL 0.40.2; SHACL 1.5.0 artifact`. **Upstream reference:** https://github.com/RDFLib/pySHACL. The skill has source-reviewed instructions and unexecuted fixtures; `RUNTIME_NOT_VERIFIED` until signed execution receipts exist.

## Environment doctor

First obtain the executable from the [indexed Drive packages](https://drive.google.com/drive/folders/1GqX-Dn42Xi_STaoWYoq4aRXi3le2WPHB). The `formal-toolkit-linux-x86_64/install_offline.py` installer only covers its six named tools and dependencies; it **does not** install every skill in this repository. Use the appropriate standalone archive for other tools.

From this skill directory, after installing this specific tool and its dependencies:

```sh
python -m pyshacl --help
```

The doctor is version/help only; **do not** run a model before creating or locating the fixture. Do not claim any executed result from a command written in documentation.

## Reproducible fixtures

The version-controlled files in `examples/` are separate positive and mutation inputs. Use exactly the files below; do not paraphrase them and execute an unsaved prompt.

**Positive case** (working directory: `skills/rdf-shacl`):

```sh
python -m pyshacl -s examples/shapes.ttl -df turtle -sf turtle -f human examples/positive.ttl
```

**Negative/mutation case** (same working directory, different saved input):

```sh
python -m pyshacl -s examples/shapes.ttl -df turtle -sf turtle -f human examples/negative.ttl
```

**Expected outcome and judgment:** Positive must report `Conforms: True`; negative `Conforms: False` with minCount violation. Use the compatible Python interpreter and complete offline wheel dependencies; the pySHACL archive is separate from the six-tool toolkit.

These are **statically prepared** test cases, NOT verified executions. Use `validation/SKILL_ACCEPTANCE_CASES.json` for the complete suite. Every run requires an exact input SHA-256, command, version, timeout, stdout/stderr and result status. Distinguish expected negative behavior from a tool error.

## Model limits and failure modes

包中有 Python3.13 离线 wheel，首次运行先核对解释器；SHACL 规则规范本身不是独立 executable。

## Shared verification contract
1. Determine the actual executable and locked version from the correct package index and (where present) its `MANIFEST.json`; run a version/doctor probe before any runtime claim. Drive files are **not automatically installed**.
2. Translate the human-language claim into explicit scope, assumptions, formal input and expected property. Separate *model correctness* from *solver correctness*.
3. Run positive and negative/mutation checks on the two separate saved fixture files; hash both. Use a bounded timeout and isolated writable directory.
4. Preserve input files, stdout, stderr, exit code, tool versions, environment, duration and SHA-256 in evidence. Expected negative tests may exit nonzero; classify against expectation.
5. Use statuses `PASS`, `COUNTEREXAMPLE`, `UNKNOWN`, `ERROR`, `NOT_RUN`. Never claim `PASS` for merely generated scripts or for `UNKNOWN`.
6. Never interpret bounded checking as universal proof, assume a library/tool is installed because a ZIP is present, or weaken the claim to force green.
7. For a contradiction across tools, stop, record a divergence case, and inspect encoding, assumptions and modes before adjudicating.


## Experience reuse

On every real use, write evidence to the project's source-of-truth Git issue and propose a reusable lesson for the canonical repository `experience/EXPERIENCE_LOG.md` (do not assume the packaged Skill can mutate that Git path): exact SHA, CLI version, model hash, positive result, negative mutation, outcome and any corrected assumptions. Do not silently rewrite a historical receipt.
