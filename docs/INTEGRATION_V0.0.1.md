# formal-tools v0.0.1 — consumer integration

Status: **release candidate documentation**. Use a final `v0.0.1` GitHub tag **only after** the requirements in [the release checklist](releases/v0.0.1.md) are met. Until then, use a reviewed, pinned Git commit and do not claim a final v0.0.1 deployment.

## 1. Choose one integration surface

| Consumer | Recommended entry | Execution |
| --- | --- | --- |
| Any subprocess-capable application | Node CLI `workflow` | Real on trusted host with native engines |
| Agent or application with an MCP host | Local stdio `mcp.mjs` | `execute_workflow` only; typed plan and source SHA required |
| Node.js application | ESM `sdk.mjs` | `planWorkflow`, `executeWorkflowPlan` |
| Browser/local application | `apps/web/server.mjs` | Local HTTP/Web UI; plan review and approval |

The **tool Registry** and the **user-operation allowlist** are different. 36 registered tools have scoped native probe evidence; the first bounded Workflow execution allowlist is **Z3 SMT, cvc5 SMT, HiGHS LP and internal cross-check**. Other CLI native adapters are governed by their own tool-specific contracts; do not infer that the workflow executor accepts them.

## 2. Install and pin the host

```sh
git clone https://github.com/kaicreator-mm/formal-tools.git
cd formal-tools
# Once the GitHub Release actually exists:
# git checkout --detach v0.0.1
npm ci
node packages/runner/js/cli.mjs validate
node packages/runner/js/cli.mjs capabilities summary
```

Required Node: **>=20**. The monorepo packages are private workspace packages; v0.0.1 is a **Git/tag/source release**, not an npm registry package. An application must run a trusted process or vendor/import the source explicitly; do not suggest `npm install formal-tools@0.0.1`.

For native execution, prepare the trusted portable tools and set `FORMAL_PORTABLE_ROOT` to their verified bundle root. Verify Z3/cvc5 and the tool versions on the **actual executor**, not only in the calling application. An absent bundle produces a fail-closed blocked receipt. HiGHS may also require `FORMAL_PORTABLE_RUNNER_SHA256` and a bundle with the canonical pinned operation script. Earlier published r0/r1 images had pin/version drift; see [release limitations](releases/v0.0.1.md) and #24 before enabling HiGHS for consumers.

## 3. CLI: input → review → execute → receipt

Put real SMT-LIB2 text into a file or reuse the committed example:

```sh
node packages/runner/js/cli.mjs workflow plan \
  --problem-file validation/mvp-user-e2e/fixtures/scenario-a.smt2 \
  --compile
```

The output reports a `plan_id`; `--compile` saves `artifacts/<plan_id>/plan.json`, `launcher.mjs` and `manifest.json`. **Planning never executes**. Read the JSON and any assumptions before executing:

```sh
node packages/runner/js/cli.mjs workflow execute \
  --plan-file artifacts/<plan_id>/plan.json \
  --source-sha <40-hex-git-commit>
node packages/runner/js/cli.mjs workflow results \
  --receipt artifacts/<plan_id>/receipt.json
```

`source_sha` identifies **the caller's actual source**; do not replace it with the task/problem digest. Typed `ExecutionPlan` and `ExecutionReceipt` schemas are documented in [ExecutionPlan](mvp/EXECUTION_PLAN_CONTRACT.md) and [receipts](mvp/EXECUTOR_RECEIPTS.md). Prefer machine-readable result fields over assuming process exit 0 means the mathematical claim passed.

For optional method proposal, `workflow plan --provider deepseek` makes a **real provider call** and requires `DEEPSEEK_API_KEY` only in the host environment. It does not translate arbitrary prose into verified SMT semantics. Do not pass API keys on the CLI.

## 4. MCP: trusted stdio server

Start or configure an MCP host to launch the following process from the checked-out repository:

```sh
node packages/runner/js/mcp.mjs
```

