# TypeScript / JavaScript CLI and MCP contract — R3

## One codebase, three contexts

1. **Pure JavaScript**: `packages/core/src/finite.mjs` contains finite algorithms only; it uses no Node APIs, Python, native process spawning, network or WASM.
2. **Node.js CLI**: `packages/runner/js/cli.mjs` maps user commands to the pure core or the allowlisted native adapter `native.mjs`.
3. **MCP v2**: `packages/runner/js/mcp.mjs` is an ESM JavaScript implementation using **official TypeScript SDK v2** `@modelcontextprotocol/server` with `serveStdio`, Zod v4 schemas, and the same adapters.

TypeScript support is provided through JSDoc/checkJs and `finite.d.mts` declarations. No transpiler is needed to run JavaScript.

## CLI

```sh
node packages/runner/js/cli.mjs list
node packages/runner/js/cli.mjs validate
node packages/runner/js/cli.mjs pure dag --input validation/js/dag-positive.json
node packages/runner/js/cli.mjs pure writers --input validation/js/writers-negative.json
node packages/runner/js/cli.mjs pure cnf --input validation/js/cnf-unsat.json
node packages/runner/js/cli.mjs pure states --input validation/js/states-negative.json
node packages/runner/js/cli.mjs inspect z3
node packages/runner/js/cli.mjs doctor z3
node packages/runner/js/cli.mjs run z3 --case positive
node packages/runner/js/cli.mjs suite --timeout 30
```

- Pure mode requires only JS execution and a JSON model.
- Native mode calls installed executables via `spawn(...,{shell:false})`, fixed versioned examples only; no arbitrary command path accepted from MCP.
- The 13 native engines and their installers are separate from pure JS.
- Doctor detects whether a program can be invoked, not whether its semantics are certified.

## MCP v2 tool registry

Run `npm install` then `node packages/runner/js/mcp.mjs` in a real Node.js host.

- `list_formal_tools()`: 13 native + four pure engines.
- `validate_formal_source()`: static registry and fixtures (not proof execution).
- `inspect_formal_tool(tool)`: executable contract.
- `probe_formal_tool(tool,timeout_s)`: version/help probe.
- `run_formal_fixture(tool,case,timeout_s)`: native fixed demo model.
- `verify_formal_model(engine,model)`: **pure JS finite-model verifier**; accepts structured JSON and runs without native tools but requires an MCP host to expose the endpoint.

Official current TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/v2/ . v2 uses `@modelcontextprotocol/server`; v1 used `@modelcontextprotocol/sdk`. Stdout is reserved for MCP, so diagnostics must go to stderr.

## Evidence semantics

`tool_outcome` is raw result, `test_verdict` is expected fixture behavior, and `claim_verdict` represents a business claim (always `NOT_EVALUATED` for these demos). SAT is not a theorem proof. A finite DAG checker only proves facts about the supplied explicit graph. UNKNOWN/timeout/error is not PASS. A negative counterexample may be an expected *test* result without proving a natural-language claim.

Native binary runtime, MCP handshake/host discovery and Woodpecker CI remain NOT_RUN until real executable receipts exist.
