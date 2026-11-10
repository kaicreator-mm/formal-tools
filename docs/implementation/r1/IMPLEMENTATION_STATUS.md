# R1 Batch 1 实施状态（Source-first）

> **历史阶段快照**：下文按实施当时记录 NOT_RUN / SOURCE_PARTIAL 与旧 CI 失败，**不代表当前 R1 Gate**。Issue #7 已于 2026-11-10 完成 **12/12**；formal-tools PR #10 源 HEAD `436da7247842b835bad198435cb3e3d05fb7b2b3` 经 Woodpecker push #83 / PR #84（91/91 Node、mandatory TypeScript/CLI）PASS，合入 main `1016deab720c692d337484e95f1705dbe9f30e87`。独立消费者 domain-simulator PR #263 HEAD `d9c90a9a278ccddeb5cf03fff3ae5e53bf8d8328` 对上述 SHA 运行两次、每次 12/12 PASS，合并 SHA `85e61c71e10b8e47b70480b036f97a972d928561`。原生 13×26 仍由 Issue #4 管理、未经本次证明。机器可读最终 Gate 以 `TASK_DAG.json` 的 `current_gate` / `progress_evidence` 为准。


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

## D06/D07 源码追加（实验状态）

- D06 只完成 **ToolExecutionResult** 技术结果规范化函数，默认输出 `artifacts.status=NOT_COLLECTED`，不谎报有完整轨迹与生成制品收集；运行隔离尚未完整。
- D07 只完成 **SDK 实验性源码** 与 CLI `invoke` 入口；原有 `exec` 和 MCP fixed fixture 仍然存在。SDK 是受信 Node Host API，不暴露给不可信 MCP。
- 已在受限 JS 中验证 Result 10/10 状态和边界，以及 SDK mock dispatch 7/7；12 个 JS 模块/测试文件仅做 V8 语法解析，不是 Node 原生测试。
- 尚需真实 Node/TypeScript/原生工具跑 `tests/tool-sdk.test.mjs` 和 CLI `invoke` 冒烟。完整资源/工作目录隔离与产物发现待 D06 后续修复。
- 细节见 `validation/R1_SDK_SOURCE_AUDIT.json`。

## Issue #7 新范围：D11/D12 可并行的 Web-first 实际进展（2026-11-10）

- **D11 真实来源证据标准化**：新增 `validation/r1/windows-host-observations.json`，由已提交的 PR #9 Windows `native-acceptance.json` 生成；13 工具中 11 次 `NOT_RUN`、2 次 Python 解释器 `EXECUTED`，但**全部没有得到可验证的官方工具版本**，26 fixture 均 `INCONCLUSIVE`。保留真实代码 SHA `61bf9e29ba519d02849cad8fe6fdb421fc3f1fed` 和原始 Git Blob SHA，避免历史收据越过新 SHA 被冒充 PASS。
- **D11 可执行回归**：`tests/compatibility-evidence.test.mjs` 检查 13 个 ID 与 Registry 一致、原始未实测状态、旧 SHA 的 `REPORTED_UNREVIEWED` / 新 SHA 的 `STALE_SHA`。仅静态 V8 逻辑自检完成，当前 PR 的 Node/TypeScript/Woodpecker 验收仍待通过。
- **D12 真实外部仓库**：`kaicreator-mm/domain-simulator` <https://github.com/kaicreator-mm/domain-simulator/pull/263>，source HEAD `c195767689ff1d524765934c52ee9a2eb43b34c5`，已提供非生产 SDK 工具接口烟测脚本；实际主机运行 `NOT_RUN`，其原有业务 Z3 适配器不变。
- **首要 P1 不变**：PR #10 Woodpecker 编译/依赖失败。Web Builder 已补 CI 依赖准备步骤，但 Build #23/#24 仍失败；当前新源码 SHA 的 CI 尚无通过证据。真实日志尚不可由 GitHub 状态接口读取，只保留一项最小本地需求：读取失败步骤/错误/退出码，不承担研发。
- 进度解释：D01–D05 已合入 main（5/12）；D06–D12 均有不同程度源码/独立消费准备，但无一项因本次新增而直接标 DONE。R1 完成仍以 #7 的 final Exact-SHA Node+TS+CI、真实外部 smoke 和 P0/P1=0 为准。
