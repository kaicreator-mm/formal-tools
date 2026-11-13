# #24 / R6 — in-container exact T4 module + native 3-phase experiments

**OUTPUT_LABEL:** `FORMAL_TOOLS_I24_TOOL_INTEGRATION_CONTINUE`

Authority and invalidation boundaries: main `12032f1d5a759dca5a1b24eedbefae2dfe01d3e0`; original portable PR #22 `3aa35b8c82545d8b234ae81f778b474173bff0d9` (OPEN, separate Writer). This document adds evidence to PR #77 only. It does **not** modify `portable/**`, PR #22, original fixtures, tool registry, CLI/MCP/SDK or product code.

## What actually ran

* Debian 13 x86_64, glibc 2.41, non-root UID 1000, tool bundle non-writable to user. Host Node 22.16.0; original supplied portable Node22 / Java21 and native ELFs; host CPython3.13 for explicitly marked alternatives. No Docker isolation.
* The complete **main** `tool-portfolio-t4.mjs` file was copied verbatim to a temporary worktree; independently checked with `git hash-object` = **`615b55bb0f2b5fd1e611865e1dc4c766f89d5ffe`**, identical to main blob. The already reconstructed PR #22 runner has Git blob `94909a645eee266549a6b17e42e5f4478d72aaee`, SHA256 `066674ca41414d1e80019218a5d20f404c0fef75785fb348fed313634720c1d3`, `runner_schema formal-tools/portable-verify/0.2`.
* Since GitHub source archive cannot be cloned from this container (no GitHub DNS/network), the gateway's **36-row Registry and DAG runtime inputs were projected** from exact main Registry/DAG fields: `id`, `origin`, `capability_ids`, `expected_version` (original blob IDs `faa89997…`, `250b84ae…`); the original 13 native ids were projected. This is a faithful input-field test of the actual gateway module, **not a full checkout or the original CLI/MCP/SDK binaries**.
* Eight actual candidate tools, under a **separately staged** overlay with additive `err` fixtures, returned gateway `FIXTURE_TECHNICAL_PASS_UNREVIEWED`, true runner exit 0, three TSV phases `pos/neg/err`, matching technical patterns and exit contracts. Per-tool metadata/fixture and receipt SHA256 in [R6 JSON](./T4_GATEWAY_NATIVE_SCOPED.json).

| Tool | Native/host execution context | pos/neg/err exits | T4 caveat |
| --- | --- | --- | --- |
| AFL++ 5.03c #25 | Original ELF, bundled native shim | 0/1/1 | add distinct bad-argument `err` fixture in PR #22 |
| ELK 0.6.0 #35 | Original Java21 bundle | 0/1/1 | neg currently a parser rejection, **not an independent ontology Oracle** |
| fast-check 4.10.2 #36 | Original bundled Node22 | 0/0/1 | invalid property throws `Error: Invalid property encountered`, **not** `TypeError` |
| Hypothesis 6.170.15 #39 | Verified Drive alternate wheelhouse, host CPython3.13 | 0/0/1 | original tool tar alone lacks `_hypothesis_globals` extension (import error); alternate source differs |
| Mesa 3.5.2 #42 | Original Mesa payload with host numpy/pandas site packages | 0/0/1 | absent from standalone minimal CPython; not self-contained |
| SimPy 4.1.2 #52 | Original package + host CPython3.13 | 0/0/1 | original Python runtime 294MB fetch blocked by 256MiB connector cap |
| NetworkX 3.7 #44 | SHA-verified original tar + host CPython3.13/site packages | 0/0/1 | staged `NodeNotFound` for unknown node, not original fixture |
| SymPy 1.14.0 #55 | SHA-verified original tar + host CPython3.13/site packages | 0/0/1 | staged `SympifyError` on malformed expression, not original fixture |

Previously recorded **CBMC #30** had a complete unmodified positive/negative/error original native Runner observation, still not independently T4 accepted. Altogether, nine tools have **scoped** three-phase technical data, only one using unmodified source fixture. This is **not** seven qualified T4 tools.

## Real fail-closed checks against exact gateway module

