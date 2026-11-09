# formal-tools 工具维护与易用性优化计划 R1

> 状态：**规划草案（未实施）**
>
> 仓库：`kaicreator-mm/formal-tools`（由 `formal-tools-skill` 更名）
>
> 基线：`main@22466e346617a4725458a36f19616e0c0b97d375`
>
> 目标：**维护、封装和改善现有形式化与逻辑化工具，让它们更容易安装、配置、调用、集成、升级和排错。**
>
> 本项目 **不决定工具的使用场景、使用策略、验证内容、形式化模型、逻辑性质或业务结果**。

## 1. 唯一产品定位

formal-tools 是可复用的**形式化与逻辑化工具维护层 / Tooling Foundation**，为 `kaicreator-mm` 旗下各种项目提供稳定通用的工具接入能力，包括 `domain-simulator`，但不针对任何一个业务项目开发专属规则。

目标是工具层的工程质量，而不是某个项目的验证成效。

### 1.1 核心职责

| 职责 | 具体交付 |
|---|---|
| 工具清单与生命周期 | 统一登记工具、版本、下载/安装来源、依赖、支持系统与兼容状态 |
| 环境准备与检测 | 可执行文件发现、依赖检查、版本探测、诊断报告、可重复配置 |
| 原生 CLI 封装 | 维护原生参数透传、常用类型化操作、命令兼容适配，禁止伪造原生命令功能 |
| JS/TS 接口 | 统一 CLI、SDK（按需求发布）、MCP 调用入口和机器可读返回 |
| 运行可靠性 | 子进程、超时、资源预算、输出截断、临时目录、日志与退出状态 |
| 工具结果适配 | 保留原始输出，提取工具本身的状态、诊断、错误位置和生成制品；不评价业务命题 |
| 模拟/模型检查工具能力 | 封装官方模拟、状态探索、模型检查命令及其配置/输出/轨迹制品接口；不创建业务场景或模拟编排逻辑 |
| 兼容性与质量保障 | Windows/Linux、工具版本、依赖变化、正反例 fixture、MCP/CLI/SDK 回归、Woodpecker |
| 可选集成形式 | Skill、MCP、CLI、SDK、自动化脚本模板只是使用工具的**访问方式**，其中 Skill 不是项目核心或架构中心 |

### 1.2 明确不负责

- 不选择项目应使用哪个证明器，不自动判断“该业务用什么工具”。
- 不编写消费项目的形式化模型、性质或证明，不维护 ADS/DKE/DIS 的业务规则。
- 不设计验证工作流、业务模型审核流程、领域模拟场景、故障注入策略或业务生命周期。
- 不解释业务结果、不替调用方判断验证结论是否支持原始需求，也不做独立业务语义审查。
- 不取代 `domain-simulator` 的 Domain Data 模拟/分析/演化权威，不取代 `domain-harness` 生产 Runtime。
- 不重新实现 Lean/Z3/cvc5/TLC 等成熟工具，不建设统一跨语言 DSL，不为每个工具建设独立 MCP Server。
- 不自动更改消费者仓库、不自动提交项目证明、不授予发布权限、不对业务状态产生副作用。
- 不因项目数量增加而增加项目专属适配器；只有通用工具接口的缺陷或被两个以上消费者复现的兼容问题进入 formal-tools 的长期维护范围。

**工具支持和项目使用解耦：调用方负责准备输入、调用方法以及解释结果；formal-tools 负责官方工具的可用性与标准化技术接入。**

## 2. 现状与改进重点

基于 main 已有能力：

