# Woodpecker Agent integration — JS/TS R3

**Use a Node.js Pipeline Step; do not modify the Woodpecker Agent binary.** Woodpecker 3.18 agents schedule existing Docker/Local backend steps. CI invokes the deterministic Node CLI; MCP is optional and normally *not* needed for CI.

## Workflow selection

- **Pure-JS static and finite proofs:** `.woodpecker/formal-static.yaml`, image `node:24-alpine`. Runs Node built-in test runner + source validation. No npm install needed.
- **Native proof tools:** `examples/woodpecker/formal-runtime-template.yaml` is deliberately outside `.woodpecker/` until a digest-pinned image containing installed binaries is verified. It invokes `node packages/runner/js/cli.mjs suite --timeout 30`.
- **MCP connected LLM Agent:** runs `node packages/runner/js/mcp.mjs` in a separately managed execution host; no requirement to embed MCP inside the Woodpecker agent.

## CI evidence gates

1. Source/fixtures checks and pure-JS positive/negative scenarios.
2. Build and pin Docker image digests, validate publisher checksums for actual formal tools.
3. Execute version probes and native 26 cases, classify expected negative outputs separately.
4. Verify real ADS/DKE/DIS requirements with independent semantic coverage review.
5. Treat INCONCLUSIVE/UNKNOWN as non-passing, always keep bounded/unbounded scope.

Keep CI resource budgets and isolation at the Docker step boundary; the CLI's per-tool timeout is not a complete CPU/memory guard. No GitHub Actions, no modification to the Woodpecker agent binary, no automatic host-side physical effects.

References:
- https://woodpecker-ci.org/docs/3.18/development/architecture
- https://woodpecker-ci.org/docs/3.18/usage/intro
- https://woodpecker-ci.org/docs/3.18/usage/plugins/overview

**Status:** YAML and program source ready for real Node CI; not yet executed by Woodpecker.
