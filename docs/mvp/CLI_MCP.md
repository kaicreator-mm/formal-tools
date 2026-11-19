# CLI and MCP quickstart (i180 / V4, Part A)

How to drive the formal-tools JavaScript surface: the unified Node CLI, the
MCP stdio server, and the real stdio acceptance smoke that CI runs. Status
semantics (probe receipts are technical evidence, never T3/T4/T5/T6 or
business acceptance) follow `docs/CLI_MCP_CONTRACT.md`.

## Run the CLI

The `formal` npm script wraps `packages/runner/js/cli.mjs`; pass arguments
after `--`:

```sh
npm run formal -- list                       # 13 native adapters + portfolio + pure engines
npm run formal -- validate                   # static registry/source validation (STATIC_PASS)
npm run formal -- catalog z3                 # typed CLI operation schemas
npm run formal -- info z3                    # tool profile
npm run formal -- plan z3 solve --input skills/z3/examples/positive.smt2   # validated argv, NO execution
npm run formal -- pure dag --input validation/js/dag-positive.json         # pure JS finite-model check
npm run formal -- capabilities summary       # frozen G1 discovery registry summary
npm run formal -- capabilities match --cap logic.smt                       # capability -> validated tools
```

`plan` returns planned argv with `runtime: NOT_RUN`; it never executes.
`exec`/`invoke`/`native` launch native binaries and require an installed,
pinned local toolchain — out of scope for the JS-only CI lane.

## Start the MCP server (stdio)

Requires dependencies (`npm ci` once). stdout is reserved for the MCP
newline-delimited JSON-RPC transport; diagnostics go to stderr.

```sh
npm run formal:mcp        # node packages/runner/js/mcp.mjs
```

Any MCP host can attach over stdio (`@modelcontextprotocol/server` v2,
protocol `2025-06-18`).

## Registered MCP tools (exactly 14)

1. `list_formal_tools` — 13 native adapters + candidate portfolio + 4 pure engines.
2. `validate_formal_source` — static validation, no proof execution.
3. `inspect_formal_tool` — tool contract + fixture expectations (read-only).
4. `probe_formal_tool` — `--version`/`--help` probe attempt, fails closed.
5. `run_formal_fixture` — committed positive/negative fixture only.
6. `describe_native_cli` — named CLI operations, no execution.
7. `inspect_native_installation` — read-only installation discovery.
8. `plan_native_cli` — validated argv plan, `runtime: NOT_RUN`.
9. `list_portfolio_tools` — discovery metadata for all 36 tools.
10. `match_formal_capabilities` — deterministic capability-ID → validated-tool
    match over the sha256-bound r176/r181 container probe receipts
    (input: `capabilities: string[1..16]`, optional `include_not_verified`).
11. `inspect_portfolio_tool` — read-only portable installation metadata.
12. `verify_portable_fixture` — pinned portable pos/neg/err fixture via the
    SHA-pinned runner.
13. `run_portfolio_operation` — the only admitted execution lane: Highs
    1.15.1 `solve-lp` with a bounded typed LP model (no raw argv/shell).
14. `verify_formal_model` — pure JS finite-model checks (`dag|writers|cnf|states`).

Every tool rejects execution-shaped arguments (raw argv/shell/cwd) at the
zod schema or handler boundary and fails closed.

## Run the real stdio acceptance smoke

```sh
node scripts/mcp-acceptance.mjs
```

This spawns `packages/runner/js/mcp.mjs` as a real child process and speaks
newline-delimited JSON-RPC over stdio — the same transport an external MCP
host uses: `initialize` → `tools/list` → `tools/call` across all 14 tools,
including fail-closed assertions (unknown capability ID, schema-invalid
`capabilities: []`, raw `argv` extension, unknown tool id). It writes a
receipt to `validation/local-runtime-receipts/mcp-acceptance.json` and exits
0 only when every assertion holds; CI runs it as the `mcp-stdio-smoke` step
in `.woodpecker/formal-static.yaml`. No native binaries are needed.

A static offline parity guard (`tests/workflow-interfaces-smoke.test.mjs`)
additionally pins that `mcp.mjs` `registerTool` names ==
`EXPECTED_TOOLS` == `registry/INTERFACES.json` `mcp_tools` == exactly 14.

## What is NOT here yet (Part B)

Workflow-level `plan`/`execute` CLI/MCP commands (issue #180 Part B) are not
implemented in this round; they arrive after the V2/V3 merges. Today's CLI
`plan` is argv planning only and nothing in the MCP surface accepts arbitrary
commands.
