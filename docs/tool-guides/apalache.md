# Apalache — 简介与快速入门

## 核心用途
将 TLA+ 状态约束转化为 SMT 约束并开展有界符号模型检查。

## 架构
TLA+ 解析/类型化、约束转换、SMT 后端求解（Z3/cvc5），输出反例或有界结果。

## 实现与验证方式
调用 apalache-mc check，并固定初始谓词、下一步谓词、界长与不变量。

## 快速入门（安装相关二进制后）
    apalache-mc check --init=Init --next=Next --inv=Inv --length=3 skills/apalache/examples/TogglePositive.tla

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    python3 -m packages.runner run apalache --case positive
    python3 -m packages.runner run apalache --case negative
统一 MCP 通过 `run_formal_fixture(tool="apalache", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 Python MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
Apalache 0.62.4 + Java + 兼容 SMT 求解器。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
Bounded SAFE 不意味着完整时序安全性。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://apalache-mc.org/docs/apalache/running.html
