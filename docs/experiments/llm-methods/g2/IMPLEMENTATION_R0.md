# G2 R0 — LLM Method Proposal + Fail-Closed Static Gate

**Authority:** [Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11) · **Research R0 admitted:** PR #12 / final reviewed `b07318af910cbeedae6228a180b06e5bce153ab8` · **Integrated baseline:** `main@e1d172ec7f3b2743993f6b4004fe3b5b03007150`.

## What is implemented

`packages/runner/js/method-planner.mjs` exports:

- `validateProblemSpec(problem)`: checks original source hashes and classifications, requirement anchors, atomic Claim specs, positive/negative frozen-oracle references, normalized required capabilities and bounded execution/permission budgets.
- `assessMethod(problem, method)`: evaluates an **untrusted** LLM-proposed typed Method DAG. It rejects forged IDs, unsupported native operations, candidate-only executable claims, missing capability coverage, incorrect provenance, dependency cycles, excess budgets, absent input lineage, unsafe privacy classification and unsupported destinations.
- `proposeMethod(problem, generate, egressAuthority)`: injected **one-shot** LLM adapter interface. Before `generate` can run, a separate trusted host callback `egressAuthority.authorizePublicPayload({problem,problem_sha256})` must explicitly approve the **entire bounded exact PUBLIC payload**, including potentially sensitive free-text requirements/claims; merely declaring a source `PUBLIC` or giving a SHA string is not an egress grant. Missing/denied/failed host approval blocks provider invocation. All inputs are snapshotted before callbacks to prevent approval-vs-assessment TOCTOU. `USER_PRIVATE`/`RESTRICTED` always block at G2. ProblemSpec and both JSON/object replies have 64 KiB transport ceilings; this is not an LLM provider timeout guarantee.

The authoritative native typed operation set is still `native-catalog.mjs`; the 36-tool/23-capability registry is read-only discovery metadata. All native/candidate tools currently remain unverified. Even `STRUCTURALLY_VALID` always returns `tool_execution=NOT_RUN`, `executable=false`, `semantic_fidelity=NOT_EVALUATED`, `independent_oracle_review=NOT_RUN` and `solution_promotable=false`.

## Minimal request/response contract

```js
import { proposeMethod, assessMethod } from "./packages/runner/js/method-planner.mjs";
// problem = original source-anchored ProblemSpec, not just free-text question
// generate = trusted caller-supplied LLM adapter returning JSON Method proposal
const result = await proposeMethod(problem, async prompt => llmAdapter(prompt), {
  // Host-owned: verify actual contents/scope and explicit PUBLIC egress permission.
  // Reject if source bytes are missing, changed, confidential or unapproved.
  authorizePublicPayload: async ({problem,problem_sha256}) =>
    trustedHostApprovals.isAllowed(problem, problem_sha256)
});
// no tool/process is run; result.status = STRUCTURALLY_VALID | REJECTED |
// BLOCKED_BY_POLICY | NEEDS_SOURCE
```

The callback is explicitly **not** a proof checker. A tool candidate with `UNRESOLVED` operation may be part of a non-executable plan, but cannot be elevated into an operation or handed to the native Runner. Dynamic `whereTool`/real permission enforcement and bounded execution are G3 obligations.

## Test/demo boundaries

The synthetic test corpus checks typed Z3 operation selection, `NetworkX` candidate-only discovery, invalid raw CLI, forged tool/claim, no-source lineage, duplicate/cyclic dependencies, budget/time limits, private-input LLM egress blocking, data classification inheritance, external fact `NEEDS_SOURCE`, provider failure and non-proof outcomes. No real external LLM output has been evaluated; `generate` in tests is deterministic mock code.

**Not done (G3/G4/G5):** formal model generation, real native tool runs, semantic equivalence validation, independent factual evidence, claim-to-tool binding, Solution reuse/AOT, and LLM-only vs tool A/B cost/accuracy reports.

## Remaining G2 acceptance / risks

- Run `node --test tests/method-planner.test.mjs`, full `node --test tests/*.test.mjs`, and `npm run typecheck` on **final Exact-SHA**. Any failing CI becomes same-PR repair + new checks; no validation-only follow-up.
- Reviewability: verify that proposal callback cannot turn private data into remote tool/LLM invocation, including public-label spoofing, nonpublic text hidden in a nominally PUBLIC ProblemSpec, unapproved source bytes and mutation between approval and proposal. Host approval is **host-asserted**, not an independently verified proof of public provenance; G3 must bind actual source bytes and permissions at execution. Allowed operations remain **typed** and bound to `native-catalog.mjs` (no raw args or arbitrary shell). R4 DP1–DP5 remain G2/G3 adversarial gates.
- A valid structural plan does not prove semantic faithfulness. Before G3 uses it, require an independent source-anchored verifier and a separate execution permit with actual host identity and least privilege.
- Exact typed specifications / JSON Schema for portable provider adapters remain a refinement step after this first JS contract; do not freeze G2 as fully delivered merely because the mock adapter works.

## Design simplifications

Do not create a new server, Python LLM runtime, domain-specific simulator, or second tool registry. This module adds one pure orchestration layer to the existing JS/TS monorepo; new Provider integrations should remain optional adapters. No work in Issue #7.
