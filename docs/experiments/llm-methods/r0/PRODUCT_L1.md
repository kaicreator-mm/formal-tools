# formal-tools：Capability → Method → Solution（G0 Product/L1 R0）

**Authority**: [Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11) · **Branch**: `experiment/llm-capability-method-g0-g1-r0` · **Base main**: `41925288dd5b777d49c4e442d9731581895cb037` · **Date**: 2026-11-10

## 1. Product goal

Enable an LLM to map a concrete problem to **capabilities**, propose and compose a bounded **Method DAG**, use pre-existing, allowlisted **tools** to solve it, and independently test the truth and scope of resulting claims. Following semantic and tool-native verification, package a versioned **Solution** for replay/AOT reuse.

**Success is not tool count**: benchmark correct and scoped conclusions, dangerous false-PASS, negative-example detection, replay, token/monetary cost, tool latency and reuse. Neither a syntactically valid tool plan nor a successful solver exit confers business-level correctness.

## 2. Five consumer-visible capabilities

- **Discover**: user problem/claim → normalized problem category → eligible tool candidates with availability, limitations and competing methods.
- **Compose**: LLM → typed Method DAG, prerequisites, tool/model contracts, budget/alternative and explicit acceptance-oracle references; reject cycles and missing capabilities.
- **Solve**: execute approved tool actions, preserve intermediate artifacts, expose counterexamples and uncertainty; do not run arbitrary shell through an LLM.
- **Verify**: isolate checkable claims from LLM output, verify against external/independent specification or oracle, distinguish evidence-backed results from unverifiable factual assertions.
- **Learn**: candidate Method → independent semantic + negative-case + tool-native evidence → immutable Solution with fingerprint, applicability envelope, version/invalidation and AOT reuse. No hidden promotion.

## 3. Responsibilities / exclusion boundary

- **formal-tools**: capability classification, generic tool invocation contracts, Method/Solution technical orchestration and evidence container, with the existing native tool registry as *execution authority*.
- **domain-forge**: knowledge provenance, DKE domain semantics, knowledge extraction and evolution.
- **domain-simulator**: domain reasoning, simulated scenarios, counterfactuals, evaluation and domain evolution; may consume generic methods but owns domain scenarios and authority.
- **domain-harness (DIS)**: production domain function/runtime consumption of qualified Solutions.
- **dx-service**: deprecated; do not create a successor runtime inside this project.
- **Issue #7**: separate historical R1 infrastructure, not resumed, changed or counted toward this G0/G1 scope.
- No generic claim that symbolic tools can check changing real-world facts without trusted external sources; no automatic theorem or proof from textual self-consistency.

## 4. Existing source audit

Read from `main@41925288...`: `packages/runner/js/native-catalog.mjs` exports **13** authoritative native tool IDs and **53** typed CLI operations. The runner SDK (`packages/runner/js/sdk.mjs`) and native-tool manager reuse it. They are **technical** tool interfaces; some native runtime gates are still not proven. `docs/PROJECT_SCOPE.md` and `docs/roadmap/FORMAL_TOOLS_TASK_DAG_R1.json` describe frozen R1-only exclusions. They remain unchanged; this experimental branch creates a separately scoped product direction.

**G1 single source-of-truth invariant**: capability mapping in `registry/PROBLEM_CAPABILITIES.json` only stores reference IDs for those 13 existing tools, never CLI operations, executable names or versions. The authoritative native identifiers are dynamically imported and checked against this mapping. Additional candidate tool records are metadata for discovery, **not** installed/verified runner adapters.

## 5. Contracts / outcomes

- `ProblemSpec`: question, relevant domain context and provenance, explicit assumptions, decidable claims, boundaries, acceptance oracle, runtime/cost budgets.
- `Capability`: stable code, input kind, expressiveness, limits, evidence semantics and candidate tools (many-to-many).
- `Tool`: registered native reference or candidate reference, official source, licensing status, distribution type, `REGISTERED / DOWNLOADED / INSTALLED / NATIVE_VERIFIED / UNAVAILABLE` with **external** signed/hash receipts.
- `Method`: typed DAG of primitive operations, tool-version constraints, verified inputs and dependencies, fallback strategy, independent validation plan, semantic-fidelity gate.
- `ToolResult`: never collapse `SAT`, `UNSAT`, `UNKNOWN`, `ERROR`, `TIMEOUT`, `NOT_RUN` into a universal PASS.
- `ClaimResult`: `SUPPORTED_WITH_SCOPE`, `REFUTED`, `INCONCLUSIVE`, `UNVERIFIED`, including `NEEDS_SOURCE` for external facts.
- `Solution`: immutable method/data/evidence hashes, applicability envelope, oracle/negative cases, replay steps, dependencies and expiration/invalidation; `CANDIDATE` cannot masquerade as `REUSABLE`.

## 6. Execution strategy

Use **ADS #1359 Delivery-First, Web-first**. A single main Issue #11 and versioned Git evidence. Scope G0 (this document + DAG) and G1 (capability registry + query/test + matrix). No new standalone service, no duplicate native adapters, no forced local validation for metadata-only changes. One Writer per write set. G2/G3 may proceed only with constrained, adversarial Method contracts, not by silently evaluating the LLM's own claims as their oracle. Existing tools downloading is parallel and **nonblocking** for G0/G1; availability is not invented.

## 7. Demo design & quality gates

| Demo | Solve / Verify sketch | Primary adversarial obligation |
|---|---|---|
| D-ADS | Graph DAG → scheduling optimization → SMT counterexample | Hidden resource conflicts, cycles and incorrectly omitted assumptions |
| D-DKE | Element hierarchy/relationships → graph, Datalog and/or SMT | Orphan/cycle, split depth, independent semantic evaluation |
| D-DIS | Function I/O and typed outcomes → property checking/SMT | UNKNOWN masquerading as valid business result; compatibility drift |
| D-HALLUCINATION | Extract computable/math/code/external claims; route to specialized tools | Missing sources, circular evidence, false formalization and unverifiable claims |

**Comparison:** same problem set and controlled model settings for LLM-only vs LLM+tools, genuine independent oracle, per-run raw answers, actual tokens/cost/latency and replay; report unsuccessful tests. Initial 9 tiny fixtures are oracle scaffolding, not LLM/native accuracy evidence.

## 8. G0/G1 acceptance / open risks

**G0**: product goal, ownership, non-goals, task dependencies and measurable gates versioned and linked to #11. **G1**: validate capability IDs uniqueness, 36 catalog references/23 initial capability classes, exact 13-native ID reference closure, candidate availability never exceeds `REGISTERED` without trusted receipts, skill/domain scopes, input-output/result semantics, test negative cases, machine-readable plan/query interface and human-readable matrix. Native tool execution/LLM automation is **explicitly NOT_RUN** at G0/G1.

**Open risks**: tool packaging/licensing/ABI, semantic misformalization, stale evidence, prior/native adapter overlap, false belief that independent tools imply independent assumptions, unverified cost comparisons. G2/G3 require risk-specific negative tests. This is an experimental Product/L1 baseline pending independent source review; does not modify main/R1 guarantees.
