---
name: clingo
description: Use Clingo to check ASP 候选选择、互斥决策、默认否定、答案集枚举; generate reproducible formal inputs, run positive and negative tests, and record exact executable proof or counterexample evidence.
---
# Clingo Formal Verification Skill

**Use for:** ASP 候选选择、互斥决策、默认否定、答案集枚举.

**Expected offline bundle version:** `5.8.3`. **Upstream reference:** https://potassco.org/clingo/. The skill has source-reviewed instructions and unexecuted fixtures; `RUNTIME_NOT_VERIFIED` until signed execution receipts exist.

## Environment doctor

First obtain the executable from the [indexed Drive packages](https://drive.google.com/drive/folders/1GqX-Dn42Xi_STaoWYoq4aRXi3le2WPHB). The `formal-toolkit-linux-x86_64/install_offline.py` installer only covers its six named tools and dependencies; it **does not** install every skill in this repository. Use the appropriate standalone archive for other tools.

From this skill directory, after installing this specific tool and its dependencies:

```sh
python -m clingo --version
```

The doctor is version/help only; **do not** run a model before creating or locating the fixture. Do not claim any executed result from a command written in documentation.

## Reproducible fixtures

The version-controlled files in `examples/` are separate positive and mutation inputs. Use exactly the files below; do not paraphrase them and execute an unsaved prompt.

**Positive case** (working directory: `skills/clingo`):

```sh
python -m clingo examples/positive.lp 0
```

**Negative/mutation case** (same working directory, different saved input):

```sh
python -m clingo examples/negative.lp 0
```

**Expected outcome and judgment:** Positive has exactly two answer sets (choose(a), choose(b)); negative is `UNSATISFIABLE`. **Solver exit codes can be nonzero even for a valid UNSAT result.** Use the interpreter matching cp314 wheel in the bundled Python wheelhouse.

These are **statically prepared** test cases, NOT verified executions. Use `validation/SKILL_ACCEPTANCE_CASES.json` for the complete suite. Every run requires an exact input SHA-256, command, version, timeout, stdout/stderr and result status. Distinguish expected negative behavior from a tool error.

## Model limits and failure modes

当前 Drive wheel 是 cp314，不能用默认 Python 3.10–3.13 强行 pip 安装；ASP 答案集是模型，不等于被证明的业务偏好。

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
