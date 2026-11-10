# G1 统一问题能力矩阵（R0）

> 权威：[Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11)。这是**发现目录**，不是安装清单、运行时授权或证明记录。

**静态规模**：23 个 Capability；36 个 Tool Reference（13 个 native-ref + 23 个 candidate）。

## 按问题能力索引

| 能力 ID | 适用问题 | 候选工具 | 验证局限 |
|---|---|---|---|
| `logic.smt` | SMT约束 | z3、cvc5、apalache | Only proves satisfiability of encoded formula |
| `proof.deductive` | 演绎证明 | lean4、cvc5、vampire、dafny、why3 | Assumptions and proposition require semantic review |
| `model.state` | 状态模型检查 | tla-tlc、apalache、alloy、prob、nuxmv | Bounds/abstractions matter |
| `model.relational` | 关系模型 | alloy | Finite scopes may not prove universal properties |
| `logic.rules` | 规则推理 | souffle、clingo | Rule/closed-world assumptions matter |
| `knowledge.rdf` | RDF/SHACL | rdf-shacl、apache-jena | Shape compliance is not factual accuracy |
| `opt.combinatorial` | 组合优化 | clingo、ortools、minizinc | Objective and feasibility are model-relative |
| `opt.numerical` | 数值优化 | ortools、highs | Numerical tolerance/gap is significant |
| `math.symbolic` | 符号数学 | sympy | Domains and assumptions must be explicit |
| `graph.algorithms` | 图论/DAG | networkx | Graph completeness must be verified |
| `test.property` | 属性测试 | fast-check、hypothesis | No failure found does not prove correctness |
| `test.fuzz` | 模糊测试 | aflpp | Coverage remains partial |
| `code.verify` | 程序验证 | dafny、cbmc、kani | Program semantics and boundedness matter |
| `model.probabilistic` | 概率模型检查 | storm、prism | Requires calibrated transition probabilities |
| `stats.bayesian` | 贝叶斯推断 | pymc | Posterior depends on model and data |
| `planning.classical` | 自动规划 | fast-downward | Action preconditions and effects are model-dependent |
| `causal.inference` | 因果推断 | dowhy | Confounding and identifiability matter |
| `causal.discovery` | 因果发现 | causal-learn | Observed association is not causal proof |
| `ontology.inference` | OWL推理 | elk | Inference depends on ontology semantics |
| `ontology.processing` | 本体处理 | robot | Transform correctness needs separate verification |
| `code.syntax` | 语法树分析 | tree-sitter | Parsing does not verify semantic meaning |
| `sim.discrete` | 离散事件模拟 | simpy | Simulation has no automatic real-world validity |
| `sim.agent` | 多智能体模拟 | mesa | Agent assumptions are external |

## 工具分层

