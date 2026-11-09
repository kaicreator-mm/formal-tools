# Native CLI R4 — One-shot local acceptance and repair handoff

## Goal

The assistant authored full **local native CLI passthrough** for all 13 tool families, plus 53 typed common operations in JavaScript. The assistant can validate argv planning in the restricted V8 runtime, but **cannot spawn tools or run Node packages** there. This is the only remaining responsibility for a host-running local agent. The local agent should **repair failures and reverify in the same write set**, not submit a "validation-only" report.

## Authoritative source

- Repository: https://github.com/kaicreator-mm/formal-tools-skill
- Branch: \`feature/cli-full-coverage-r4\`
- PR: check the open R4 CLI coverage PR; **refresh actual HEAD before any modification**. Never trust a stale hardcoded SHA.
- Main baseline: \`46198e0c272f483ec35363be7a320ca08c5f6035\`
- Source: \`packages/runner/js/native-catalog.mjs\`, \`packages/runner/js/native.mjs\`, \`packages/runner/js/cli.mjs\`
- Tests: \`tests/native-catalog.test.mjs\`, plus pre-existing pure-JS tests
- Built-in runtime acceptance: \`scripts/native-acceptance.mjs\`
- User docs: \`docs/NATIVE_CLI_COVERAGE.md\`
- Existing runtime tracking: Issue #4

## Stage 1 — Node source and CLI gates

From the exact PR HEAD, run:

\`\`\`sh
node --test tests/*.test.mjs
node packages/runner/js/cli.mjs validate
node packages/runner/js/cli.mjs catalog
node packages/runner/js/cli.mjs catalog z3
node packages/runner/js/cli.mjs plan z3 solve --input skills/z3/examples/positive.smt2
node packages/runner/js/cli.mjs plan apache-jena query --data skills/apache-jena/examples/data.ttl --query skills/apache-jena/examples/query.rq
node packages/runner/js/cli.mjs plan tla-tlc check --input skills/tla-tlc/examples/TogglePositive.tla --config skills/tla-tlc/examples/Toggle.cfg
\`\`\`

Then run a Node/TypeScript typecheck after obtaining the declared dev dependencies. Verify official MCP SDK v2 import, stdio handshake and \`describe_native_cli\` / \`plan_native_cli\` without claiming an actual native proof merely from a plan. Use current official SDK docs if a declared API is incompatible. Do **not** invent an MCP handshake receipt.

## Stage 2 — 13 native versions, real help, and 26 fixtures

Tool binaries must already be installed from the Google Drive \`App/Formal-Methods/packages\` inventory or the project's approved artifact source. No automatic download, installation, restart or host setting change is part of the Runner itself.

Set any required \`FORMAL_TOOLS_BIN_DIR\`, \`FORMAL_ALLOY_JAR\` or \`FORMAL_ALLOY_BIN\`, \`TLA2TOOLS_JAR\`, \`FORMAL_CLINGO_PYTHON\` (upstream Python-based CLI), and \`FORMAL_PYSHACL_PYTHON\`. Java/JDK/.NET dependencies are external to the Node orchestrator.

\`\`\`sh
node packages/runner/js/cli.mjs native-help z3
node packages/runner/js/cli.mjs native-help lean4 --entry lake
node packages/runner/js/cli.mjs native-help tla-tlc --entry sany
node packages/runner/js/cli.mjs native-help apache-jena --entry riot
node packages/runner/js/cli.mjs native z3 -- -version
node scripts/native-acceptance.mjs validation/local-runtime-receipts
\`\`\`

The acceptance script attempts **13 doctors + 26 positive/negative cases**. Exit code 2 means incomplete/repair needed. Save exact Git commit SHA, binary version, model hashes, stdout/stderr/exit, and failure classification to Issue #4 / PR. Compare version-specific flags to actual \`native-help\`. For ALL 53 typed operations, only perform safe smoke checks for read-only operations; build/format/update/simulation/lsp may have side effects or long lifetimes, so do not run such commands against production files. Use isolated temporary fixtures where needed.

Special blockers to repair in the same branch:

- **Alloy:** never invoke Grafana Alloy by mistake. Set explicit official Alloy Analyzer JAR or binary. Confirm CLI \`exec\` flags and SAT solver distribution.
- **Jena on Windows:** verify availability of actual \`riot\`/\`arq\` command wrappers (the distributions may supply \`.bat\` scripts). If Node shell=false cannot launch the wrapper directly, implement safe Java class invocation; do not switch to an unrestricted shell.
- **Clingo / pySHACL:** CLI/MCP implementation is JavaScript; underlying third-party solvers may still invoke Python, and their interpreter ABI must match the offline artifact.
- **ProB / Alloy / TLC / Apalache:** parser status remains \`INCONCLUSIVE\` until tool-specific receipts support promoting a result; do not replace ambiguity with a blanket successful exit-code test.

## Done criteria

- 13/13 tool IDs have help/version invocation and **real binary fingerprints**;
- 26/26 fixture outcomes observed, with any accepted negative case explicitly classified;
- every typed operation's argv agrees with the *installed release*; unsupported operations are fixed or marked version-dependent, not silently reported as accepted;
- raw passthrough works only in trusted local CLI; never exposed through MCP;
- Node tests, typecheck, MCP stdio handshake and Woodpecker static check have separately recorded receipts;
- repairs committed to the same R4 PR, exact final HEAD documented;
- no GitHub Actions; no agent-binary patches; avoid any Windows physical configuration changes.
