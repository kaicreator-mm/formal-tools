# Tool Execution Result / experimental JS SDK

`packages/runner/js/sdk.mjs` 是 **formal-tools 技术工具接口**，不是业务验证框架。公开：

- `listTools()` — 列出官方工具清单。
- `toolDetails(tool)`、`planTool(tool,operation,settings)` — 查看工具信息和生成类型化 CLI argv。
- `whereTool(tool)`、`whereAll()` — 只读环境检查，绝不启动或安装工具。
- `invokeTool({tool,operation,settings,timeoutS,cwd})` — 在**可信 Node 宿主**执行登记的类型化操作并返回标准工具结果。它不允许 raw 命令、Shell 或任意可执行文件名。

`invokeTool` 调用方应提供已准备好的输入和合适的工作目录，**原生工具可能修改输入附近的文件**。当前 SDK 尚未实现通用的模型依赖文件打包或绝对安全的执行隔离；因此不能把通用 `invokeTool` 暴露给不可信 MCP 客户端或声称 OS 安全沙箱。用户/调用项目自行控制场景、策略、模型、解释与接受结论。

```js
import { listTools, whereTool, invokeTool } from "./packages/runner/js/sdk.mjs";

console.log(listTools());
console.log(await whereTool("z3"));

const result = await invokeTool({
  tool: "z3",
  operation: "solve",
  settings: {input: "./model.smt2"},
  timeoutS: 30,
  cwd: "./tmp-working-directory"
});
console.log(result.tool_status, result.process.status, result.streams.stdout.text);
```

## Contract

`tool-result.mjs` 把旧 Runner 的 native process receipt 转为 `formal-tools/tool-execution/1`，包括技术执行状态、tool-native 状态、stdout/stderr 摘要/hash、argv/exit/time/timeout 与制品收集状态。

- `artifacts.status=NOT_COLLECTED` 表示尚未封装引擎生成的文件，不能假装不存在。
- `tool_status=UNSAT`、`SAT` 等只是上游工具返回的技术结果，**不代表任意业务模型/自然语言命题通过**。
- 超时、输出上限、未启动的工具状态必须是 `INCONCLUSIVE`。
- SDK 只暴露类型化已注册操作；原生 CLI 参数透传仍只在可信本地 CLI 可用，MCP 继续禁用 raw。
- 这是 **SOURCE-LEVEL EXPERIMENTAL API**，未完成 Node / TypeScript / 原生运行测试，不保证所有第三方命令具有相同的输出制品行为。

## Next

后续 D06 补上运行工作区与生成文件的可靠收集、退出码适配、多平台覆盖；D07 在实际宿主验收之后确定稳定的 npm export/version 策略。当前根 package 名与 MCP identity 不贸然破坏性重命名。


## Staged SDK integration

See [Experimental staged native tool SDK](TOOL_STAGED_SDK.md). `invokeStagedTool` stages explicitly selected input files into a private directory and records generated artifact metadata; unlike the original `invokeTool`, it does not use input files directly from the caller's project working tree. No OS-level sandbox or automatic dependency discovery is claimed.