| 工具 ID | 现有引用或候选 | 优先级 | 能力 | 分发 | 状态 | 使用边界 |
|---|---|---|---|---|---|---|
| [`lean4`](https://lean-lang.org/) | native-ref | existing | `proof.deductive` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`z3`](https://github.com/Z3Prover/z3) | native-ref | existing | `logic.smt` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`cvc5`](https://cvc5.github.io/) | native-ref | existing | `logic.smt`、`proof.deductive` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`tla-tlc`](https://github.com/tlaplus/tlaplus) | native-ref | existing | `model.state` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`apalache`](https://github.com/apalache-mc/apalache) | native-ref | existing | `model.state`、`logic.smt` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`alloy`](https://github.com/AlloyTools/org.alloytools.alloy) | native-ref | existing | `model.relational`、`model.state` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`souffle`](https://github.com/souffle-lang/souffle) | native-ref | existing | `logic.rules` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`rdf-shacl`](https://github.com/RDFLib/pySHACL) | native-ref | existing | `knowledge.rdf` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`vampire`](https://github.com/vprover/vampire) | native-ref | existing | `proof.deductive` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`clingo`](https://potassco.org/clingo/) | native-ref | existing | `logic.rules`、`opt.combinatorial` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`apache-jena`](https://jena.apache.org/) | native-ref | existing | `knowledge.rdf` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`prob`](https://prob.hhu.de/) | native-ref | existing | `model.state` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`dafny`](https://dafny.org/) | native-ref | existing | `proof.deductive`、`code.verify` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`ortools`](https://developers.google.com/optimization) | candidate | A | `opt.combinatorial`、`opt.numerical` | pypi | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`sympy`](https://www.sympy.org/) | candidate | A | `math.symbolic` | pypi | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`networkx`](https://networkx.org/) | candidate | A | `graph.algorithms` | pypi | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`minizinc`](https://www.minizinc.org/) | candidate | A | `opt.combinatorial` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`fast-check`](https://fast-check.dev/) | candidate | A | `test.property` | npm | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`hypothesis`](https://hypothesis.readthedocs.io/) | candidate | A | `test.property` | pypi | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`highs`](https://highs.dev/) | candidate | A | `opt.numerical` | pypi | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`cbmc`](https://www.cprover.org/cbmc/) | candidate | A | `code.verify` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`storm`](https://www.stormchecker.org/) | candidate | B | `model.probabilistic` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`fast-downward`](https://www.fast-downward.org/) | candidate | B | `planning.classical` | source | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`dowhy`](https://www.pywhy.org/dowhy/) | candidate | B | `causal.inference` | pypi | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`pymc`](https://www.pymc.io/) | candidate | B | `stats.bayesian` | pypi | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`why3`](https://why3.org/) | candidate | B | `proof.deductive` | source | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`elk`](https://github.com/liveontologies/elk-reasoner) | candidate | B | `ontology.inference` | java | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`kani`](https://model-checking.github.io/kani/) | candidate | B | `code.verify` | rust | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`tree-sitter`](https://tree-sitter.github.io/tree-sitter/) | candidate | B | `code.syntax` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`prism`](https://www.prismmodelchecker.org/) | candidate | C | `model.probabilistic` | native | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`nuxmv`](https://nuxmv.fbk.eu/) | candidate | C | `model.state` | license-review | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`aflpp`](https://aflplus.plus/) | candidate | C | `test.fuzz` | source | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`simpy`](https://simpy.readthedocs.io/) | candidate | C | `sim.discrete` | pypi | NOT_ASSESSED | DOMAIN_SIMULATOR |
| [`mesa`](https://mesa.readthedocs.io/) | candidate | C | `sim.agent` | pypi | NOT_ASSESSED | DOMAIN_SIMULATOR |
| [`causal-learn`](https://github.com/py-why/causal-learn) | candidate | C | `causal.discovery` | pypi | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |
| [`robot`](https://robot.obolibrary.org/) | candidate | C | `ontology.processing` | java | NOT_ASSESSED | FORMAL_TOOLS_GENERIC |

## 注册表与真实工具的单源设计

- 原生 Tool ID / 操作 / argv / runtime profile 只以 `packages/runner/js/native-catalog.mjs` 为权威；能力目录的 13 条 native-ref 是**外键引用**，由 `validateCapabilityRegistry` 对其进行严格集合比较，不承诺覆盖运行环境。
- 候选 23 条只允许作为能力发现提示，不得传给现有 `invokeTool` 并自称已经可执行。实际适配和独立二进制验收属于 G3 以后。
- `problem-capabilities.mjs` 提供 `readCapabilityRegistry()`、`listProblemCapabilities()` 和 `discoverTools(capabilityIds, {includeCandidates})`。请求必须显式提供已有能力 ID；**自然语言识别/LLM Method 生成不属于 G1**。
- 初始所有可用性均为 `NOT_ASSESSED`，`runtime_verified=false`，`version=null`，`evidence_ref=null`；工具下载进行中，不等于下载/安装/原生验证完成。实际运行时状态必须由宿主出具收据。
- `simpy`、`mesa` 的语义执行归 `domain-simulator`，此处只登记可发现的通用工具接口；`domain-forge` 仍负责知识来源、事实和 DKE 演化。

## G1 退出门禁

1. 23 能力码、36 工具映射完整，且与 native-catalog 的 13 条 ID 严格一致；不新建 CLI 运行器、不改变 R1。
2. Node 测试覆盖重复 ID、缺少/伪造原生工具、未知能力、虚假 NATIVE_VERIFIED、NEEDS_SOURCE 缺失和只发现不执行。
3. 机器可读结果保留 `UNKNOWN`/`NOT_RUN`/`UNVERIFIED`；任何方法资格和业务语义判断留待 G2/G3。
4. 精确 HEAD 上的 `node --test tests/problem-capabilities.test.mjs` 与 `node --test tests/*.test.mjs` 需实际执行才能关闭 G1 运行验收。此文档编写时不声称已经执行。
