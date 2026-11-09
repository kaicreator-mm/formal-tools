# ProB — 简介与快速入门

## 理论基础与核心用途
B / Event-B 的集合论、谓词逻辑与精化语义，检查状态不变量和操作前后条件。

## 架构
B 模型前端、状态探索器、约束求解与模型检查器。

## 实现与验证方式
使用 probcli -model_check 验证 .mch 模型；保存探索状态数与不变量失败轨迹。

## 快速入门（安装相关二进制后）
    probcli skills/prob/examples/Positive.mch -model_check

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    python3 -m packages.runner run prob --case positive
    python3 -m packages.runner run prob --case negative
统一 MCP 通过 `run_formal_fixture(tool="prob", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 Python MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
ProB 1.16.0 Linux64。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
当前 CLI 输出解析器未经过实测验收，自动 verdict 应保留 INCONCLUSIVE。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://prob.hhu.de/w/index.php?title=ProB_CLI
