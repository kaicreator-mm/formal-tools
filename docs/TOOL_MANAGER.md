# Tool Manager — 通用工具发现与环境诊断

**作用边界**：仅说明 13 个形式化/逻辑工具在当前宿主上的安装和启动条件，不决定工具用于什么、验证什么，也不评价业务结论。

## 使用

```sh
node packages/runner/js/cli.mjs info z3
node packages/runner/js/cli.mjs where z3
node packages/runner/js/cli.mjs doctor-all
node packages/runner/js/cli.mjs doctor z3 --timeout 12
node packages/runner/js/cli.mjs doctor-all --probe --timeout 12
```

- `info TOOL`：登记的官方工具 ID、CLI 入口、子命令和版本探测参数；只读，不执行命令。
- `where TOOL`：在设置的 bin 目录或 PATH 中查找可执行文件/依赖；不执行工具。找到路径只代表 `FOUND_NOT_PROBED`，**不是通过验收**。
- `doctor-all`：对 13 个工具进行静态检查，输出每个工具的状态/缺失原因。
- `doctor TOOL`：保留旧的真实版本探测入口；实际启动第三方 CLI。
- `doctor-all --probe`：仅对静态检查可启动的工具尝试真实版本探测。此命令可能比较耗时；不得把退出码 0 或 Help 文本视作业务形式化证明。

`where` 与 `doctor-all` 仅当相关工具全部静态找到/可启动时退出 0；否则退出 2 并返回 JSON 诊断，便于脚本判断。

## 配置

| 环境 | 用途 | 注意 |
|---|---|---|
| `PATH` | 常规 CLI 查找 | 工具版本的真实可用性仍需 probe |
| `FORMAL_TOOLS_BIN_DIR` | 可执行程序和 Java 启动命令的显式查找目录 | 设置后优先于 PATH，与已有 Runner 行为对齐 |
| `TLA2TOOLS_JAR` | TLC/SANY/PlusCal 的官方 Java JAR | 路径必须实际存在，Java 另行安装 |
| `FORMAL_ALLOY_JAR` | Alloy Analyzer 官方 Java JAR | 与 Grafana Alloy 名称冲突，必须显式指明 |
| `FORMAL_ALLOY_BIN` | Alloy Analyzer 官方原生可执行文件 | 可代替 JAR 指向明确的二进制 |
| `FORMAL_CLINGO_PYTHON` / `FORMAL_PYSHACL_PYTHON` | 指定这些官方 Python 模块所用的解释器 | Tool Manager 是 JS，第三方原生工具仍保留各自依赖 |
| `FORMAL_CLINGO_BIN` | Clingo 官方原生可执行文件的显式 pin 路径 | 设置后成为唯一 launcher 候选（kind `clingo-bin`）：不做 PATH 查找、不被 `FORMAL_TOOLS_BIN_DIR` 遮蔽，路径进 requiredFiles 供验收收据做 SHA-256 指纹；未设置时保持既有 Python module 契约不变 |

### Windows 原生支持

Windows 搜索 `.exe`、`.com`、`.cmd`、`.bat`，但 Node `spawn` 的 `shell:false` 不应该直接宣称 `.cmd/.bat` 能启动；找到脚本时返回 `WINDOWS_WRAPPER_UNSUPPORTED`，以便后续适配安全 Java 入口。**不使用 WSL，不通过打开任意 shell 规避限制。**

### 静态状态

| 状态 | 含义 |
|---|---|
| `FOUND_NOT_PROBED` | 找到可执行文件，但尚未启动版本探测；Python module 也未检测可导入 |
| `MISSING_EXECUTABLE` | 未在指定目录/PATH 找到可运行入口 |
| `NEEDS_CONFIGURATION` | 缺少 JAR/官方安装的必要显式配置 |
| `MISSING_DEPENDENCY_FILE` | 已配置的 JAR 文件不存在或不可读 |
| `WINDOWS_WRAPPER_UNSUPPORTED` | 查到批处理包装器，但现有无 shell 运行器不能保证启动 |
| `NOT_RUN` | 没有进行原生工具执行或版本验证 |

## 编程接口

源码 `packages/runner/js/tool-manager.mjs` 导出 `toolInfo`、`environmentSearchPlan`、`inspectInstallation`、`inspectAllInstallations`。这些均为工具环境元数据/诊断；MCP 有只读 `inspect_native_installation`。消费方负责自身的模型、验证方案和结果语义。

**版本状态**：R1 目前为源码开发分支。Web 端纯 JS 策略自检不等于 Node CLI/MCP 与 13 个原生工具的运行验收。真实环境验收报告应注明 Git Exact-SHA。
