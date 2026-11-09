# CLI and MCP contract (R2)

## One engine inventory, two caller surfaces

                  LLM / developer / Woodpecker pipeline
                                  |
                     formal-tool-router Skill
                                  |
                     formal-runner Python core
                      /                    \
              CLI (argparse)          MCP adapter (v2)
                      \                    /
                 fixed command per tool and case
                                  |
                        Linux tool processes
                                  |
                          structured receipt

Each of 13 tools is exposed through the same public API; the project does **not** copy or promise unofficial upstream MCP servers. Official Python MCP SDK v2 replaced the v1 FastMCP high-level import with MCPServer. The v2 stdio host is deliberately offline/local by default.

Native CLI (Z3/cvc5/etc) does solver execution. The Python CLI decides when/how to invoke version-pinned solvers. The MCP adapter only exposes this same execution service to an LLM via a host connection.

## Commands

    python3 -m packages.runner list
    python3 -m packages.runner validate
    python3 -m packages.runner inspect cvc5
    python3 -m packages.runner run cvc5 --case positive
    python3 -m packages.runner run cvc5 --case negative
    python3 -m packages.runner suite --timeout 30

MCP tools:

1. list_formal_tools() -> registered engines + static status
2. inspect_formal_tool(tool: str) -> CLI recipe, expected observations, compatibility
3. run_formal_fixture(tool: str, case: str, timeout_s: int=30) -> execution receipt

The only accepted cases are positive and negative, and tool IDs are allowlisted from registry. The MCP surface intentionally rejects arbitrary shell, uploaded source, arbitrary executable paths and Git mutations; a future arbitrary-model capability needs separate security, schema and model-fidelity work.

## Outcome envelope

- run_status: EXECUTED or NOT_RUN (attempt was or was not launched)
- tool_outcome: raw inference (SAT, UNSAT, THEOREM, COUNTEREXAMPLE, CYCLIC, etc), or ERROR/UNPARSED
- test_verdict: PASS / FAIL / INCONCLUSIVE
- claim_verdict: always NOT_EVALUATED for these examples
- input_sha256: fixed committed model inputs
- executions: argv, exit_code, timed_out, elapsed_ms, stdout_sha256, stderr_sha256 and excerpt

Rules:
- Negative test finding expected counterexample can have test_verdict=PASS and an engine counterexample. Do not turn it into claim PASS.
- Timeout, unsupported CLI flag, missing binary, unparsed output and UNKNOWN are not PASS.
- Command vectors are passed using subprocess.run(shell=False), not interpolated into a host shell.
- First runtime acceptance must verify process success/failure, exact expected evidence and CLI version; static parser tests are only source checks.
- Run against trusted committed models only; do not expose arbitrary system capabilities through MCP.

## Coverage state

13/13 tools have fixed adapter entries and user guides in source. Automatic result parsing is conservative for Alloy/ProB; version-specific output must be verified against real release receipts before enabling CI pass decisions.

Official SDK: https://py.sdk.modelcontextprotocol.io/
SDK running reference: https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/run/index.md
Protocol change reference: https://py.sdk.modelcontextprotocol.io/whats-new/

R2 state: IMPLEMENTED_AS_SOURCE / EXECUTION_NOT_VERIFIED / MCP_HOST_NOT_CONNECTED.
