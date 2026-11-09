# Formal Tools

**formal-tools** 是维护与封装形式化、逻辑化工具的 JS/TS Monorepo，目标是让原生工具更易于安装、配置、调用、集成、升级与排错。

本项目**只负责工具层**：官方命令/版本、环境诊断、CLI/MCP/SDK 接入、工具运行、输出和产物、兼容性与回归。它**不决定该用什么工具做什么业务、不生成业务模型、不设计验证策略或领域模拟场景、不评价消费项目的业务结论**。

`skills/` 是可选 Agent 接入层，与 CLI、MCP、SDK 并列，而不是产品定位。可以为 `domain-simulator` 等项目提供工具接口，但场景、语义、模拟与演化由消费项目负责。

[项目边界](docs/PROJECT_SCOPE.md) · [R1 维护与易用性优化计划](docs/roadmap/FORMAL_TOOLS_MAINTENANCE_PLAN_R1.md).

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

## R4: complete native CLI surface through safe local passthrough

The JavaScript CLI now provides **53 typed common operations** across 13 tool families plus an explicit local-only `native TOOL -- official args` passthrough. This is the only maintainable way to expose the official CLI's full and version-dependent option surface without claiming to have individually implemented every flag. Use:

```sh
node packages/runner/js/cli.mjs catalog
node packages/runner/js/cli.mjs plan cvc5 solve --input model.smt2 --models
node packages/runner/js/cli.mjs exec cvc5 solve --input model.smt2 --models
node packages/runner/js/cli.mjs native lean4 --entry lake -- build
```

See [13-tool operations matrix](docs/NATIVE_CLI_COVERAGE.md) and [local acceptance handoff](validation/LOCAL_NATIVE_ACCEPTANCE.md). MCP can describe and plan these operations, but **does not expose raw native execution**. The assistant performed source-level command-planning validation; native CLI, Node host and MCP protocol runtime acceptance remain open.
