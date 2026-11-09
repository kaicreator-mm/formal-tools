# Lean 4 — 简介与快速入门

## 核心用途
依赖类型论（dependent type theory）与 Curry–Howard 对应：命题可表达为类型，证明是能通过内核类型检查的项。

## 架构
小型可信内核 + elaborator + tactics + Lake 构建系统。内核而非 LLM 决定证明是否成立。

## 实现与验证方式
通过 lean 编译并验证 .lean 定理；禁止 sorry、admit 和未经证明的新公理。

## 快速入门（安装相关二进制后）
    lean skills/lean4/examples/Positive.lean

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    python3 -m packages.runner run lean4 --case positive
    python3 -m packages.runner run lean4 --case negative
统一 MCP 通过 `run_formal_fixture(tool="lean4", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 Python MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
Lean 4.35.0 安装包，Linux x86_64。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
证明正确性不意味着自然语言的原始命题被完整形式化。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://lean-lang.org/documentation/
