# TLA+ / TLC — 简介与快速入门

## 理论基础与核心用途
时序逻辑与状态迁移系统：描述初始状态、下一步关系、安全性与活性性质。

## 架构
TLA+ 规范 + 配置文件 + TLC 显式状态模型检查器，遍历给定范围的可达状态。

## 实现与验证方式
通过 Java 加载 tla2tools.jar 对 .tla/.cfg 检查不变量与死锁。

## 快速入门（安装相关二进制后）
    java -cp "$TLA2TOOLS_JAR" tlc2.TLC -config skills/tla-tlc/examples/Toggle.cfg skills/tla-tlc/examples/TogglePositive.tla

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    node packages/runner/js/cli.mjs run tla-tlc --case positive
    node packages/runner/js/cli.mjs run tla-tlc --case negative
统一 MCP 通过 `run_formal_fixture(tool="tla-tlc", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 TypeScript MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
JDK + TLA2TOOLS_JAR 指向 Drive 中的 tla2tools.jar。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
有限/可枚举检查并不是任意规模的数学证明。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://lamport.azurewebsites.net/tla/tla.html

**JS-only 说明：** 共享 `packages/core/src/finite.mjs` 支持有限图、写集、CNF 和状态检查；本工具的原生证明/模型检查能力仍需单独安装相应二进制。MCP 服务实现为 `packages/runner/js/mcp.mjs`，不是 Python 服务。

## 完整官方 CLI 参数与 R4 JS 封装

该工具的原生命令行具有比演示用例更大的参数面。**完整选项支持采用本地透传（而非全部手写重实现）**：

```bash
node packages/runner/js/cli.mjs catalog tla-tlc
node packages/runner/js/cli.mjs native-help tla-tlc
node packages/runner/js/cli.mjs native tla-tlc -- --help
```

如果该工具有多个入口，请根据 `catalog` 返回的 `entries` 用 `--entry <name>` 指定；特定版本可能使用 `-h`、`help` 或特殊命令（以 `native-help` 为准）。安全的常用功能通过 `plan <tool> <operation> --input ...` 生成 argv，确认后执行 `exec`。

每个工具的已命名操作、参数类型、官方引用和版本未验证状态见 [CLI 覆盖矩阵](../NATIVE_CLI_COVERAGE.md)。`native` 是可信本地 CLI 能力，不开放给 MCP 的 raw execution。真实运行与正反例结果仍须由本地验收收据确认。
