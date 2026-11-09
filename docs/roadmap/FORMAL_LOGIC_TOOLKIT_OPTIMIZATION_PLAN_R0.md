# 形式化与逻辑化工具集优化计划 R0

> **状态**：产品规划草案，非已实现功能。
>
> **仓库**：`kaicreator-mm/formal-tools`（原 `formal-tools-skill`）；规划基线 `main@22466e346617a4725458a36f19616e0c0b97d375`。
>
> **核心目标**：面向整个 `kaicreator-mm`，提供复用的形式化验证、逻辑推理、模型检查、模拟/探索、反例解释与可审计证据，不再由每个消费项目自行重复封装求解器。

## 1. 产品定位

平台应实现五项可供其他项目通过 JS/TS CLI、MCP、Woodpecker 调用的能力：

- **Verify / Prove**：SMT 约束、一致性、不变量、代码契约、定理证明，明确证明假设与作用范围。
- **Logical Analysis**：逻辑规则、依赖闭包、知识关系、冲突、RDF/SHACL 语义约束。
- **Model Check**：状态空间、并发交错、故障、死锁、安全性与活性，给出反例和所需的公平性假设。
- **Simulate / Explore**：有限步/有限状态探索、场景输入、故障注入、种子、覆盖率与可重放状态轨迹。
- **Evidence / Explain**：模型、性质、来源、工具/版本/二进制指纹、参数、边界、输出 Hash、反例、解释与 Exact-SHA 的可追溯链。

**评价指标从“封装多少工具”变为“对真实项目性质产生多少可重放、可独立审查的正确结果”。**

## 2. 产品边界（硬约束）

1. **不自己造证明器**：保留现有 Lean4、Z3、cvc5、TLC、Apalache、Alloy、Soufflé、pySHACL、Vampire、Clingo、Jena、ProB、Dafny。已有 13 个工具与 53 个类型化操作，后续只按实际项目需求扩展。
2. **不接管消费项目的业务语义/权限**：源规范、形式化模型的语义判断、发布准入、业务状态的最终权威仍在 ADS、Tally、Runx、DomainForge、DomainHarness 等各自项目。
3. **不重复建设 `domain-simulator`**：该项目现有职责是 Domain Data 的场景模拟、分析、验证与演化。本仓库提供底层逻辑求解、模型检查、轨迹/反例与证据，场景编排和演化权威仍属于 Simulator。
4. **不接管 `domain-harness` 生产 Runtime**，始终遵守：
   - `SimulationOutcome != ProductionFact`
   - `ValidationPass != PromotionDecision`
   - `Evolution != ProductionMutation`
5. **不先建大一统 DSL/中间语言、中央项目管理系统或每工具独立 MCP Server**。按需复用原生模型语言，统一请求/结果封套。
6. **不把 LLM 生成的形式化模型当作自动证明了原始业务需求**。模型编码必须独立审查语义忠实度。
7. **MCP 不开放任意命令执行**；现有完整原生参数透传仅限可信本地 CLI，不把原生 CLI 暴露为无控制 shell。
8. **不使用 GitHub Actions，不修改 Woodpecker Agent 二进制**；只通过标准 Pipeline Step 接入。

## 3. 当前基础与现实缺口

| 已有能力/证据 | 实际缺口 |
|---|---|
| 13 CLI + 53 类型化操作 + 本地原生参数透传 | 兼容性按安装版本验证，当前 main 的最后增量隔离修复尚无 Node 回归结果 |
| 纯 JS DAG/写集/CNF/显式有限状态检查 | 缺少真实消费项目的版本化模型输入、来源性质与依赖文件封套 |
| MCP v2 8 接口，能够查询能力、规划、运行固定 demo | 尚不能安全、正式地运行消费项目 Git+SHA 指定的任意**已准入模型** |
| 本地 Agent 报告 Node 32/32、Native 26/26、MCP 12/12 | 结果对应旧 HEAD `f945fc5...`，不能自动晋级为 `main@22466e3...` 运行 PASS |
| Woodpecker 静态配置与本地等价命令验证 | 真实远程 Woodpecker 运行未执行 |
| 协议与 R4 审核日志 | 原始执行收据仍有部分留在本地；注册表、README 中存在过时的版本/NOT_RUN 标记 |
| 13 Tool Skills + Router Skill | 尚无 ADS、DKE、DIS 的原始源文档 → 真实形式化模型 → 反例/回归的项目消费闭环 |

