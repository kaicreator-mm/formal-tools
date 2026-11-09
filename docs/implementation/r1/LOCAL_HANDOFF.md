# 一次性本地 Node / 原生工具验收与修复交接

> **不是**让本地 Agent 仅做 VALIDATION：发现 TypeScript、Node、CLI、MCP 或工具参数兼容缺陷时，直接在**同一开发分支、同一写集**修复并重新验证。Web 已完成纯 JS 静态规划与源代码更改，不要求本地 Agent 重做规划或业务建模。
>
> 仓库：`kaicreator-mm/formal-tools`
> 分支：`dev/r1-tool-manager-r0`
> **开始前重新读取实际 HEAD**，勿按旧 SHA 覆盖代码。
> 开发计划：`docs/implementation/r1/DEVELOPMENT_PLAN.md`，D01–D05。
> 旧运行记录：Issue #4；开发索引：Issue #7。

1. 读取当前 HEAD / Git Tree / PR；验证最终 source 与 Tool Registry 对齐。Node 依赖按 package manifest 安装（不自动升级 13 个原生工具）。
2. 执行 `npm run formal:test`（包括工具发现、CLI 和 worktree 写入隔离新测试）、`npm run typecheck`、`node packages/runner/js/cli.mjs validate`。失败立即在原分支修复并补回归。
3. 执行 `node packages/runner/js/cli.mjs info z3`、`where z3`、`doctor-all`。缺安装时返回 JSON + 非零退出，不能误报 runtime PASS。
4. 在已经具备 13 个正式工具的宿主中，执行 `node packages/runner/js/cli.mjs doctor-all --probe --timeout 12`；更新 13 个原生工具版本收据。TLC 需 `TLA2TOOLS_JAR`；Alloy 必须 `FORMAL_ALLOY_JAR` 或 `FORMAL_ALLOY_BIN`。不调用 Grafana Alloy。
5. 因为工作区复制修复尚未在最新版本运行、原生探测参数也改成 Tool Registry 来源，应实际运行 `node scripts/native-acceptance.mjs validation/local-runtime-receipts`，验证 26 正反例；如果可判断仅少数工具受影响，先增量，必要时补齐 26。记录真实运行数而非假设。
6. 真实测试 MCP stdio：原有 8 个接口不回退，新增 `inspect_native_installation` 能返回只读诊断且**没有 raw shell/native 执行**。
7. Windows 需验证 PATH/.exe/JAR/Python；`.cmd/.bat` 若只有 wrapper，保持 `WINDOWS_WRAPPER_UNSUPPORTED`，不能开启任意 `shell:true` 作为修复。Linux 自测至少一轮。
8. Woodpecker 3.18 Pipeline 真正触发时记录构建 ID；只有本地等价检查不能标记远程 CI PASS。
9. 生成与提交最终 commit SHA、工具二进制指纹、失败修复前后记录、测试数量、产物索引、P0/P1/P2、Remaining/Blockers 到 PR 和 Issue #7（运行问题也回写 Issue #4）。
10. 不创建 GitHub Actions、不做生产业务验证、不重命名已被消费的 npm/MCP identity、不修改用户全局环境、不下载未经批准的二进制。

**返回字段**：`FINAL_HEAD`、`NODE_TEST`、`TYPECHECK`、`CLI_INFO_WHERE_DOCTOR`、`MCP_9`、`NATIVE_DOCTOR_13`、`NATIVE_FIXTURES_26`、`WOODPECKER`、`P0/P1/P2`、`RECEIPT_PATHS`、`NEXT_GATE`。

## R1 D06/D07 增量加入本地验收（无需另开单）

- 运行新增 `tests/tool-sdk.test.mjs` 及 `tests/tool-cli.test.mjs` 中的 `invoke` 冒烟；仍由原 PR Writer 修复。
- 在实际工具环境测试 `node packages/runner/js/cli.mjs invoke z3 solve --input skills/z3/examples/positive.smt2`，确认返回 `schema=formal-tools/tool-execution/1`、原生状态、输出哈希；失败返回技术错误，不冒充业务通过。
- SDK 的 `invokeTool` 只允许类型化目录操作，`failedToolLaunch` 正确返回 NOT_STARTED；通用模型依赖打包/产物发现仍未实现，不得声明完整文件隔离。
- 上游 MCP 不应在这次验收中开放可任意执行的 raw/native 参数；SDK 为可信主机 API。
