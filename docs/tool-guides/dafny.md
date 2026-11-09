# Dafny — 简介与快速入门

## 理论基础与核心用途
Hoare 风格的程序契约、最弱前置条件与 SMT 自动证明，使用 requires、ensures、invariant。

## 架构
源语言与类型检查、验证条件生成、SMT 后端证明、可选代码编译器。

## 实现与验证方式
用 dafny verify 检查 .dfy 文件，区分编译通过和验证通过。

## 快速入门（安装相关二进制后）
    dafny verify skills/dafny/examples/Positive.dfy

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    node packages/runner/js/cli.mjs run dafny --case positive
    node packages/runner/js/cli.mjs run dafny --case negative
统一 MCP 通过 `run_formal_fixture(tool="dafny", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 TypeScript MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
Dafny 4.11.0 + .NET 8。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
自动验证证明的是明确的程序契约，遗漏的行为不会自动被验证。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://dafny.org/latest/DafnyRef/DafnyRef

**JS-only 说明：** 共享 `packages/core/src/finite.mjs` 支持有限图、写集、CNF 和状态检查；本工具的原生证明/模型检查能力仍需单独安装相应二进制。MCP 服务实现为 `packages/runner/js/mcp.mjs`，不是 Python 服务。

## 完整官方 CLI 参数与 R4 JS 封装

该工具的原生命令行具有比演示用例更大的参数面。**完整选项支持采用本地透传（而非全部手写重实现）**：

```bash
node packages/runner/js/cli.mjs catalog dafny
node packages/runner/js/cli.mjs native-help dafny
node packages/runner/js/cli.mjs native dafny -- --help
```

如果该工具有多个入口，请根据 `catalog` 返回的 `entries` 用 `--entry <name>` 指定；特定版本可能使用 `-h`、`help` 或特殊命令（以 `native-help` 为准）。安全的常用功能通过 `plan <tool> <operation> --input ...` 生成 argv，确认后执行 `exec`。

每个工具的已命名操作、参数类型、官方引用和版本未验证状态见 [CLI 覆盖矩阵](../NATIVE_CLI_COVERAGE.md)。`native` 是可信本地 CLI 能力，不开放给 MCP 的 raw execution。真实运行与正反例结果仍须由本地验收收据确认。