优先补齐 **可信执行和真实消费能力**，不要继续堆模拟用例或新 Solver。

## 4. 技术架构：保持 JS/TS Git monorepo

```text
kaicreator-mm consuming repo
  Source Spec + Model + Property + Assumptions + Exact Git SHA
                         |
                         v
formal-tools (单 Git monorepo)
  packages/core/        现有纯 JS 有限逻辑检查
  packages/runner/      现有 Node CLI、原生适配器和 MCP
  packages/contracts/   新增 Request/Result/Trace/Evidence Schema/TS
  packages/exploration/ 按需新增状态探索和模拟协调
  packages/evidence/    按需新增结果归档/重放/证据索引
  skills/               现有 13 Tool Skills + Router
  validation/           正反例、对抗、跨工具对照、回归
  integrations/         按需新增 Woodpecker/消费者集成模板
                         |
                         v
           Existing native solvers and analyzers
                         |
                         v
 Scoped Outcome + Counterexample/Trace + Evidence
                         |
                         v
 Independent semantic review in original consuming repo
```

只把 `contracts/` 列为必需新增模块；其他模块在出现多个真实消费者、现有 Runner 不再适宜时拆出，避免为分包而分包。Runner 是一套共享内核，CLI/MCP 不维护相互独立的结果解析实现。

### 4.1 请求、模型与来源契约

`VerificationRequest`/`SimulationRequest` 的建议字段：

- `request_id`、`project`、`repository`、`git_head`、`model_path`、`model_sha256`
- `property_id`、`property_source`、`assumptions`、`model_language`、`entry`、`property_kind`
- `mode=verify|prove|check|simulate|explore`、`engine_hint`、`allowed_profile`
- `budget={timeout_s,memory_mb,max_steps,max_states,max_output_bytes}`
- `scenario={initial_state,seed,horizon,faults}`（仅适用模型使用）
- `evidence_policy`、`artifact_refs`

运行时只从准入的 Git Exact-SHA 读取模型及依赖文件，复制到一次性的隔离工作目录，执行时不修改源项目工作树。该机制不是通用任意命令/代码执行服务。

### 4.2 结果契约和真实证明范围

必须分开五种判断：

1. `process_status`：启动、退出、超时、内存/输出等资源失败；
2. `solver_outcome`：SAT、UNSAT、PROVED、REFUTED、COUNTEREXAMPLE、UNKNOWN、ERROR 等，按引擎语义解析；
3. `test_verdict`：某个正/负测试是否达到期望；
4. `claim_verdict`：**源业务命题**是否有足够范围内证据支持，默认 `NOT_EVALUATED`，依赖独立语义评价；
5. `evidence/trace`：模型、假设、限制、原始输出哈希、工具版本、反例轨迹、可重放信息。

严禁 `exit 0 = proof`、`SAT = 真值已证明`、`bounded pass = universal proof`、`UNKNOWN = PASS`、`simulation trace = production fact`、`模型证明 = 自然语言需求等价证明`。

### 4.3 对外操作建议

| 功能 | CLI | MCP | 限制 |
|---|---|---|---|
| `list/catalog/select` | 是 | 是 | 适用性与成本 |
| `validate-model` | 是 | 是 | 准入模型、无副作用 |
| `verify-model` | 是 | 是 | 仓库+SHA+Profile，非任意原生命令 |
| `simulate/explore-model` | 是 | 是 | 有界/seed/可追踪、绝不修改生产 |
| `compare-engines` | 是 | 是 | 必须声明模型/语义可比；矛盾标记 DISAGREEMENT |
| `explain-counterexample` | 是 | 是 | 原始引擎输出为权威，LLM 解释只是辅助 |
| 任意官方原生参数透传 | 可信本地 CLI | 不提供 | 仅旧能力保留 |
| 生产状态变更/发布/晋级 | 不提供 | 不提供 | 由原项目权威处理 |

