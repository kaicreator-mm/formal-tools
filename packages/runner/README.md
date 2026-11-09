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
