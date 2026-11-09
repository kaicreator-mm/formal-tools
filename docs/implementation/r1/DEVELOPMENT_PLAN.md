# R1 工具维护与易用性开发计划 D0

> 开发分支：\`dev/r1-tool-manager-r0\`；基线 \`main@5bd8a552c61218d56408de12bb832a5b39f568a2\`
>
> 规划权威：Issue #7 / \`docs/roadmap/FORMAL_TOOLS_MAINTENANCE_PLAN_R1.md\`；原生运行验收 Issue #4。
>
> 项目职责：**formal-tools 只维护通用形式化与逻辑化工具，让工具更易发现、安装、诊断、调用、集成和升级**。不选择业务工具、不建立项目形式化模型、不决定验证内容、不编排模拟或解释业务意义。Skill 只是可选接口。
>
> 状态标签：\`PLANNED\`、\`SOURCE_IMPLEMENTED\`、\`STATIC_TESTED\`、\`NODE_TESTED\`、\`NATIVE_TESTED\`、\`BLOCKED\`、\`ACCEPTED\`。不能用源代码测试替代原生运行收据。

## A. 当前事实与风险

- 13 个工具与 53 个类型化 CLI 操作已在 \`packages/runner/js/native-catalog.mjs\`；\`native.mjs\` 和 \`mcp.mjs\` 仍分别硬编码工具清单，后续容易漂移。
- \`doctor\` 目前只尝试各工具固定 \`--version/--help\`，不能可靠指出缺失依赖、JAR 路径、Windows wrappers、已有安装位置及建议。
- 项目已更名，但根 package 名称仍为 \`formal-tools-skill\`，MCP identity 仍含旧名称。**暂保留兼容入口，不在未经确认的版本直接破坏旧包名。**
- 本地 Agent 的 13 doctor / 26 fixtures / 12 MCP 运行结果对应旧 Exact-SHA \`f945fc50751f71e120c355661d63cce4f7041ea4\`；后续隔离路径补丁已经合入 main 但新增 Node 回归 \`tests/native-workspace.test.mjs\` 尚未实际执行；木工 Woodpecker 远程仍 NOT_RUN。
- 当前 Woodpecker 静态 Step 没有包含新加入的 \`native-workspace.test.mjs\`。需要增量修正。
- \`registry/INTERFACES.json\`、\`registry/SKILL_REGISTRY.json\` 等包含历史 R3 运行状态。更新时按 **exact SHA** 保留历史，而非一律改成 PASS。

## B. 实施结构（保持 monorepo，少抽象）

\`\`\`
packages/
  core/                            已有：纯 JS 有限逻辑工具
  runner/
    js/native-catalog.mjs          唯一工具 ID / 官方 CLI entry / 类型化操作注册源
    js/tool-manager.mjs            新增：安装与 PATH / 依赖诊断、版本 probe 计划
    js/native.mjs                  现有：受控工具执行
    js/cli.mjs                     现有：CLI 入口，新增 info / where / doctor-all
    js/mcp.mjs                     现有：通过目录访问工具，不另建 MCP
    js/sdk.mjs                     后续：SDK 的稳定导出面（如需要）
registry/
  TOOL_MANIFEST.schema.json        新增：工具元信息形状（不再写第二份独立工具 ID 清单）
tests/
  tool-manager.test.mjs            新增：纯计划与可模拟的路径诊断/错误案例
  native-workspace.test.mjs        已有：输入隔离回归
docs/
  implementation/r1/              本开发计划 + DAG + 收据
\`\`\`

唯一目录以 \`native-catalog.mjs\` 为权威；\`knownTools\`、MCP Tool ID 和环境诊断均从它导出。其他数据只能引用/验证，不再维护另外的工具集合。

## C. 开发 Task DAG

| ID | Task / 最小实际交付 | 依赖 | 关键验收 |
|---|---|---|---|
| D01 | 定位/兼容/现状与开发基线、开发计划固化 | — | 精确 HEAD、唯一范围、明确不破坏已发布调用 |
| D02 | 单一 Tool Registry 与 13 个工具运行 Profile | D01 | 13/13 全部列出；id/entry/help/operations/requirements 单源；无冲突配置 |
| D03 | Tool Manager：PATH、JAR、Python、依赖诊断、统一建议 | D02 | 未安装、未配置、已找到但未探测等状态正确；不自动安装 |
| D04 | CLI 的 info/where/doctor-all 与现有命令兼容 | D03 | 返回结构化 JSON，旧 list/catalog/plan/run 语义不变 |
| D05 | MCP 安全只读 catalog 与 doctor 对齐 | D03、D04 | MCP 不提供任意 shell/native passthrough |
| D06 | 执行层可靠性、输出/产物/超时/工作目录隔离 | D03、D04 | 退出/错误/截断可区分；不删除源文件 |
| D07 | 稳定通用 JS/TS SDK 调用接口（不处理业务属性） | D05、D06 | 与 CLI / MCP 使用同一份 ToolRegistry/Runner |
| D08 | 官方模型检查和模拟命令技术接入完善 | D06、D07 | 保留官方 argv、轨迹和生成制品，不编排业务场景 |
| D09 | Windows/Linux + 上游版本兼容矩阵 | D06、D07 | Windows .bat/.cmd 不能未经验证当作原生可直接启动 |
| D10 | Woodpecker 实际 CI、回归矩阵与签收 | D08、D09 | 真实 Pipeline receipt；不使用 GH Actions |
| D11 | 外部 API（可由 domain-simulator）工具层冒烟与用户文档 | D07、D08、D09 | 验证接口稳定，不接管调用方模型和策略 |
| D12 | 发布资格、升级兼容与工具维护指南 | D10、D11 | 质量门禁和版本状态一致，P0/P1=0 |

**本批开发目标：D01-D04 源码，外加 D05 的安全接口结构（视差异），并对 D06 完成风险盘点。** 其余任务保留依赖关系，不在没有真实 Host 时将其标为 NATIVE_TESTED。

## D. 最小变更策略

1. 不改 53 个类型化操作和已有 raw local CLI 行为，必要时只让工具 ID 由统一 Registry 导入。
2. 安装管理的初版仅 **发现与诊断**：不自动下载、不启用管理员权限、不写全局 PATH、不覆盖已有程序。
3. \`doctor\` 分离 **静态环境检查**（缺什么、找到哪）与 **动态命令探测**（实际启动证据）；静态找到文件不能宣称证明器可用。
4. Windows 优先原生 Node；对 .cmd/.bat 等原生启动障碍报明示状态，不能为兼容随意打开 shell。
5. CLI/MCP/SDK 返回工具技术状态、原始标准输出/错误和产物，不做项目级证明/模拟结果决策。
6. 真实执行仍由本地可信 Host 完成；Web 端能独立测试的仅纯 JS 规划/参数/路径状态机，所有收据留 Git Exact-SHA。

## E. 验收矩阵与交接

**静态/纯 JS：** 13/13 工具目录一致、53/53 操作规划不回退、错误工具 ID 与非法参数拒绝、各平台环境诊断 Mock、没有新增原生 shell/raw MCP。

**Node：** \`npm run formal:test\`、\`npm run typecheck\`、CLI \`list/info/where/doctor-all\`、MCP stdio 核验。若更新 Runner，重新运行受影响工具 fixture 或 26 项；须记录 exact commit、版本与原始日志 hash。

**Native：** 最新 SHA 的工作区隔离回归，工具真实 PATH/JAR/Python/Windows 诊断，必要增量 fixture；工具版本兼容不通过时由同一 Writer 修复。只在需要的宿主运行，避免无意义全量重测。

**成功标准：** 接入方无需知道每个工具的启动方式即可发现安装状态、获得可执行的诊断与一致工具元数据；现有 CLI/MCP 功能不退化；所有 Runtime PASS 均能关联运行的 Exact-SHA。

## F. 交付节奏

- **Batch 1：** D01-D04 以及单一 Registry 的对齐和静态测试，尽量 Web Builder 完成。
- **Batch 2：** D05-D07 的通用接口/运行可靠性/SDK 及工具状态/产物，按实际受影响的工具验证。
- **Batch 3：** D08-D12 的工具技术能力、版本兼容、真实 CI 和接口互操作。
- 每 Batch 遵循 ADS #1359 Delivery-First：一个 Writer 处理同一 write set 的修复与测试；需要本地时一次交接，避免只做 VALIDATION 的任务。

**禁止重回业务范围**：不添加 ADS/DKE/DIS property 模型、工具推荐策略、领域模拟流程或业务验收门禁。