1. Existing native-ref `z3` rejected from candidate gateway (typed `TypeError`).
2. Unknown tool `bash` rejected (`RangeError`).
3. Root unset -> `NOT_RUN_FAIL_CLOSED`.
4. Wrong trusted runner SHA -> `PORTABLE_RUNNER_SHA256_MISMATCH`.
5. Wrong fixture SHA -> `FORMAL_PORTABLE_FIXTURE_SHA256_MISMATCH`.
6. Wrong metadata SHA -> `FORMAL_PORTABLE_META_SHA256_MISMATCH`.
7. **Unmodified** original fast-check 2-phase fixture, although its runner itself exits 0 and TSV says PASS, -> **`FIXTURE_NOT_QUALIFIED`**; the gateway correctly blocks promotion because no `err`.
8. AFL++ timeout budget 1 second -> gateway `FIXTURE_NOT_QUALIFIED`, `timed_out=true`, process group terminated; no false PASS.

## Source Writer repair handoff (one incremental cycle, no patch overlap)

The original PR #22 Writer should add the following changes under `portable/verification/cases/` and run native incremental tests on the *new exact source SHA*:

* `fast-check`: `err.mjs` imports `fast-check` and calls `fc.assert(null)`; add `EXPECT_ERR_VIA=node`, `EXPECT_ERR_ARGS='tests/fast-check/err.mjs'`, `EXPECT_ERR_EXIT=1`, `EXPECT_ERR_REGEX='Error: Invalid property encountered'`.
* `hypothesis`: `err.py` uses `@given(None)` and invokes decorated function; expect `hypothesis.errors.InvalidArgument` exit 1. Independently repair the original tar's missing `_hypothesis_globals` or make wheelhouse-vs-original provenance explicit.
* `simpy`: `err.py` uses `simpy.Environment().timeout(-1)`; expect `ValueError: Negative delay`, exit 1.
* `mesa`: `err.py` calls `mesa.Agent('not-a-model')`; expect `AttributeError:.*register_agent`, exit 1. Repair/version-pin bundled numpy/pandas dependencies before portable T4.
* `aflpp`: `EXPECT_ERR_ARGS='--definitely-not-an-afl-flag'`, expect `invalid option`, exit 1.
* `elk`: `EXPECT_ERR_ARGS='-c -i tests/elk/does-not-exist.ofn -o $FT_TMP/invalid.ttl'`, expect `FileNotFoundException`, exit 1. Separately improve ontology semantic negative beyond parser rejection.
* `networkx`: stage `err.py` with `G=nx.Graph(); G.add_edge(1,2); nx.shortest_path(G,source='missing-node',target=2)`; expect `networkx.exception.NodeNotFound:`, exit 1.
* `sympy`: stage `err.py` with `import sympy as sp; sp.sympify('sin(')`; expect `sympy.core.sympify.SympifyError:`, exit 1.

**Do not merge these local fixture edits into PR #77**: they belong to the separate PR #22 Writer and need fresh Native, CI, Source-First review at the actual changed package SHA. Reuse originals for unchanged tests. The signed input/metadata hashes for each staged fixture cannot attest independent publisher provenance.

## Qualification

* Source T4 interface: merged in main; original 13 = 53 typed ops, 23 candidate bounded `doctor/verify-fixture` routes. Existing JS tests / Woodpecker separate.
* This container: real exact gateway **module**, with projected Registry/DAG and staged fixtures, 8/8 scoped technical execution observations; **not** full original main CLI/MCP/SDK gateway replay.
* Newly independently qualified Native T4 = **0/23**, independent semantic T5 = **0/36**, T6 remains open. Historical 19/36 original tar and 34/36 alternate-callable stats stay separate.
* Container execution should remain preferred; external/local handoff only for unmet runtime/download/host gates (no unnecessary duplicate validation).


## R7 evidence correction (2026-11-14)

The R7 exact-source review downgraded AFL++ and ELK from `FIXTURE_TECHNICAL_PASS_UNREVIEWED` to `EXECUTION_OBSERVED_ASSERTION_INCOMPLETE`. Their recorded process exits and legacy receipt hashes are preserved, but the current assertions do not establish a valid three-phase fixture PASS. See [R7 evidence index](../r7/README.md) and [machine-readable exact-source receipt](../r7/EXACT_PR22_NATIVE.json). No Portable source files were modified by this evidence-only PR.
