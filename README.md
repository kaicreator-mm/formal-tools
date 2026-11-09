# Formal Tools Skill

**JavaScript-first, monorepo** for formal verification Skills, proofs, CLI, MCP, source fixtures and experience.

- **Pure JS core**: `packages/core/src/finite.mjs`, no Node/Python/native binary required. Supports finite DAG, writer-exclusivity, propositional CNF (up to 18 variables) and finite state invariants.
- **Node.js CLI**: `packages/runner/js/cli.mjs`, directly interprets model JSON via JS or invokes 13 native formal tools on committed fixtures.
- **MCP v2**: `packages/runner/js/mcp.mjs`, official TypeScript SDK v2 and ESM JavaScript, using the same pure/core + native Node adapter. **No Python dependency.**
- **Agent Skills**: `skills/`, 13 tool Skills and one routing Skill; these instruct an LLM but do not by themselves grant access to a local process.
- **User guide**: `docs/TOOL_GUIDES.md`, one guide per native tool.
- **Google Drive**: installers at [Formal-Methods/packages](https://drive.google.com/drive/folders/1GqX-Dn42Xi_STaoWYoq4aRXi3le2WPHB), Git stores indexes, scripts, models and lessons only.
- **Woodpecker**: `.woodpecker/formal-static.yaml` and [integration](docs/WOODPECKER_AGENT_INTEGRATION.md), Node.js CI execution without GH Actions.

## Quick start — no npm install for pure JS

```sh
node packages/runner/js/cli.mjs list
node packages/runner/js/cli.mjs validate
node --test tests/finite.test.mjs tests/runner.test.mjs
node packages/runner/js/cli.mjs pure dag --input validation/js/dag-positive.json
```

## Native tools and MCP

```sh
node packages/runner/js/cli.mjs doctor z3
node packages/runner/js/cli.mjs run z3 --case positive
npm install
node packages/runner/js/mcp.mjs
```

MCP uses `@modelcontextprotocol/server` v2 + Zod 4; not the v1 `@modelcontextprotocol/sdk` package. Requires a connected, running MCP host and Node.js 20+ compatible execution backend. The CLI itself only requires Node. Native solvers still require their corresponding binaries; changing the orchestration language does **not** turn Lean/cvc5/Dafny into pure JS.

## Verification truthfulness

Pure JS finite-model algorithms executed in this conversation's restricted JS runtime (1,705/1,705 deterministic and independent-reference checks); the saved source is scheduled for an exact Git readback run. Node CLI, native binary adapters, MCP transport and Woodpecker execution remain **NOT_RUN**, pending a Node host. None of these checks independently certifies ADS, DKE or DIS natural-language requirements. Do not infer universal proof from bounded models.

[Verification protocol](docs/VERIFICATION_PROTOCOL.md) · [CLI/MCP contract](docs/CLI_MCP_CONTRACT.md) · [Tool guides](docs/TOOL_GUIDES.md) · [Experience](experience/EXPERIENCE_LOG.md)

Previous Python runner sources were experimental and are superseded by the JavaScript implementation; no Python runner is required for CLI or MCP.