Use the host's normal `command`, `args` and working-directory configuration; the server communicates **JSON-RPC over stdio**. Invoke `plan_workflow` with actual SMT-LIB2 `problem_text` (default deterministic z3+cvc5 plan). It does not run anything. After application-level review, pass the complete typed plan and the **required 40-hex `source_sha`** to `execute_workflow`. Optional budget caps may only tighten the plan. Do **not** pass arbitrary argv or an execution shell command.

The MCP handshake identity remains `formal-tools-skill` for compatibility; its version is `0.0.1`. MCP returns distinct process/solver/cross-tool/claim outcome fields and receipt artifact pointers. The underlying host must still possess real tools and trust the submitted source and execution authority.

## 5. JS SDK: ESM trusted host

From the repository root, a minimal example that **only plans**:

```js
import { planWorkflow, compileWorkflowPlan, executeWorkflowPlan } from './packages/runner/js/sdk.mjs';

const smt = [
  '(set-logic QF_LIA)',
  '(declare-const x Int)',
  '(assert (> x 0))',
  '(assert (< x 0))',
  '(check-sat)',
  '(exit)'
].join('\n');

const { plan } = await planWorkflow({ problemText: smt });
const compiled = compileWorkflowPlan(plan);
console.log(compiled.plan.plan_id, compiled.manifest);

// Only with explicit consumer authorization and a trusted native host:
// const { receipt } = await executeWorkflowPlan(compiled.plan, {sourceSha: '<actual-source-git-sha>'});
// console.log(receipt.claim_verdict);
```

**Do not** expose `executeWorkflowPlan` or the general `invokeTool` SDK as an unrestricted remote execution service. Formal-tools validates typed operations and budgets; the caller owns model correctness and access authorization.

## 6. Web: local browser and bounded API

After the Web code is merged into `main` (it is not present in the early #204-only baseline):

```sh
node apps/web/server.mjs
```

Default browser address: `http://127.0.0.1:8788/`. The server defaults to loopback; setting `HOST` to a non-loopback interface requires a nonempty `FORMAL_WEB_TOKEN`. **Do not expose this development bridge directly to the public internet.**

Supported flow:

1. Enter the bounded linear constraint problem, or paste a supported SMT/LP form.
2. For natural language, the real DeepSeek provider produces a **proposal**, not a validated translation; without `DEEPSEEK_API_KEY`, show `BLOCKED_PROVIDER`.
3. Inspect variables, bounds, constraints, assumptions and rendered SMT; re-validate edits before approval. Rejection ends the same proposal. After approval, review the exact plan and execute.
4. Download receipt/manifest and understand full-stream hashes versus bounded log copies. A failed or missing tool must not appear as PASS.

The HTTP surface includes `POST /api/nl/propose`, `POST /api/nl/revise`, `POST /api/nl/approve`, `POST /api/runs`, `GET /api/runs/:id` and `GET /api/runs/:id/evidence`. The server requires an NL approval binding for NL-origin executions once the #207 stack is integrated. HTTP UI approval is **not** proof that a distinct human reviewed the translation: evidence from an automation/surrogate must remain labeled as such.

## 7. Capability and result boundaries

- A sat/unsat result addresses the **rendered mathematical model**, not the truth of the original business text. Consumer applications must validate input modeling and decide what solver outcomes mean.
- `AGREE_SAT`, `AGREE_UNSAT`, process `OK` and claim `PASS` are different assertions. Preserve the fields, input/version digests and receipt.
- Exact integer optimization is **unsupported** by this v0.0.1 HiGHS operation; LP relaxation requires explicit acknowledgement and `LP_RELAXATION_ONLY` labeling.
- No universal NL planner, arbitrary language parser, all-36 typed operation coverage, remotely hosted API, multi-tenant permissions or npm distribution is guaranteed.
- No required dependency on `domain-harness`.

See [the detailed MVP user guide](mvp/USER_GUIDE.md) and the [#180 controller](https://github.com/kaicreator-mm/formal-tools/issues/180). Tool expansion and HiGHS image remediation remain with [#24](https://github.com/kaicreator-mm/formal-tools/issues/24).