- 13 个原生工具族：Lean4、Z3、cvc5、TLA+/TLC、Apalache、Alloy、Soufflé、pySHACL、Vampire、Clingo、Apache Jena、ProB、Dafny。
- JS/TS Monorepo；纯 JS 小型有限算法作为现有辅助能力；Node 原生 Runner；CLI 53 个类型化操作及可信本地 raw 透传；MCP v2 8 个接口；14 个 Skill（包括 Router）。
- 旧本地 Agent 曾报告 32/32 Node 测试、26/26 原生正反例、12/12 MCP 验收，其 Exact-SHA 为 `f945fc50751f71e120c355661d63cce4f7041ea4`；之后 `main@22466e3...` 修复了原生工具在 Git 工作目录写入的风险，新回归仍未实际执行。**旧收据不自动证明新 SHA。**
- 原始执行日志部分只存在本地、Woodpecker 远程 Pipeline 未运行；注册表与 README 的历史状态以及 package 版本需要整理。

### 2.1 主要优化方向

1. **更易安装与配置**：通过工具 Manifest 描述运行需求和可执行文件位置，提供 `doctor`、`which`、`version`、`help`，并能够解释缺失依赖；不强制将所有证明器打包成一个巨型安装包。
2. **更易调用**：统一稳定参数类型、CLI/MCP 接口与错误码，原生命令的其余特性仍可在可信本地按原样透传。
3. **更易集成**：以无业务语义的请求和返回封套描述“运行某个已注册工具的已声明操作”，外部项目可选择自己的模型、语言、场景和运行次序。
4. **更易排错**：区分启动失败、工具退出、超时、输出上限、工具报告的错误；附原始 stdout/stderr 及哈希。
5. **更易升级**：工具版本与参数兼容矩阵、固定 fixture、差异比较和增量回归，避免升级后悄然破坏现有调用。

## 3. 技术架构：保留 Git Monorepo

```text
         arbitrary consuming applications
  (domain-simulator / domain-forge / other)
  own: inputs, models, business scenarios, decisions
                         │
        standard generic CLI / JS SDK / MCP APIs
                         ▼
     kaicreator-mm/formal-tools
  packages/
    core/             existing generic JS helpers
    runner/           existing process execution and CLI/MCP
    contracts/        proposed generic ToolRequest, ToolResult, Artifact
    tool-registry/    when needed: manifests and version/compat metadata
  skills/             optional access/adoption layer, not product center
  validation/         tool-level fixtures and runtime receipts
  .woodpecker/        tool-level compatibility and regression checks
                         │
                         ▼
           official CLI / executable / SDK
  Lean / Z3 / cvc5 / TLC / Apalache / Alloy / ...
                         │
                         ▼
     tool-native stdout, stderr, artifacts, trace
```

**少拆模块**：首先实现通用 contracts；Tool Registry 可以先继续存于现有 `registry/`，除非维护复杂度确实增加才独立分包。未出现真实维护需求前不新增 `simulation-orchestrator`、`project-model-manager`、`business-evidence-engine` 等模块。

### 3.1 工具请求（只描述技术执行）

`ToolInvocation` 建议包含：

- `tool_id`、`tool_version_constraint`、`operation`、`parameters`
- `inputs`（文件/数据或已授权工作区相对路径）、`output_policy`
- `execution_options`（超时、最大输出、CPU/内存/工作目录限制，按宿主能力）
- `invocation_id`、`caller_context`（不强制 Git 项目、领域模型、业务性质字段）

工具层不要求 `property_id`、`business_claim`、`project_model`、`domain_semantics` 等业务字段；调用方需要时自行封装在其业务层。

### 3.2 工具返回（不解释业务语义）

`ToolExecutionResult` 建议包含：

- `launch_status`、`exit_code`、`signal`、`timed_out`、`resource_limited`
- `tool_reported_status`（**由具体官方工具自身的定义解释**，例如 SAT/UNSAT、解析错误、验证完成；不做业务推广）
- `stdout` / `stderr` 摘要、完整输出制品引用与 SHA-256
- `generated_artifacts`（工具生成的模型、证明对象、轨迹和日志的路径、类型与 hash）
- `tool_version`、`binary_fingerprint`、`argv`、`execution_environment`、`elapsed_ms`
- `compatibility_warning`、`diagnostics`

历史 `test_verdict` / `claim_verdict` 只可作为向后兼容字段；新的通用工具接口**不以业务命题判断作为必需字段**。工具层测试的 PASS 表示 API/fixture 按工具规则工作，不表示某业务性质成立。

