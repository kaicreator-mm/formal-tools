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

Pure JS finite-model algorithms executed in this conversation's restricted JS runtime (1,705/1,705 deterministic and independent-reference checks); the saved source is scheduled for an exact Git readback run. 上述数字属于较早的 R3 源代码与有限模型检查记录；R1 的 Node、MCP 和 Woodpecker 已有独立的 Exact-SHA 运行证据，详见下方 R1 进展。13 个官方工具的实际安装与运行验收须按各自宿主及 SHA 单独判断。 None of these checks independently certifies ADS, DKE or DIS natural-language requirements. Do not infer universal proof from bounded models.

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

See [13-tool operations matrix](docs/NATIVE_CLI_COVERAGE.md) and [local acceptance handoff](validation/LOCAL_NATIVE_ACCEPTANCE.md). MCP can describe and plan these operations, but **does not expose raw native execution**. 旧的 R4 静态规划记录已经由后续主机测试补充，但每条收据只适用于实际执行的 Git SHA。最新安装环境是否具备 13 个官方工具，仍以对应主机的真实版本探测为准。

## R1 工具管理开发线

R1 仅改善工具维护与易用性：单一工具 Registry、运行 Profile、安装/依赖/启动诊断、CLI/MCP/SDK 的通用接口。**不编排业务验证或模拟**。当前新增命令是开发版本，Node 宿主验收之前不视为正式稳定发布。

```sh
node packages/runner/js/cli.mjs info z3
node packages/runner/js/cli.mjs where z3
node packages/runner/js/cli.mjs doctor-all
# 只有显式加 --probe 才真正执行原生工具探测
node packages/runner/js/cli.mjs doctor-all --probe --timeout 12
```

[工具诊断说明](docs/TOOL_MANAGER.md) · [R1 开发计划](docs/implementation/r1/DEVELOPMENT_PLAN.md)

## R1 通用工具 SDK（实验接口）

`packages/runner/js/sdk.mjs` 提供 `listTools`、`toolDetails`、`planTool`、`whereTool`、`whereAll`、`invokeTool`。它仅包装**工具本身**的技术状态，不判断业务性质。CLI 新增 `invoke TOOL OP --option value`，返回一致的机器可读 `ToolExecutionResult`；原来的 `exec` 原样保留避免破坏兼容性。

[SDK 开发文档](docs/TOOL_SDK.md)。本接口尚须 Node/TypeScript/原生运行验收；MCP 仍不开放任意执行。

## R1 工具层集成进展（以 Git Exact-SHA 为准）

- **PR #9 已合并 main**：工具注册表、环境诊断、CLI/MCP 只读安装检测、实验性类型化 SDK。PR #9 源码 HEAD `fc8899a6b3fc69636fffdfbd17fc74f8b4fb63e4` 上，Windows Node/TypeScript/MCP 基础验收通过；Woodpecker Linux Build #9/#10 真实通过，Node **52/52 PASS**。
- **PR #10 集成开发中**：增加 `invokeStagedTool`，为已登记的类型化操作将调用方指定输入复制到独立临时目录，执行后扫描新增/修改文件并返回 SHA-256 元数据。见 [分阶段暂存 SDK](docs/TOOL_STAGED_SDK.md) 和 [集成审查](docs/implementation/r1/INTEGRATION_REVIEW.md)。
- **运行事实边界**：PR #9 验收时的 Windows 主机未安装完整的 13 个官方原生工具，因此 13 个版本验证未完成、26 项正反例未得到原生工具的有效结论；PR #10 最新源码的新增 Node/TypeScript/CI 仍须重新验收。
- **产品边界**：这些接口仅维护工具调用与原生产物。业务模型、工具选择、领域模拟、验收决策由调用项目负责。

`packages/runner` 已提供 `formal-tools` 命令入口；在确立稳定 SDK 发布与依赖兼容前，根包和 MCP 的历史 `formal-tools-skill` 标识暂保留以避免破坏现有客户端。
