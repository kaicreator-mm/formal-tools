# Experimental staged native tool SDK (R1 integration)

`invokeStagedTool({tool,operation,sourceRoot,inputs,settings,timeoutS,workspaceOptions,artifactOptions})` composes the existing **trusted Node** SDK runner with new generic input and output helpers. It is a general-purpose tool invocation primitive; consumer projects decide which tool, what input, what scenario and how to interpret results.

1. Validate the registered typed operation and require every declared and recognized file-backed input option (for example `config`, `shapes`, `ontology`, `data`, `query`, `facts`) to reference an explicitly staged source-relative file. Reject absolute paths and `..` traversal in all string options, including optional output paths, before creating a workspace.
2. Copy caller-selected regular input files into a unique private temporary workspace; hash inputs and preserve relative paths.
3. Build a full artifact baseline (must be COMPLETE), invoke the upstream tool **with working directory set to that private workspace**, and inventory generated/changed files.
4. Return `formal-tools/tool-execution/1` technical results plus `staging` input hashes and `artifacts` entries; ensure private workspace cleanup in `finally`.
5. On TIMEOUT/OUTPUT_LIMIT the artifacts manifest is marked PARTIAL, never misreported as a complete upstream result. If an engine was never started, artifacts stay NOT_COLLECTED.

This does **not** reimplement solver semantics, choose business properties, build domain simulation scenarios or claim a secure OS sandbox. Callers remain trusted; upstream programs may still access external resources independently of the arguments, so the new option path checks do not constitute OS isolation, and upstream executables must be appropriate for a trusted host. The input set contains exactly the explicitly named files—dependencies are not inferred. Files larger than default scanner budgets require explicit limits, otherwise execution fails closed.

```js
import {invokeStagedTool} from "./packages/runner/js/sdk.mjs";
const result=await invokeStagedTool({
  tool:"z3",operation:"solve",
  sourceRoot:"./verified-models",
  inputs:["model.smt2"],
  settings:{input:"model.smt2"},
  timeoutS:15
});
console.log(result.process.status,result.tool_status,result.artifacts.status);
```

`tests/staged-sdk.test.mjs` tests required-input rejection, unavailable engine safety, and (on POSIX) a temporary fake solver that writes a trace and mutates a *copy* of its input. Actual installed Z3/Lean/TLC versions and other native tools are not exercised by the fake solver. Existing CLI and MCP raw-command restrictions remain unchanged.

**Rollout:** experimental SDK only until Node/TypeScript tests on the final Exact-SHA, generated-output fixtures, compatibility review and publishing/export gates are complete. No separate application or business validation is required inside formal-tools.
