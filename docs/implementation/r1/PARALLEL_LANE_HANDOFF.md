# R1 并行开发 Lane：集成与验收交接

## 写集所有权

- **PR #9 / 本地 Agent**：`dev/r1-tool-manager-r0`，维护 `native.mjs`、`cli.mjs`、`mcp.mjs`、`sdk.mjs`、`tool-manager.mjs`、`package.json`、Task DAG 及已有测试；本 Lane **不改**这些文件。
- **本 Lane / Web Builder**：`dev/r1-artifact-inventory-lane`，只新增 `artifact-collector.mjs`、`compatibility-matrix.mjs`、各自测试、独立脚本/Schema/文档/审核收据。
- 两 PR 均从 GitHub `main@5bd8a552c61218d56408de12bb832a5b39f568a2` 发展。此 Lane 未在 PR #9 的 WIP 代码上建立父提交。

## 当前交付与安全边界

1. `prepareToolWorkspace(sourceRoot,inputs,limits)` 将调用方选定的输入文件复制到独立临时工作目录，拒绝路径穿越、符号链接、Windows 保留名/大小写碰撞及超额文件；不自行运行工具。
2. `scanArtifactWorkspace(workspace,limits)` 对调用方自己拥有的私有工作目录做只读、资源有界的 SHA-256 文件清单。
3. `artifactDelta(before,after)` 比较新增/修改的文件，忽略未变化的输入文件；`collectGeneratedArtifacts` 只连接这两步。
4. 不读取文件内容给消费者，不暴露绝对路径，不跟随目录或文件符号链接，不能用作不可信执行器的沙箱。
5. `buildCompatibilityMatrix({targetHead,observations})` 根据唯一 Tool Catalog 得出 13 工具与 53 操作的来源清单；旧 SHA 标记 STALE，新 SHA 也只标记 REPORTED_UNREVIEWED，不冒充真实兼容性认证。
6. 不涉及项目模型设计、业务性质、模拟流程、Tool 推荐政策或独立证明结论。

## 等 PR #9 本地 Agent 完成后的**一次性**接入

A. 先读取 PR #9 与本 Lane 实际 HEAD、检查写集冲突。此 Lane 应先以单独 PR 合并到 main，或由一个集成 Writer 合并两 PR；不要让两个 Agent 同时修改 `native.mjs`/`sdk.mjs`。

B. 运行：
```sh
node --test tests/artifact-collector.test.mjs tests/compatibility-matrix.test.mjs
node --test tests/*.test.mjs
npm run typecheck
node scripts/tool-compatibility.mjs <FULL_ACTUAL_GIT_HEAD>
```
测试失败直接在本 Lane 原 PR 修复并回归。符号链接测试仅在 Windows OS 不允许创建符号链接时可按测试实现记录跳过。

C. 如果需要从官方工具收集制品，集成 Writer 在 PR #9 的 **受控执行工作目录** 中执行：先 `scanArtifactWorkspace`、再运行工具、最后 `collectGeneratedArtifacts`；用 `status=PARTIAL` 表示上限/权限/文件变更/符号链接等未收全。不能扫描任意用户路径，也不能在清理临时目录之后补扫。

D. 集成 Writer 再把 `artifacts.status=NOT_COLLECTED` 的 SDK 结果按**实际扫描成功**状态更新，不得在没有真实运行的情况下宣称 `COLLECTED`；失败时保留原生 stdout/stderr 及真实错误码。

E. Woodpecker / SDK packaging / MCP 的共享入口依然归 PR #9 的 Writer 或其完成后指定的单一集成 Writer。本 Lane 不直接添加任意 Native MCP shell execution。

F. 收据保留 exact SHA 和 Node/OS/Engine 版本、测试数量、P0/P1/P2、源码和 Runner 结果；远程 Woodpecker 未执行必须保留 NOT_RUN。

## 剩余工作

- 本 Lane Node FS tests、TypeScript 检查与真实 Host 回归尚未执行。
- 两个新模块还没有 SDK/CLI/MCP 自动集成。
- 跨工具生成物的收集覆盖需要真实源数据的工具级 fixture 验证；**不得将扫描出的文件直接解释为形式化证明或模拟结果**。

## 独立 Lane 新增源文件及验收门禁

- `packages/runner/js/tool-workspace.mjs` / `tests/tool-workspace.test.mjs`：输入文件暂存与隔离、SHA-256、路径和 Windows 文件名边界。
- `packages/runner/js/compatibility-matrix.mjs` 已支持同一工具跨平台/架构/版本的多组报告，按原 Git SHA 保留各自状态，不使用多数票。
- `scripts/tool-compatibility.mjs HEAD --observations FILE.json` 只读输入实际主机报告，无网络、安装或原生执行；`run_status=PASS` 不被当作工具层技术状态接受。
- 新 Node 验收：`node --test tests/tool-workspace.test.mjs tests/artifact-collector.test.mjs tests/compatibility-matrix.test.mjs`；只有目标执行宿主跑过才记为 PASS。

参考 `docs/implementation/r1/TOOL_WORKSPACE.md`。
