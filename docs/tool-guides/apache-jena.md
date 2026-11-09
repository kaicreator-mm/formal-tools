# Apache Jena — 简介与快速入门

## 理论基础与核心用途
RDF 图、SPARQL 代数与语义网络查询；规则推理需要显式指定 entailment regime。

## 架构
RDF 解析层、SPARQL 引擎 ARQ、可选推理器和 TDB 存储。

## 实现与验证方式
先 riot 校验 Turtle，再 arq 执行查询；记录数据集和查询 SHA。

## 快速入门（安装相关二进制后）
    riot --validate skills/apache-jena/examples/data.ttl && arq --data skills/apache-jena/examples/data.ttl --query skills/apache-jena/examples/query.rq

## CLI 与 MCP 接入
上述命令是原生 CLI 示例（可能受版本、工作目录和依赖影响）。统一 CLI 可执行：
    node packages/runner/js/cli.mjs run apache-jena --case positive
    node packages/runner/js/cli.mjs run apache-jena --case negative
统一 MCP 通过 `run_formal_fixture(tool="apache-jena", case="positive")` 对同一个固定 fixture 执行，**并非声称工具本身提供官方 MCP 服务**。依赖官方 TypeScript MCP SDK v2；安装并连接服务器后才能调用。

## 安装与兼容
Apache Jena 6.2.0，JDK 21+。实际文件在 Google Drive `App/Formal-Methods/packages`，详细文件 ID 见 `packages/INDEX.json`。

## Woodpecker 使用定位
首选作为带预装依赖的 Docker Pipeline Step 中的固定工具用例；不建议修改 Woodpecker Agent 核心。参见 `docs/WOODPECKER_AGENT_INTEGRATION.md`。

## 边界与证据
未配置推理器时，SPARQL 查询结果不是 OWL 推理闭包。 静态文档已编写，运行验收仍为 `NOT_RUN`。

## 权威资料
https://jena.apache.org/documentation/

**JS-only 说明：** 共享 `packages/core/src/finite.mjs` 支持有限图、写集、CNF 和状态检查；本工具的原生证明/模型检查能力仍需单独安装相应二进制。MCP 服务实现为 `packages/runner/js/mcp.mjs`，不是 Python 服务。
