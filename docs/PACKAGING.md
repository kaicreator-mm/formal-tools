# Skills-only plugin vs CLI/MCP package

**Skills-only plugin**: root `plugin.json` plus `skills/*/SKILL.md` can be packaged under a top-level `formal-methods/` directory. This does not install proof binaries, CLI or MCP execution access.

**CLI/MCP implementation**: root `package.json` and `packages/core` + `packages/runner`; JavaScript ESM + optional TypeScript static check. `node packages/runner/js/cli.mjs` requires no npm dependencies for pure/native CLI. MCP requires `npm install` (official SDK v2 + Zod 4), then a host launches `node packages/runner/js/mcp.mjs` with stdio.

A zipped Skill plugin does not by itself make a remote MCP endpoint available in ChatGPT. A live execution service and explicit connection must be separately established. Runtime tests/host handshake remain NOT_RUN.
