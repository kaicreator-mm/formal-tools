# Formal Tool Runner R2

One source-only Python 3.11+ execution core for 13 proof engines, with a CLI and optional MCP Python SDK v2 adapter. Shared executable selection is limited to an explicit allowlist and committed fixture files; shell=False and per-command 1–120s timeouts. No arbitrary model upload, no remote command execution.

## CLI quickstart

From repository root (no pip install needed for these source-only checks):

    python3 -m packages.runner list
    python3 -m packages.runner validate
    python3 -m unittest discover -s tests -v
    python3 -m packages.runner inspect z3
    python3 -m packages.runner run z3 --case positive --timeout 30
    python3 -m packages.runner run z3 --case negative --timeout 30
    python3 -m packages.runner suite --timeout 30

The suite **requires all 13 tool runtimes installed**. Static validation only inspects repository files and must never be counted as an executable verification. Exit codes 0 = expected output or static PASS; 1 = static FAIL; 2 = incomplete/failed runtime. No bash, sudo, network downloader, npm or Docker is required for CLI static validation.

## Tool dependencies

- FORMAL_TOOLS_BIN_DIR: optional directory containing cvc5, z3, lean, souffle, vampire, apalache-mc, probcli, dafny, riot, arq and other executables.
- FORMAL_CLINGO_PYTHON: Python interpreter with compatible Clingo wheel (offline bundled Clingo is cp314).
- FORMAL_PYSHACL_PYTHON: Python interpreter with pySHACL and dependencies (Drive offline bundle is py313).
- TLA2TOOLS_JAR: absolute path to tla2tools.jar.
- FORMAL_ALLOY_JAR: optional Alloy jar path if not using the alloy CLI.

Install all binaries from verified Drive packages/INDEX.json archives; the six-tool offline installer does **not** install all 13 tools.

## MCP (optional, *not* natively supplied by every solver)

Use the current official MCP Python SDK v2 API:

    python3 -m pip install 'mcp>=2,<3'
    python3 -m packages.runner.mcp_server

The local stdio server exports three tools: list_formal_tools, inspect_formal_tool, run_formal_fixture. To inspect during development, use the official SDK's MCP Inspector workflow with an appropriate environment. This does not automatically connect the MCP server to ChatGPT; a compatible MCP host must launch/connect it explicitly.

API reference: https://py.sdk.modelcontextprotocol.io/
Run transport reference: https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/run/index.md

## Limitations, honesty and risk

- Only fixed positive and negative model files in Git are executable through R2. Application-specific generated models are NOT accepted yet.
- Some engine formats (Alloy, ProB) lack a receipt-verified parser. They intentionally return INCONCLUSIVE.
- On actual runtime attempts, record argv, process exit, SHA-256 stdout/stderr, bounded text excerpt, version and input hashes; these do not themselves prove model fidelity.
- Result fields distinguish tool_outcome, test_verdict, and claim_verdict. The demo runner always sets claim_verdict=NOT_EVALUATED.
- No process-level OS sandbox inside the Python CLI; isolation, CPU/memory limits and network restriction belong to the CI container/host.
- Source and fixture tests have NOT been executed in the ChatGPT container, and 13-tool native runtime checks remain NOT_RUN. Do not promote to runtime-verified status without real receipts.
