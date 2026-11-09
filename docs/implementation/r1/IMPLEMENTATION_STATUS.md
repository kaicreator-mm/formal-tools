# R1 Batch 1 实施状态（Source-first）

**仓库**：`kaicreator-mm/formal-tools`；实施分支 `dev/r1-tool-manager-r0`。此次开发源自 Issue #7；旧 R4 Native 验收继续通过 Issue #4 跟踪。

## 已实施 / 已测试的范围

- **D01**：源产品边界和历史兼容记录，明确 root package、MCP identity 暂保留旧名以防破坏性升级。
- **D02**：`native-catalog.mjs` 中 13 个工具统一 runtime Profile，导出 `toolRuntimeProfile`、`planToolProbe`，`native.mjs` 与 MCP Tool ID 直接复用目录，消除重复 ID 列表。
- **D03**：`tool-manager.mjs` 只读环境诊断，支持二进制/JAR/Python/Alloy 特殊入口，Windows `.cmd/.bat` 的真实执行限制 fail closed。
- **D04**：CLI `info`、`where`、`doctor-all`；默认只静态检查，`--probe` 才启动原生版本探测，缺少环境返回 JSON 和非零退出码。
- **D05（仅 source）**：MCP 添加只读的 `inspect_native_installation`，不开放 raw command/native shell。其他 MCP 工具保持原有接口。
- **兼容性**：原有 53 个类型化操作未变，原生 CLI 可信本地透传不变；Skill 仅为可选指导，不再决定工具 ID 有效性。Alloy fixture 的执行入口要求官方 JAR/BIN 显式定位，避免 Grafana Alloy 名称冲突。
- **回归增量**：Woodpecker source step 从固定测试文件改为 `node --test tests/*.test.mjs`，覆盖此前漏掉的工作区隔离、新增 tool manager 和 CLI 测试。

静态检查来源：`validation/R1_TOOL_MANAGER_SOURCE_AUDIT.json`。

## 仍未通过的门禁

- 新增 Node 测试 `tests/tool-manager.test.mjs`、`tests/tool-cli.test.mjs` 尚未在真实 Node 宿主运行。
- `npm run typecheck`、MCP v2 stdio 接口、全部 13 个工具动态 `doctor` 与 26 个 native fixture、Woodpecker 远程均 **NOT_RUN_ON_THIS_TREE**。
- 本次静态测试只能支持 **SOURCE/STATIC_TESTED**，不得标记 Runtime PASS 或正式 Release。
- D06-D12 未实施，下一步仍需保持源代码与运行证据在同一 PR/Exact-SHA 的修复-验证闭环。

## 下一步

优先交给真实 Node/原生工具宿主**一次性完成缺失验证+修复**；不要求重复手动批准，也不因单个工具暂时缺失而阻塞其他独立源码工作。验收后更新 Issue #7、Issue #4、PR、Task DAG 及最终 Exact-SHA，继续 D06 可靠执行/产物和 D07 SDK。
