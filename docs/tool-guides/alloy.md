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
    python3 -m packages.runner run alloy --case positive
    python3 -m packages.runner run alloy --case negative
统一 MCP 通过 `run_formal_fixture(tool="alloy", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 Python MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
Alloy 6.2.0 Linux 包；CLI 标志以当前发行版 --help 为准。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
scope=4 的无反例结论不可外推到所有规模；CLI 输出尚未建立可靠解析器。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://alloytools.org/
