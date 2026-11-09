# Validation

Status: `NOT_RUN` for real executions in current chat. Each tool must pass SHA-256, version detection, one positive and one negative/mutation test in Linux; preserve exact command, exit code, stdout/stderr and bounded scope. Do not confuse model search with universal proof. Keep large receipts in Google Drive Formal-Methods/validation-receipts and link their hashes to Git.

## R1 self-audit (2026-11-09)

The authored Skill text and fixtures were statically checked at source exact HEAD `2df9e94e516caaaa4b261ae0ae4175ef19aa6983`. Result: 14/14 Skill names/frontmatter; 29/29 example inputs present; 13/13 intentional mutation-pair textual checks; 74/74 structural checks; 6 documented router mappings. This is **not executable proof or parser validation**. Native proof engines could not be started because container execution returned `ClientError`. See `validation/STATIC_AUDIT_R1.json` and `validation/SKILL_ACCEPTANCE_CASES.json`. Runtime acceptance remains **NOT_RUN** for all 13.

## R2 CLI, MCP and Woodpecker source candidate

13 native-tool adapters and one shared Python CLI/MCP server were added as source at packages/runner. Official MCP Python SDK v2 supplies MCPServer, but no MCP host, solver binary or Woodpecker agent runtime is currently connected from this environment. See docs/CLI_MCP_CONTRACT.md and docs/WOODPECKER_AGENT_INTEGRATION.md. The static Woodpecker job tests source only, never proof-engine acceptance. RUNTIME/CI/MCP verdict: NOT_RUN.
