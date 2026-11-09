# Clingo — 简介与快速入门

## 理论基础与核心用途
答案集编程（ASP）和非单调逻辑：以规则、约束及默认否定定义可接受的候选答案集。

## 架构
gringo 规则 grounding + clasp 求解 + clingo 控制器，用模型枚举表示可行解。

## 实现与验证方式
通过 Python -m clingo 列出答案集；区分 UNSATISFIABLE 与进程错误。

## 快速入门（安装相关二进制后）
    python3.14 -m clingo skills/clingo/examples/positive.lp 0

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    python3 -m packages.runner run clingo --case positive
    python3 -m packages.runner run clingo --case negative
统一 MCP 通过 `run_formal_fixture(tool="clingo", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 Python MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
clingo 5.8.3，Drive wheel 为 CPython 3.14。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
答案集列出的是规则一致的选择，不证明规则与业务期望一致。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://potassco.org/clingo/