### 3.3 CLI / MCP / SDK 分工

- CLI 是主要通用调试入口，提供 `catalog`、`doctor`、`help`、`plan`、`exec`、`native`（可信本地），保留官方的全部 CLI 能力透传。
- MCP 为已注册、已类型化的工具接口提供受控访问，并允许查询版本、能力和运行状态；不暴露任意 shell 或原始命令。**不嵌入模型设计与验证目标选择。**
- JS/TS SDK 为消费项目提供可复用 `listTools`、`inspectTool`、`invokeTool`、`getArtifacts` 等 API；SDK 不直接承担业务编排。
- Skill 仅提供 Agent 对通用工具接口的访问说明，未来是否保留旧的业务属性路由器是兼容性/分工问题，不作为产品主线。

## 4. 模拟工具支持范围

模拟功能不是由本项目实现“领域模拟器”，而是**维护上游工具的模拟相关技术能力**：

| 工具类别 | formal-tools 支持 | 调用方负责 |
|---|---|---|
| TLC / Apalache | 模型检查、运行模式、范围/深度参数、原始轨迹制品 | 状态模型、性质、调度/场景与结果含义 |
| Alloy / ProB | 有限关系/状态探索 CLI、输出制品与反例文件 | 实体、状态含义、模拟问题、分析结论 |
| Z3 / cvc5 / Clingo 等 | 求解模式、模型输出、结果解析、超时与版本兼容 | 编码假设、公式、约束、场景设计 |
| Jena / pySHACL / Soufflé | 查询/规则工具执行与结果导出 | 知识建模、业务关系与约束设计 |

`domain-simulator` 可调用上述任何通用接口，**但它自己决定用哪个工具、模拟什么、如何组合工具、如何解释轨迹、怎样反馈演化**。formal-tools 不管理 Domain Data、场景、Evolution 或生产事实。

## 5. 分阶段实施（全部是工具工程任务）

### G0 — 定位与 R4 收口

- 完成仓库重命名后的品牌、包名/文档定位及兼容迁移方案；根名称 `formal-tools-skill` 若改名影响依赖，必须先确认引用方，不盲目改 npm ID。
- 最新 main Exact-SHA 的原生工作区隔离增量回归、必要的受影响验证。
- 归档已有本地原始执行收据，统一 version/registry/README 的状态归属，清除历史误导性 NOT_RUN；真正运行 Woodpecker 时再更新远程 CI 状态。

**G0 Gate**：位置清晰，回归通过，P0/P1=0，证据可回读，版本不冲突。

### G1 — 工具生命周期/可用性基础

- 统一工具 Manifest：id、官方来源、版本、OS/架构、依赖、执行入口与子命令、工具能力、受支持选项、已知兼容范围。
- 提升工具发现、`doctor`、安装/路径指引、版本探测与原因清晰的诊断；不强制在线下载、不覆盖用户已有安装。
- 整理 CLI 参数与本地 raw pass-through，消除版本漂移、缺少参数或进程启动方式错误的问题。

**G1 Gate**：13 个工具具备元数据、运行探测、故障反馈和可回归操作；不同版本差异可被明确标注。

### G2 — 统一通用 API 和执行可靠性

- 通用 `ToolInvocation` / `ToolExecutionResult` / `GeneratedArtifact` 契约。
- CLI/MCP/JS SDK 共用一套 Runner/Tool Adapter；完善进程启动、工作目录隔离、资源限制、输出收集与清理。
- 将各工具的格式化、查询、模型检查、模拟/探索等**官方功能**通过同一套技术接口输出；保留原始输出。
- 维护 Tool-native status adapter，不定义业务 proof claim status；MCP 原生命令透传继续关闭。

**G2 Gate**：CLI/MCP/SDK 对相同工具操作得到等价的机器可读运行信息；失败/超时/异常可靠，输入输出不会污染源工作树。

### G3 — 兼容性与质量体系

