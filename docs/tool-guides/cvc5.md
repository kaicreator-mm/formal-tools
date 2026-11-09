# cvc5 — 简介与快速入门

## 核心用途
基于 SMT 理论求解，支持位向量、算术、字符串及多种逻辑约束。

## 架构
SMT 解析前端、重写与预处理、理论求解引擎、可选证明/模型输出。

## 实现与验证方式
使用 cvc5 --lang smt2 执行；与 Z3 同源 SMT-LIB 双引擎比对。

## 快速入门（安装相关二进制后）
    cvc5 --lang smt2 skills/cvc5/examples/positive.smt2

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    python3 -m packages.runner run cvc5 --case positive
    python3 -m packages.runner run cvc5 --case negative
统一 MCP 通过 `run_formal_fixture(tool="cvc5", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 Python MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
cvc5 1.4.2 Linux x86_64 工具包。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
SAT/UNSAT 必须结合所验证命题含义解释；UNKNOWN 不得视为通过。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://cvc5.github.io/docs/latest/
