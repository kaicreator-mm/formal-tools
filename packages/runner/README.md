# Node.js CLI + MCP

All active CLI and MCP code is **JavaScript ESM**. No Python invocation or dependency is required.

- `js/cli.mjs` — Node CLI, supports `list`, `validate`, `inspect`, `doctor`, `run`, `suite`, `pure`.
- `js/native.mjs` — allowlisted fixed models mapped to 13 native tools via `node:child_process`.
- `js/mcp.mjs` — official MCP TypeScript SDK v2, six tools, stdio transport.
- `../core/src/finite.mjs` — dependency-free pure JS algorithms for DAG, writer exclusion, CNF and finite state.

Run `node packages/runner/js/cli.mjs validate` without `npm install`. Install MCP SDK separately using `npm install`, then run `node packages/runner/js/mcp.mjs` on a capable host. A new ChatGPT conversation cannot call an unconnected MCP server.

Native environment variables: `FORMAL_TOOLS_BIN_DIR`, `FORMAL_CLINGO_PYTHON`, `FORMAL_PYSHACL_PYTHON`, `TLA2TOOLS_JAR`, `FORMAL_ALLOY_JAR`. The *orchestrator* uses no Python; the **upstream pySHACL and Clingo themselves are Python-based programs**, so native calls may invoke their Python interpreter. These are optional depending on which native solver is requested.

Execution gates:
- Pure JS: finite algorithms can execute within a restricted JavaScript evaluator.
- Node CLI: full program/IO requires a Node process and filesystem.
- MCP: live SDK package + Node host + host connection required.
- Native solvers: binaries required; outputs must be verified.
- Current saved Node/MCP code: **runtime NOT_RUN** in ChatGPT execution environment.

## R4 native CLI surface

`native-catalog.mjs` defines 53 common operations for 13 CLI families and type-checks their arguments in pure JS. `cli.mjs` now exposes `catalog`, `plan`, `exec`, `native-help` and trusted-local `native` pass-through.

```sh
node packages/runner/js/cli.mjs catalog
node packages/runner/js/cli.mjs plan z3 solve --input problem.smt2
node packages/runner/js/cli.mjs exec z3 solve --input problem.smt2
node packages/runner/js/cli.mjs native z3 -- -h
```

New MCP interfaces `describe_native_cli` and `plan_native_cli` **return metadata/argv only**. Raw native execution remains local CLI only. Run `node --test tests/native-catalog.test.mjs` on a Node host; native acceptance uses `node scripts/native-acceptance.mjs` and requires actual binaries.

## R1 Tool Manager and experimental SDK

- `js/native-catalog.mjs` is the sole authoritative registry for the 13 tool IDs, upstream CLI entrypoints, 53 typed operations and runtime probe profiles.
- `js/tool-manager.mjs` provides read-only PATH/JAR/Python/Windows-wrapper diagnostics; it does **not** install or launch any tool.
- `js/sdk.mjs` is an **experimental trusted-Node** facade: `listTools`, `toolDetails`, `planTool`, `whereTool`, `whereAll`, `invokeTool`; its normalized technical result is in `js/tool-result.mjs`.
- `js/cli.mjs invoke` uses the same SDK facade. It is **not** exposed as arbitrary native execution through MCP.
- This experimental SDK is currently **source-only**. There is no stable npm export promise until Node/TS/native host acceptance and packaging review. Callers must prepare existing working directories and understand upstream tools may write beside input files; no general model dependency copy or artifact collection is claimed yet.

[Tool Manager guide](../../docs/TOOL_MANAGER.md) · [Experimental SDK contract](../../docs/TOOL_SDK.md) · [R1 development plan](../../docs/implementation/r1/DEVELOPMENT_PLAN.md)
