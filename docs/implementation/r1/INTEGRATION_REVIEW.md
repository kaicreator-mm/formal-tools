# R1 integration: PR #9 → main, then PR #10 staged SDK

**Product boundary**: Only general-purpose formal and logic tool maintenance, invocation and artifacts; no business model, solver-selection strategy, domain-simulator scenarios or project-level property claims.

## Actual predecessor acceptance

PR #9 was merged into main at `41925288dd5b777d49c4e442d9731581895cb037`. Windows Node/TypeScript/MCP tests passed; real Woodpecker on local-backend Linux passed 52/52 tests at PR #9 source HEAD `fc8899a6b3fc69636fffdfbd17fc74f8b4fb63e4`. Native formal engines were absent on Windows, so 13/26 native checks remain NOT_VERIFIED/INCONCLUSIVE. That state is retained; it is not a blocker for implementing generic Tool SDK code.

## Current PR #10 implementation

1. `tool-workspace.mjs` stages chosen source files in a private workdir, hashes bytes, rejects symlinks and traversal/case/reserved-file aliases.
2. `artifact-collector.mjs` computes baseline and post-execution SHA-256 manifests, reporting only changed/added files as technical artifacts.
3. `compatibility-matrix.mjs` emits a read-only 13-tool technical inventory with multiple host/version observations, including STALE_SHA and REPORTED_UNREVIEWED.
4. `sdk.mjs` adds `invokeStagedTool`: validates a registered typed operation with declared file parameters, stages only explicit inputs, baselines, invokes native from the staged workdir, scans outputs, and always cleans tempfiles. NOT_STARTED keeps artifacts NOT_COLLECTED; timeout/output-limit becomes PARTIAL.
5. No arbitrary raw command added to MCP or SDK. No dependency guessing, no OS sandbox or external business acceptance. SDK result fields are technical only.

## CI and host acceptance

- `node --test tests/*.test.mjs` is the real automated regression gate in `.woodpecker/formal-static.yaml`; source PR #9 CI PASS does **not** imply PR #10 CI PASS.
- Required new Node tests: `tests/tool-workspace.test.mjs`, `tests/artifact-collector.test.mjs`, `tests/compatibility-matrix.test.mjs`, `tests/staged-sdk.test.mjs`. The last one tests a fake POSIX Z3 fixture solely for staging/output boundaries, not a proof engine.
- `npm run typecheck` must be run with Node/TypeScript dependencies on the current PR #10 exact HEAD. Fix issues in this same PR and rerun.
- After Node/tsc/CI green, tag D06/D07 as staged-API accepted but leave full host resource limits, stable published SDK exports and the real 13-tool version matrix as explicit follow-ups.
- Do not rerun all 26 native proof fixtures just because new artifact inventory code was added; use targeted tool tests if a real host with the selected engine exists. No GitHub Actions.

**Ownership:** PR #9's local Agent Writer is complete and merged; PR #10 is now the sole integration Writer for these shared files.

## Web 端技术契约模拟检查

已对 `invokeStagedTool` 的执行顺序和失败分支进行 14/14 项受限 JS Mock 检查：非法操作或未暂存输入在运行前拒绝、正常结果归档、源输入记录、超时输出标 PARTIAL、未启动不标 COLLECTED、扫描错误降级及异常路径执行 cleanup。该测试不包含真实文件系统、Node 子进程或原生证明器运行；最终 Node/CI 的判定仍以对应新 HEAD 收据为准。
