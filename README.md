# formal-tools

**v0.0.1 — first consumer-facing MVP release candidate.** This repository is a Node.js/ESM Git monorepo for discovering, diagnosing and running formal/logic engines through a bounded **CLI, MCP, JS SDK and local Web UI**. The official `v0.0.1` GitHub tag and Release are created **only after [#180](https://github.com/kaicreator-mm/formal-tools/issues/180) is fully integrated and accepted on main**; a version field or candidate PR alone is not a published release.

**Start here:** [v0.0.1 integration guide](docs/INTEGRATION_V0.0.1.md) · [release scope and checklist](docs/releases/v0.0.1.md) · [changelog](CHANGELOG.md).

## What v0.0.1 supports

- **Discover and diagnose:** a unified 36-tool capability registry with existing `NATIVE_PROBE_PASS_SCOPED` evidence. That verifies bounded native fixture probes, **not 36 general-purpose user-input execution adapters**.
- **Actual bounded workflows:** typed `z3/solve-smt`, `cvc5/solve-smt`, `highs/solve-lp`, and `compare/cross-check` under a validated `ExecutionPlan`, budgets, input hashes and an execution receipt. Native binaries or the pinned portable bundle must be present on the trusted executor host.
- **LLM-assisted entry:** a bounded natural-language linear-integer constraint **translation proposal** in the Web workflow (DeepSeek when configured), with visible model review/edit, explicit approval and plan/result evidence. Natural-language fidelity is **not automatically proven**. The supported optimization route is a **continuous LP relaxation**, labeled `LP_RELAXATION_ONLY`, not exact mixed/integer optimization.
- **Consumers:** CLI for any language with subprocess support; local stdio MCP (`plan_workflow`, `execute_workflow`); JS SDK (`planWorkflow`, `executeWorkflowPlan`); local Web HTTP endpoints and browser UI. There is **no hosted public API, npm publication or unrestricted remote tool execution** in v0.0.1.

This project supplies the technical tool/execution layer. Applications supply their own domain problem, validated model, policy/authorization and interpretation of the mathematical result. It is independent of domain-harness/DIS.

## Requirements

- Node.js **20 or newer** on the trusted host; use whichever compatible version your deployment already supports (no Node 24-only requirement).
- `npm ci` in the repository root for MCP and TypeScript-related dependencies.
- Installed/verified native engines when execution is required. Planning and pure-JS checks do not silently install solvers.
- Optional `DEEPSEEK_API_KEY` on the host for real NL/method proposals; no key ⇒ `BLOCKED_PROVIDER`.
- `FORMAL_PORTABLE_ROOT` pointing to a trusted portable tool bundle for the bounded workflow executor. HiGHS may additionally require a matching pinned runner/bundle; see [limitations](docs/releases/v0.0.1.md).

## Quick start

```sh
npm ci
node packages/runner/js/cli.mjs list
node packages/runner/js/cli.mjs validate
node packages/runner/js/cli.mjs capabilities summary
node packages/runner/js/cli.mjs workflow plan --problem-file validation/mvp-user-e2e/fixtures/scenario-a.smt2 --compile
```

The last command writes `artifacts/<plan_id>/plan.json`, `launcher.mjs` and `manifest.json`. **It does not execute the plan.** Inspect the output and approve the concrete plan before running it on a trusted host:

```sh
node packages/runner/js/cli.mjs workflow execute --plan-file artifacts/<plan_id>/plan.json --source-sha <40-hex-source-git-SHA>
node packages/runner/js/cli.mjs workflow results --receipt artifacts/<plan_id>/receipt.json
```

Without the native bundle, expect a recorded `BLOCKED_TOOL_MISSING`/ABORTED outcome, **not PASS**.

Start stdio MCP (from the checked-out repository):

```sh
node packages/runner/js/mcp.mjs
```

Start the local Web UI (after the #180 Web PRs are merged):

```sh
node apps/web/server.mjs
```

Visit `http://127.0.0.1:8788/`. Loopback is the default; a non-loopback bind requires `FORMAL_WEB_TOKEN`. The Web bridge is **not a multi-tenant internet service**.

## API and compatibility

| Surface | Source | Notes |
| --- | --- | --- |
| CLI | `packages/runner/js/cli.mjs` | `workflow plan / execute / results` |
| MCP stdio | `packages/runner/js/mcp.mjs` | `plan_workflow` is planning-only; `execute_workflow` needs typed plan + `source_sha` |
| JS SDK | `packages/runner/js/sdk.mjs` | ESM on a trusted Node host; see guide |
| Web | `apps/web/server.mjs` | Local browser, bounded JSON API, explicit NL approval |

`formal-tools/execution-plan/1.0` and `formal-tools/execution-receipt/1.0` are **schema identifiers**, not the product SemVer. All package metadata is aligned to product `0.0.1` for this first release, while the historical package name `formal-tools-skill` and existing JS import paths remain intact for compatibility. The workspace packages are `private`; no claim of an npm registry artifact is made.

## Evidence, scope and support

The exact tool/operation support, real-host results and limitations must be checked at the **actual release tag commit**, not inferred from old CI receipts. See [#180](https://github.com/kaicreator-mm/formal-tools/issues/180), [#24](https://github.com/kaicreator-mm/formal-tools/issues/24), [workflow guide](docs/mvp/USER_GUIDE.md), [ExecutionPlan contract](docs/mvp/EXECUTION_PLAN_CONTRACT.md), [NL model contract](docs/mvp/NL_MODEL.md), [tool documentation](docs/TOOL_GUIDES.md) and [Woodpecker CI](docs/WOODPECKER_AGENT_INTEGRATION.md). Extra native user-input operations and refreshed HiGHS images belong to #24, not a v0.0.1 scope expansion.
