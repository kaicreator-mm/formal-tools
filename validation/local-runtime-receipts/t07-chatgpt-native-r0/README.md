# FT-T07 Clingo 5.8.3 — ChatGPT Debian13 real Native → JS/TS technical receipts (R0)

**Owner**: [#31](https://github.com/kaicreator-mm/formal-tools/issues/31), portfolio [#24](https://github.com/kaicreator-mm/formal-tools/issues/24). Historical original-13 runtime [#4](https://github.com/kaicreator-mm/formal-tools/issues/4) is CLOSED with an explicit Clingo INCONCLUSIVE exception. This file does **not** assert Product #11 Source/Oracle/Solution qualification.

## Source and asset pins

- **Code executed:** exact GitHub connector text at commit `625933dec9016ac10a0c113561c3e3e9d045475d`; runtime modules `native-catalog.mjs`, `native.mjs`, `sdk.mjs`, `tool-manager.mjs` and native fixture content reassembled in a temporary Debian13 environment. **This is not a clean `git clone` or independent host identity attestation.**
- A subsequent regression-test-only correction (checkJs union narrowing) led to `a10c9e9c814a021114da1d434344f5df09b02e37`, without changing the executed runtime modules.
- Drive canonical archive: [clingo-5.8.3-linux-x86_64.tar.zst](https://drive.google.com/file/d/1bd6bUrcAeLWok20B7ed-D2FGlnLcCHwW/view); SHA256 `496254a850cb3dd988aaf3662845f0fe97cf2b2d33535ef6eed44274f140ea3d` equals Drive `App/packages/SHA256SUMS`. `zstd -t` and tar structure integrity checked.
- Native binary SHA256 `d6250068a6cb2c931f952f5554f7aa3a07491975c10832b577be322f8371ad41`; original portable shim SHA256 `0082798ca3075daeeddcaf7b55162cdf7518baad8442621a38754c8d01ee287f`. The shim sets its own library path, then execs the original binary; no installer alteration.
- Original Git fixtures `positive.lp` SHA256 `cfc913da42ce5a4f5cbc342658570eeed64cddcf68e6f504918dc544608bd5b1`, `negative.lp` SHA256 `daefe8db8080b104b3884a515fee1c988760475ba00f26ccd461ba2fd3540520`.

## Real tool observations

| Gate | Executed result |
| --- | --- |
| Native command at non-root Linux host | `clingo 5.8.3 --version`/help exit=0 |
| Positive original fixture | `SATISFIABLE`, exactly two models `choose(a)`/`choose(b)`, **exit=30** |
| Negative original fixture | `UNSATISFIABLE`, **exit=20** |
| Invalid ASP parser input | Syntax rejected, stderr parser error, **exit=65** |
| Updated JS `doctor("clingo")` | `EXECUTED` exit=0, version `5.8.3` |
| Updated JS `runFixture` positive + negative | Both **PASS** with inputs SHA and stdout/stderr SHA; exits 30/20 |
| Updated `executeNativePlan` typed | `EXECUTED`, technical `SATISFIABLE`, raw `NONZERO_EXIT`, exit=30 |
| Updated `invokeTool` SDK | `EXECUTED`, `SATISFIABLE`, `NONZERO_EXIT`, exit=30, stream SHA |
| Updated `invokeStagedTool` SDK | `SATISFIABLE`, exit=30, `STAGED_IN_PRIVATE_WORKSPACE`, artifact scan `COMPLETE` |
| **Actual non-root JS/SDK run** | Repeated with Linux uid **65534**; native positive/negative and SDK/Staged all PASS scoped; original bundle read-only |

Non-root JS fixture positive raw stdout SHA256 `bd0d8dc4337eb1b5e49e444e646787267f6d5bcd7da1823a68b4552cc02ce2f7`, negative stdout SHA256 `16cc4e8e80573c63894b623efb23afe25fc5bbfa225c2d78aba0e3c5abd9dd14`; both empty stderr SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Non-root Node adapter receipt SHA256 `c50f4c2a1021ce7c25fa205ffc878d1923d225a9c9839b63aff393b482a0e239` (conversation artifact, not copied into Git).

## Incremental source regression and release gates

- Running exact transferred `a10c9e9...` modified-test content against unchanged runtime modules: local **73/73 Node v22.16.0 selected unit tests PASS, 0 FAIL** (12 test files), including Clingo, registry, SDK, staged, workspace and T4 gateway. Fixture sources and the two T4 registry metadata JSON files were copied from the same GitHub commit, not simulated by mock GitHub data.
- Local **TypeScript 5.8.3 checkJs of the Clingo/Native and neighboring modules + focused tests PASS**. The original PR failed this gate because the new test accessed `runFixture().executions` without narrowing its `BLOCK_OR_REPAIR` return possibility. The Writer added explicit fail-closed `"executions" in` guards; source SHA `a10c9e9...`.
- Actual remote **Woodpecker push #577 SUCCESS and pull request #578 SUCCESS** at `a10c9e9c814a021114da1d434344f5df09b02e37`; these run project Node24 test+mandatory TypeScript, no GitHub Actions.
- **Not claimed here:** newly installed host **MCP stdio invocation** (MCP npm runtime is not provisioned in this ChatGPT container), Windows/native host equivalence, independent non-Writer final SHA review, portfolio 23-tool T4, Product Oracle. The historical #4 MCP handshake is a different SHA/protocol scope.
- This Markdown itself is a later documentation-only commit and requires a fresh final exact-HEAD CI readback. Do not merge or mark #31 T4 PASS_SCOPED until independent Reviewer audits the final SHA and accepts the bounded host/MCP evidence limits.

## Reproducible host mode

Set `FORMAL_CLINGO_BIN` to an **absolute path to the pinned shim** (not arbitrary PATH name), then invoke `node packages/runner/js/cli.mjs doctor clingo`, `node packages/runner/js/cli.mjs run clingo --case positive`, `... --case negative`, and staged SDK `invokeStagedTool`. The original `python3 -m clingo` remains the default when `FORMAL_CLINGO_BIN` is unset. No shell interpolation or raw MCP subprocess is added.
