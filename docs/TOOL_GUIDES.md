# 13 个形式化工具速查

| 工具 | 理论类型 | 推荐用途 | CLI / MCP 指南 |
|---|---|---|---|
| Lean 4 | 依赖类型论（dependent type… | 通过 lean 编译并验证 .lean 定理；禁止 s… | [打开](tool-guides/lean4.md) |
| Z3 | SMT（可满足性模理论）：将布尔与整数、… | 通过 z3 -smt2 检查 SMT-LIB 文件；可… | [打开](tool-guides/z3.md) |
| TLA+ / TLC | 时序逻辑与状态迁移系统：描述初始状态、下… | 通过 Java 加载 tla2tools.jar 对 … | [打开](tool-guides/tla-tlc.md) |
| Apalache | 将 TLA+ 状态约束转化为 SMT 约… | 调用 apalache-mc check，并固定初始谓… | [打开](tool-guides/apalache.md) |
| Alloy 6 | 关系逻辑与有限域模型查找：用 sig、f… | 在 .als 中定义结构和不变量，用官方 Analyz… | [打开](tool-guides/alloy.md) |
| Soufflé | Datalog 的 Horn 规则和不动… | 在 .dl 生成可达性和循环检测关系；检测目标必须作为… | [打开](tool-guides/souffle.md) |
| pySHACL / SHACL | RDF 图上的形状约束验证：用 SHAC… | 使用独立 data.ttl / shapes.ttl … | [打开](tool-guides/rdf-shacl.md) |
| cvc5 | 基于 SMT 理论求解，支持位向量、算术… | 使用 cvc5 --lang smt2 执行；与 Z3… | [打开](tool-guides/cvc5.md) |
| Vampire | 一阶逻辑自动定理证明：归结与超位置演算搜… | 使用 Vampire 的 --mode casc 等模… | [打开](tool-guides/vampire.md) |
| Clingo | 答案集编程（ASP）和非单调逻辑：以规则… | 通过 Python -m clingo 列出答案集；区… | [打开](tool-guides/clingo.md) |
| Apache Jena | RDF 图、SPARQL 代数与语义网络… | 先 riot 校验 Turtle，再 arq 执行查询… | [打开](tool-guides/apache-jena.md) |
| ProB | B / Event-B 的集合论、谓词逻… | 使用 probcli -model_check 验证 … | [打开](tool-guides/prob.md) |
| Dafny | Hoare 风格的程序契约、最弱前置条件… | 用 dafny verify 检查 .dfy 文件，区… | [打开](tool-guides/dafny.md) |

**约定：** 以上为工具原生 CLI 参考及统一适配路径，并不代表原生 MCP 存在或二进制已实际验证。共享 Runner v0.1 提供固定仓库 fixture 的 13 工具路由；性能与运行可靠性尚待真实 CI 证明。
