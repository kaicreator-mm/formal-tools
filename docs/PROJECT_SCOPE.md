# formal-tools 产品边界

**formal-tools = 形式化与逻辑化工具维护与易用性项目。**

核心工作是维护已有证明器、求解器、模型检查器、逻辑工具的安装/依赖/发现、CLI 封装、JS/TS SDK、MCP、可靠执行、版本兼容、工具输出、回归测试与跨平台支持。

- **不决定工具该用于什么业务，也不决定调用者应该如何组织验证或模拟。**
- **不编写或治理消费项目的模型、性质、策略、场景、结果判断和演化。**
- **不等于 Skill 项目。** Skill 是可选访问载体，和 CLI/MCP/SDK 同级。
- **支持 \`domain-simulator\` 但不替代它。** formal-tools 提供原生模拟/检查工具的可用接口；domain-simulator 自己维护场景、领域语义、模拟/验证与演化。
- 不重新实现上游证明器，不设通用业务模型 DSL，不让 MCP 执行任意 shell。

详见 [R1 优化计划](roadmap/FORMAL_TOOLS_MAINTENANCE_PLAN_R1.md) 与 [R1 Task DAG](roadmap/FORMAL_TOOLS_TASK_DAG_R1.json)。

**兼容性注意**：历史 repo 名为 \`formal-tools-skill\`，root package manifest 仍使用该历史包名；未经依赖/用户检查，不直接更改包发布身份或 MCP 名称。项目名称已是 \`kaicreator-mm/formal-tools\`。
