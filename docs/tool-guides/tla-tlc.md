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
    python3 -m packages.runner run tla-tlc --case positive
    python3 -m packages.runner run tla-tlc --case negative
统一 MCP 通过 `run_formal_fixture(tool="tla-tlc", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 Python MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
JDK + TLA2TOOLS_JAR 指向 Drive 中的 tla2tools.jar。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
有限/可枚举检查并不是任意规模的数学证明。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://lamport.azurewebsites.net/tla/tla.html