- 对 13 工具维护工具级正反例、典型错误、版本升级变化、Windows/Linux 调用差异及性能/资源行为。
- 固化工具版本指纹、命令行、输入输出制品 hash 和 Exact-SHA。
- Woodpecker 真实 Pipeline：静态 JS 检查与可用的原生 Tool Profile 分层执行；无 GitHub Actions。
- 以变化影响为依据运行增量回归，不因更改一个工具重复 13 个工具的完整安装/全量验证。

**G3 Gate**：各工具支持范围清楚、兼容矩阵可检索、CI 对主要工具层回归有真实记录。

### G4 — 通用消费接口验证

- 选外部消费者（可优先 `domain-simulator`）仅验证 **工具 API 接入兼容性**：调用已注册工具、传入测试数据、返回状态/产物、处理错误与超时。
- 不替消费者提供模型/领域场景，不承担任务编排或业务验证。
- 按真实兼容问题完善 SDK/MCP 的稳定性、向后兼容与文档，使任何项目都能用同一套接口调用工具。

**G4 Gate**：至少一个外部消费项目可稳定使用通用工具接口；其业务用法和结果不纳入 formal-tools 的产品验收。

## 6. Task DAG

| ID | 任务 | 依赖 | Gate |
|---|---|---|---|
| T01 | 产品定位、仓库更名与兼容迁移清单 | — | G0 |
| T02 | 最新 SHA 回归、原始收据/状态校准 | T01 | G0 |
| T03 | 13 工具 Manifest / 版本与来源清单 | T01 | G1 |
| T04 | 工具发现、环境探测、依赖/安装诊断 | T03 | G1 |
| T05 | 原生 CLI 参数及类型化操作兼容维护 | T03 | G1 |
| T06 | 通用 ToolRequest/Result 与隔离执行核心 | T04、T05 | G2 |
| T07 | 官方状态/错误/输出产物解析与回传 | T06 | G2 |
| T08 | MCP/JS SDK/CLI 对等接口及安全准入 | T06、T07 | G2 |
| T09 | 原生模拟/模型检查功能的技术适配完善 | T06、T07 | G2 |
| T10 | 多平台、版本兼容与工具级正反例回归 | T02、T08、T09 | G3 |
| T11 | Woodpecker 真实回归与兼容矩阵 | T10 | G3 |
| T12 | domain-simulator 等外部项目通用 API 接入冒烟测试 | T08、T09、T10 | G4 |

T04/T05 可并行；T08/T09 可并行。不要创建 ADS/DKE/DIS 的真实业务模型消费或验证 Lane；这些任务应由各自项目自主规划。

## 7. 执行规范与完成定义

- GitHub 权威源，复用现有运行验收 Issue #4，规划索引 Issue #7，计划 PR #8；12 个 Task 初始均 PLANNED。
- 按 ADS #1359 Delivery-First 执行工具工程任务：Web Builder 优先；仅在实际证明器、Node Host、Woodpecker 环境必需时交给本地 Agent；同一改动验证/修复合并，保持单 Writer。
- **工具层回归与业务验证不混淆**：测试一个工具的输出解析有效，不等于 ADS/DKE/DIS 的项目模型通过。
- 质量优先级：调用可靠性 > 兼容性 > 错误可理解性 > 集成易用性 > 新类型化操作。避免为了增加数量而扩张。
- 工具安装、升级及运行影响系统环境时，由调用方控制权限、资源和执行时机；本项目提供诊断与必要能力，不越权执行。
- **MVP 达成标准**：13 个原生工具可被稳定发现与调用、CLI/MCP/SDK 共享通用技术接口、各类工具返回机器可读诊断与原始产物、最新 SHA 回归、工具级跨平台兼容矩阵、可选外部消费项目接口冒烟验证；不含业务规则、模型或验证策略。

**本次计划替代 R0 中“跨项目源模型消费、ADS/DKE/DIS 三业务 Lane、工具选择和业务模拟编排”的产品范围。** 这些内容今后不进入 formal-tools 任务池，除非它们表现为可复用的工具接口/兼容性缺陷。
