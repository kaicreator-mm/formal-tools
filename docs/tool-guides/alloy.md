# Alloy 6 — 简介与快速入门

## 理论基础与核心用途
关系逻辑与有限域模型查找：用 sig、fact、assert 等描述结构，再搜索有限 scope 中的实例或反例。

## 架构
Alloy 语言前端、关系约束翻译器、底层 SAT 求解器与实例可视化。

## 实现与验证方式
在 .als 中定义结构和不变量，用官方 Analyzer 或版本兼容的 CLI 查找反例。

## 快速入门（安装相关二进制后）
    alloy exec -c 0 skills/alloy/examples/positive.als

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    node packages/runner/js/cli.mjs run alloy --case positive
    node packages/runner/js/cli.mjs run alloy --case negative
统一 MCP 通过 `run_formal_fixture(tool="alloy", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 TypeScript MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
Alloy 6.2.0 Linux 包；CLI 标志以当前发行版 --help 为准。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
scope=4 的无反例结论不可外推到所有规模；CLI 输出尚未建立可靠解析器。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://alloytools.org/

**JS-only 说明：** 共享 `packages/core/src/finite.mjs` 支持有限图、写集、CNF 和状态检查；本工具的原生证明/模型检查能力仍需单独安装相应二进制。MCP 服务实现为 `packages/runner/js/mcp.mjs`，不是 Python 服务。

## 完整官方 CLI 参数与 R4 JS 封装

该工具的原生命令行具有比演示用例更大的参数面。**完整选项支持采用本地透传（而非全部手写重实现）**：

```bash
node packages/runner/js/cli.mjs catalog alloy
node packages/runner/js/cli.mjs native-help alloy
node packages/runner/js/cli.mjs native alloy -- --help
```

如果该工具有多个入口，请根据 `catalog` 返回的 `entries` 用 `--entry <name>` 指定；特定版本可能使用 `-h`、`help` 或特殊命令（以 `native-help` 为准）。安全的常用功能通过 `plan <tool> <operation> --input ...` 生成 argv，确认后执行 `exec`。

每个工具的已命名操作、参数类型、官方引用和版本未验证状态见 [CLI 覆盖矩阵](../NATIVE_CLI_COVERAGE.md)。`native` 是可信本地 CLI 能力，不开放给 MCP 的 raw execution。真实运行与正反例结果仍须由本地验收收据确认。
