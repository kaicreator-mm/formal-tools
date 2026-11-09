# Validation

Current R3 design cleanly separates three gates:

- **PURE_JS_VERIFIED**: restricted JS evaluator executed 1,705 finite-algorithm checks (1,200 CNF, 500 DAG, 4 direct cases, 1 computational-budget case) for DAG, writer exclusivity, CNF and finite states; examples and code are checked in. Scope is explicit finite models only.
- **NODE_NOT_RUN**: Node.js filesystem, CLI process and native solver invocation are not available in the current ChatGPT code-mode JS runtime.
- **MCP_NOT_RUN**: MCP TypeScript SDK v2 and stdio transport sources exist, but the server has not started or connected to an MCP host.
- **WOODPECKER_NOT_RUN**: CI YAML source is committed but not executed.
- **NATIVE_TOOLS_NOT_RUN**: 13 real engines have not executed in this environment.

No solver PASS is asserted from static source checks. See `registry/INTERFACES.json`, `docs/CLI_MCP_CONTRACT.md` and `validation/SKILL_ACCEPTANCE_CASES.json`.

Commands for Node-enabled host:

```sh
node --test tests/finite.test.mjs tests/runner.test.mjs tests/property.test.mjs
node packages/runner/js/cli.mjs validate
node packages/runner/js/cli.mjs pure dag --input validation/js/dag-positive.json
```