## 5. 首批跨项目真实验证用例

每个项目必须提供原始源、形式化性质/假设、至少一个能通过的例子和一个能揭示问题的负面突变，必要时提供可回放轨迹，并进行**独立语义忠实度评审**。

| 顺序 | 项目 | 首个高价值性质/模拟 | 首选工具 |
|---|---|---|---|
| 1 | `ai-development-standard`（ADS） | Task DAG、WriteSet 排他、Lifecycle 合法状态、并发反例 | 纯 JS / Alloy / Z3 / TLC |
| 1 | `domain-forge`（DKE） | Element 递归拆分、依赖闭包、全局约束冲突、增量演化影响 | Soufflé / Alloy / SHACL |
| 1 | `domain-harness`（DIS） | Function I/O、typed outcome、Package 依赖/兼容及 Runtime 约束 | Z3 / cvc5 / Dafny |
| 2 | `tally` | Active TaskDAG 状态、任务就绪/完成、并发提交权威 | Alloy / TLC |
| 2 | `runx` | 资源分配互斥、超时、故障恢复、释放与活性 | TLC / Apalache / Z3 |
| 2 | `domain-simulator` | 消费引擎生成的逻辑约束、反例与可重放场景轨迹 | 模型检查器 + 标准 Trace |
| 按需 | 其他 `kaicreator-mm` 项目 | 消费方自己定义一条高价值性质 | Router 推荐 |

**MVP 的项目消费门槛**：ADS、DKE、DIS 三种不同语义各有一个真实来源可追溯的案例，完成正负测试、反例/证据、独立模型忠实度审查。后续其他项目不反向阻塞 MVP。

## 6. 五个里程碑和验收 Gate

### M0 / G0：R4 收口与证据可信性（P0）

- 在最新 Exact-SHA 跑输入隔离回归，尽量复用旧 26 项执行收据，只重跑受最后修复影响的测试。
- 将原始执行证据保存为 Git 内的索引 + 大文件制品 Hash/引用，避免依赖不可访问的本地临时目录。
- 统一 README、`package.json`、`registry/INTERFACES.json` 和 Skill 的版本/运行状态；保留各历史 SHA 的不同状态。
- 在真实 Woodpecker 上执行 JS 静态流水线；未触发则如实记录，Native CI 可后续增量完成。

**Gate G0**：最新版回归通过、P0/P1=0、证据可复核、注册表事实一致。

### M1 / G1：真实模型的 CLI/MCP 安全消费（P0）

- 定义 Request/Result/Trace/Evidence 版本化 JSON Schema 与 TS 类型。
- 实现 Git+SHA Model Manifest、关联文件引用、隔离临时执行、固定引擎 Profile、资源上限和命令准入。
- 首先实现 `verify-model`，覆盖两种不同原生模型语言，如 SMT-LIB + TLA+。
- MCP 与 CLI 使用同一 Runner；MCP 不传 raw argv、不接受未经授权主机路径。

**Gate G1**：真实项目模型能被调用；PASS/COUNTEREXAMPLE/UNKNOWN/ERROR/timeout 分开分类；原项目工作树零副作用。

### M2 / G2：逻辑探索、模拟与反例（P1）

- 增加有限状态/有限步/有界搜索、seed 和 fault scenario 的模拟协议，支持可重放 trace。
- 状态/事件序列含触发 Property、假设、覆盖边界；明确不能保证确定性重放的工具限制。
- Router 使用 `Property Kind + Language + Proof Scope + Cost` 选择工具；两工具语义可比时才交叉验证。
- 模型生成与语义忠实性独立审核，跨求解器冲突不以多数票判定。

