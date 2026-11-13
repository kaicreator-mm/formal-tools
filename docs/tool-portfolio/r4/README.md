# Issue #24 / R4 T4 additive integration (source-only checkpoint)

Authority: #24 tool portfolio, #11 Product G0–G6, #4 legacy runtime acceptance. Source bundle and build Writer remain PR #22 at `15aad39c23a6218c4adc0e07e5891e893f9b1d03`; no `portable/**` edits here.

## Actual boundaries

* All **36** tools are discoverable through one Capability-linked list backed by `registry/PROBLEM_CAPABILITIES.json`. The 13 existing native tools keep `native-catalog.mjs`, their **53** typed operations, 9 existing MCP tools and SDK behavior unchanged. No existing acceptance receipt is silently promoted or invalidated by discovery.
* The **23** `candidate` tools gain **one shared**, strictly bounded portable gate: `doctor` and `verify-fixture`, not arbitrary native operations. `verify-fixture` can run only the installed, versioned `tests/<tool>/expect.sh` pos/neg/err contract via PR #22's `bin/tool-runner verify <tool-id>`. This includes source adapters for native, Java, Python, etc. at the portable runner layer, but **does not** mean their model-specific typed operations are admitted.
* CLI adds `portfolio list|describe|inspect|doctor|verify`; SDK exports five portfolio functions; MCP adds `list_portfolio_tools`, `inspect_portfolio_tool`, `verify_portable_fixture`. One MCP server, no new server per tool. No MCP raw argv, user-selected executable, shell or model filename.
* Discovery and static file inspection never launch tools. Linux x86_64 real fixture execution requires an **absolute** `FORMAL_PORTABLE_ROOT`, a **trusted externally pinned** `FORMAL_PORTABLE_RUNNER_SHA256` and regular tool metadata/launcher/fixture files. Runner digest mismatch, absent files, version drift, timeout, truncated output, missing pos/neg/err, wrong schema or mismatched outcomes fail closed. Per-phase exit/label and SHA-bound runner, metadata, fixture contract and TSV receipt are returned as **technical observations** only.
* Do not calculate the expected runner SHA from an untrusted installed runner and then treat it as authentication. Obtain it from independently qualified source/transport provenance. Test-runner mock receipts are **synthetic contract tests**; they are not evidence that a real upstream binary ran.

## Validation and qualification

See [T4_INTEGRATION.json](./T4_INTEGRATION.json): 36 catalog entries, 13 historical native adapters, 23 candidate shared interface routes, **zero newly native T4-qualified** and **zero T5 semantic-qualified**. Independent Source-First review, real Docker/Debian13 Node/CLI/MCP/SDK and Woodpecker Exact-SHA results are separate exit gates. R3/R4 original 19/36 and 34/36 with alternatives remain scoped T3 evidence only, not a portable PR #22 fresh native PASS.

The new test checks cross-registry parity, candidate-only routing, CLI discovery and a synthetic local runner to verify digest pinning, case parsing, process result and negative failure behavior. The pre-existing 13/53 parity tests still apply. The `tests/tool-contract-parity.test.mjs` MCP assertion now explicitly describes the 12 allowed tool names.

## Next legal progression

1. Await independent source audit of this branch and existing PR #22, repair actual P0/P1 by relevant single Writer, obtain exact-SHA Woodpecker green (not GitHub Actions).
2. On a healthy Linux host, mount only the verified unchanged portable bundle; run the bounded candidate gate across tools whose T3 archive and fixture provenance actually qualifies. Preserve stdout/stderr/exit/process budget, TSV and input/contract hashes.
3. Where the fixture is fully reviewed, add genuine model-specific typed operations in priority/need order. Validate native positives, negatives, malformed inputs and permission boundaries through shared CLI/SDK and MCP; do not transfer 23 generic `verify-fixture` registrations into 23 formal T4 PASS results.
4. Route explicit defects to #41 Lean4, #59 Why3, #38 HiGHS, #45 nuXmv, #48 ProB, #57 Tree-sitter, #37 Fast Downward and shared PR #22 Writer as applicable. Do not reopen #7 or #14.