**Gate G2**：至少两类模型可探索，一个负例可按同版本与参数复现，且不把有界结果标成普遍证明。

### M3 / G3：跨项目消费（P1，三条 Lane 并行）

- ADS：真实 Task DAG/Writer/Lifecycle。
- DKE：真实 Element 递归/冲突/增量。
- DIS：真实 Function 契约/typed outcomes/Package 依赖。
- 模型来源、业务判断及 PR 归消费项目所有；本工具集沉淀适配器、最小案例、工具 Profile 和可共享经验。

**Gate G3 — 首个可用的跨项目工具集版本**：三种不同项目各 1 条项目级性质完成源语义审查、正负验证、可审计记录、P0/P1=0。

### M4 / G4：组织级复用和 CI（P2）

- 扩展 Tally、Runx、domain-simulator，选择至少两个不同项目的新增高价值案例。
- Woodpecker Native Step 用摘要固定的镜像及 CPU/内存/时间限制；尽量复用旧版本实测结果。
- 建兼容矩阵（Host OS、engine 版本、CLI flags、模型语言、已测案例、已知限制）。
- 更新 Skills/Quickstart：“输入项目模型 → 选择/执行 → 结果解释 → 反例/收据”。

**Gate G4**：两个扩展消费者可复现，真实 CI 留存记录，维护矩阵可依据版本差异进行增量回归。

## 7. 任务 DAG

| Task | 交付项 | 前置依赖 | 优先级 |
|---|---|---|---|
| T01 | 最新 SHA 回归、隔离输入复核 | 无 | P0 |
| T02 | 原始收据归档、版本与状态同步 | T01 | P0 |
| T03 | 请求/结果/轨迹/证据 Schema | T02 | P0 |
| T04 | Git+SHA 模型准入与安全临时工作区 | T03 | P0 |
| T05 | 两类原生模型的可调用验证 API | T04 | P0 |
| T06 | 状态/场景模拟与反例重放 | T04、T05 | P1 |
| T07 | 工具路由、差异对照、结果解释 | T03、T05 | P1 |
| T08 | ADS 真实模型消费 | T06、T07 | P1 |
| T09 | DKE 真实模型消费 | T06、T07 | P1 |
| T10 | DIS 真实模型消费 | T06、T07 | P1 |
| T11 | Woodpecker 真正运行及 CI 收据 | T02、T05 | P1 |
| T12 | Tally/Runx/Simulator 扩展及兼容矩阵 | T08、T09、T10、T11 | P2 |

T08/T09/T10 在共同工具链冻结后可并行，模型写入仍由各自项目独立 Writer 完成；T11 可并行。当前首要阻塞是 **T01/T02**，但 ADS/DKE/DIS 的源性质选取可提前只读准备。

## 8. 实施原则与完成定义

- **GitHub 单一事实源**；主 Issue + Git 版本化计划/证据 + 按需子 Issue/PR；现有 Issue #4 继续负责 R4 运行收口，不重复创建同类问题。
- **ADS #1359 Delivery-First**：优先 Web Builder，原生真实执行与 Woodpecker 必须时才交本地；同一 Task 的验证/修复不可拆成两个 Writer。
- 先完成 G0→G1→G2→G3 的可用版本，G4 扩展不会阻塞首个跨项目交付。
- 每个性质的收据包含 Source SHA/Property、Model Hash、工具二进制指纹、版本与 argv、资源限制、假设、solver_outcome、test_verdict、claim_verdict、trace/evidence hash。
- 未完成验收返回明确的 NOT_RUN；超时/未知返回 UNKNOWN/INCONCLUSIVE；判定有冲突时返回 DISAGREEMENT，不伪造 PASS。
- 不因“更多验证轮次”推迟产品交付，也不强制所有 13 个证明器每次执行。

**优化顺序建议**：T01→T02→T03→T04→T05，随后 T06/T07 并行，再推进 ADS/DKE/DIS 三个实消费 Lane。只有真实项目消费成功后才扩大工具面。
