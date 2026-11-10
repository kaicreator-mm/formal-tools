# Technical Landscape Review R0 — LLM + Symbolic/Logic/Formal Tool Engineering

**Date:** 2026-11-10 · **Authority:** [Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11) · **Review mode:** public paper abstracts/HTML and official project docs; **no local experiment replication or independent peer review performed**.

**Decision:** YES — complete an evidence-based design gate **before G2/G3 implementation**, without rolling back G0/G1 or waiting for all downloaded binaries. The bottleneck is **specification fidelity and evidence qualification**, not tool count or agent framework selection. R1 / Issue #7 stays untouched.

## 1. Evidence reviewed (2025–2026)

| Date / status | Research or practice | Verified observation from source | Architectural impact |
|---|---|---|---|
| 2026-10-23 / **arXiv preprint** | [Wang et al., Are LLM-Generated Formal Specifications Faithful to Their Requirements?](https://arxiv.org/abs/2610.32053) | 1,403 C programs with requirements and Frama-C; when incorrect programs influence specification generation, weak specifications can falsely pass; advanced prompting does not eliminate this | **Never derive verification oracle solely from subject code or LLM answer; anchor requirements and hold out negative cases** |
| 2026-05-26 / **arXiv preprint** | [Agarwal et al., Verus-SpecGym](https://arxiv.org/abs/2605.26457) | 581 autoformalization tasks, executable spec checking against independent tests and adversarial cases; strongest reported model solved 77.8%, and model judge missed 26% of failures detected by executable evaluator | Build **executable positive/negative/adversarial semantic oracles**, reject weak/overstrong specifications before claim promotion |
| 2026 / **ICML proceedings** | [Yang et al., How Powerful are LLMs in Generating Formal Program Specifications? (Coins)](https://proceedings.mlr.press/v306/yang26am.html) | Evaluates specification quality by instantiating trusted test cases into proof obligations, rather than conflating proof difficulty and specification quality | Specification acceptance should be a **separate gate**, not `solver passed` |
| 2026 / **ICLR proceedings** | [Zeng et al., VeriEquivBench](https://proceedings.iclr.cc/paper_files/paper/2026/hash/ebfa4297cd6419f64efe86f657ba49d0-Abstract-Conference.html) | 2,389 algorithmic tasks; equivalence-oriented specification assessment highlights limitations of provably executed but misaligned implementations | Add bounded **equivalence / differential reference checks**, not only syntax/compilation |
| 2025-11 / **EMNLP proceedings** | [Poiroux et al., Reliable Evaluation and Benchmarks for Statement Autoformalization](https://aclanthology.org/2025.emnlp-main.907/) | BEq+ and 3,752 annotated evaluation instances; autoformalization evaluation itself requires calibration to semantics and expert judgments | Store **source ↔ formal claims mapping** with independent semantic assessment |
| 2026 / **ICML proceedings** | [Ospanov et al., HERMES](https://proceedings.mlr.press/v306/ospanov26a.html) | Combines informal exploration with incremental formal Lean checking; authors report accuracy/compute gains on their mathematical tasks | Use **interleaved plan → check → repair**, bounded retries; do not extrapolate benchmark gains to arbitrary domains |
| 2026-07 / **ACL proceedings** | [Lewis et al., VISTA](https://aclanthology.org/2026.acl-long.1890/) | Atomic claim verification with trusted sources and conversational history; distinguishes unverifiable claims from contradictory/supportable ones | **ClaimSpec-first** verification with `NEEDS_SOURCE`/abstention and provenance |
| 2026-10 / **Scientific Reports** | [Kadyrbek & Mansurova, Proof-Carrying Agent Actions](https://www.nature.com/articles/s41598-026-74900-x) | Typed per-action certificates, checker independent of planner, evidence bound to exact invocation; limited study and small action test batteries | A **lightweight invocation/receipt certificate** is useful; do not assume its microbench generalizes or copy its full framework |
| 2026-04 / **survey preprint** | [Xu et al., The Evolution of Tool Use in LLM Agents](https://arxiv.org/abs/2603.22862) | Tool use involves long-horizon orchestration, state, cost, environment changes and verification beyond single-call selection | Method DAG needs resource budgets, failure recovery and explicit dataflow |
| 2026-06 / **Agent Planning Benchmark preprint** | [Sun et al., Agent Planning Benchmark](https://arxiv.org/abs/2606.04874) | 4,209 scenarios across 22 domains; evaluates noise, broken tools, unsolvable tasks and planning separately from execution | Add **tool-noise / unavailable / unsolvable** adversarial tests and refusal calibration |
| 2026-10 / **EMNLP Findings** | [Qiao et al., Agent Tools Orchestration Leaks More](https://aclanthology.org/2026.findings-emnlp.1293/) | Composing seemingly non-sensitive tool results can reveal sensitive conclusions | Tools require **per-claim scope, dataflow and privacy controls**; independent of proof correctness |
| 2026-10 / **EMNLP proceedings** | [Ma et al., Proof-of-Use](https://aclanthology.org/2026.emnlp-main.1664/) | Tool-use traces can appear compliant without actually grounding the final answer in the tool evidence | Record **claim-to-evidence dependency**, not just tool-call success |

**Interpretation limits:** these studies evaluate different tasks and models. Do not combine their numerical improvements into a general success-rate projection. Several are preprints; their data/claims need reproduction before using them for deployment guarantees.

## 2. Open-source engineering options (what to adopt vs avoid)

| Existing project | Applicable mechanism | R0 choice |
|---|---|---|
| [DSPy](https://github.com/stanfordnlp/dspy) / [optimizers](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/optimizers.md) | Signature-driven modules, trace/metric-based prompt and program optimization | **Study and benchmark as a plug-in strategy**; no immediate Python dependency or parallel orchestration runtime in JS/TS monorepo |
| [LangGraph JS](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph) | Explicit node/state graph, checkpoints, resumability and failure branches | **Borrow state-machine semantics**; add dependency only if genuine persistence/resume tests prove value vs small typed DAG |
| [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk) / [guardrails](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals) | Typed tools, trace/approval mechanisms, tool-level checks | Optional adapter for LLM provider; **do not couple core formal-tool registry or evidence truth to one SDK** |
| [LeanDojo-v2](https://github.com/lean-dojo/LeanDojo-v2) | Lean proof-state interaction, tracing, retrieval-based proving | Track for **Lean-specific advanced consumer**; not required for a cross-method foundation and not a substitute for semantic specification review |
| Existing `formal-tools` JS/TS | `native-catalog.mjs` (13 tools/53 typed ops), `sdk.mjs` and constrained runner | **Authoritative technical execution source**; G2/G3 orchestrates through it rather than re-creating native adapters |

**Decision:** **Do not install a general-purpose agent framework as a product prerequisite**. For G2 use a small, deterministic, typed, cost-limited Method planner contract, with replaceable LLM provider and optional external framework evaluation. No unrestricted shell/MCP raw tool invocation.

## 3. Main design correction: close the source-to-specification semantic gap

A formal proof only validates a model's propositions, not that the model accurately represents user intent. Required pipeline:

```text
original user requirement / source document / code (provenance locked)
 -> atomic ClaimSpec and requirement anchors (what is claimed, source, scope)
 -> examples + counterexamples + edge cases + independent acceptance oracles
 -> candidate formal models (possibly multiple, from LLM)
 -> semantic fidelity gate: coverage, missing constraints, overstrong/understrong specs
 -> capability match -> typed Method DAG static/availability/budget gate
 -> tool-native bounded execution and receipts
 -> independent claim-level outcome with evidence dependency and abstention
 -> Solution CANDIDATE -> separate promotion gate -> qualified AOT reuse
```

**Three truth distinctions**:
1. `TOOL_EXECUTION_OK` means the tool ran, **not** an original requirement was proved.
2. `FORMAL_PROPERTY_HOLDS_WITH_SCOPE` means the specified formula was checked under recorded assumptions/scope.
3. `CLAIM_SUPPORTED_BY_INDEPENDENT_ORACLE` requires source-faithful model, independent oracle, valid evidence and claimed applicability scope.

If external factual assertions have no authoritative source, return `NEEDS_SOURCE` / `UNVERIFIED`, not `SAT/UNSAT`. Probability/causality models need calibration and independence assumptions; mathematical proof cannot directly establish empirical facts.

## 4. G2/G3 contract amendments to validate before implementation

1. **ProblemSpec / ClaimSpec** carries `source_refs`, assumption IDs, input/domain restrictions, expected answer type, acceptance tests, oracle provenance and `verification_kind` (`symbolic`, `bounded_model`, `program`, `statistical`, `external_fact`, `not_formalizable`).
2. **Capability registry additions** proposed (G1 source may remain stable until independently reviewed): `supported_input_kinds`, `proof_strength`, `scope_limits`, `independent_oracle_requirements`, `cost_class`, `side_effect_class`, `trust_scope`. These are semantic metadata, **not** a second executable tool registry.
3. **Method DAG**: typed input/output contracts; exact tool IDs/ops and dependencies; per-node model/proof artifact hash; deterministic max depth/call count/token/cost/timeout; no plan with missing capability or unknown tool.
4. **Semantic review gate** independent from tool results: positive, negative, adversarial and metamorphic cases; detect vacuous proofs, quantifier/drop-condition errors, variable/domain mismatch and weak or overstrong specifications.
5. **Claim verifier**: `SUPPORTED_WITH_SCOPE / REFUTED / INCONCLUSIVE / UNVERIFIED / NEEDS_SOURCE`; show specific evidence dependency; tool process status separately. Verify output and tool-evidence linkage, not only model syntax.
6. **Solution qualification**: immutable fingerprint over original requirement anchors, verified model, Method DAG, tool versions/options, oracle cases/coverage and evidence; on new requirement/source/tool version, invalidate or require constrained re-qualification before AOT reuse.
7. **Privacy/permissions**: explicit tool-input and output data handling, tool source trust, no generic local process launch or cross-tool sensitive-data conclusion without review.

**No G2/G3 runtime coding should start until contracts 1–5 are reviewed, but schema/docs and G0/G1 tests continue independently.**

## 5. Adversarial Demo requirements (before expanding 36-tool installation)

| Test | Failure seeded | Expected result |
|---|---|---|
| A: Weak spec | Original rule has two constraints, generated model omits one | `REJECT_SPEC_SEMANTIC`, not business PASS even if solver SAT |
| B: Overstrong spec | Model rejects an otherwise valid boundary case | `REJECT_SPEC_SEMANTIC` |
| C: Tool availability | Capability tool registered but only downloaded/not installed | `NOT_RUN/INCONCLUSIVE`, no claimed solved result |
| D: Broken/noisy tools | Tool inventory contains irrelevant/disabled/adversarial candidates | Planner excludes or abstains without silent fallback |
| E: Conflicting evidence | Multiple solvers disagree due to encoding/assumptions | `INCONCLUSIVE`, investigate models and provenance |
| F: Factual hallucination | LLM claims an undocumented current market or historical fact | `NEEDS_SOURCE`; no fabricated formal proof |
| G: Circular check | Generator and verifier share an incorrectly generated requirement | Reference oracle must reject; common assumptions ≠ independent evidence |
| H: Tool result laundering | Agent shows successful tool call but cites unrelated output | Claim–receipt link rejects |
| I: Solution stale | Change source requirement, tool/model version or assumption | prior reusable Solution becomes `INVALIDATED/STale` pending requalification |
| J: Cost | Exact graph algorithm solves problem without SMT | Lower-cost deterministic solution should beat unnecessary proof chain |

Benchmark arms (same original inputs/model/prompt configuration/held-out cases):
- `B0` LLM-only
- `B1` LLM + single suitable tool
- `B2` LLM + typed Method DAG + independent semantic/evidence verifier
- `B3` B2 with a qualified cached AOT Solution

Metrics: correct scoped answers, **dangerous false-PASS**, abstention precision, reference/claim coverage, spec-fidelity faults caught, actual tokens/USD/time, tool call count, reproducibility and AOT reuse/invalidations. Report per-domain and case-level; do not claim B2 is always better until evidence.

## 6. Adoption decision & immediate sequence

- **Accept** existing G0/G1 as a source/design baseline; do not change R1/#7 or infer 36 executable tools.
- **Before G2 implementation**, freeze `ProblemSpec + ClaimSpec + semantic-oracle` contracts, and add minimal A/B weak/overstrong-spec counterexamples. Prefer source-first oracle to model-first prompt engineering.
- **Then** implement one real end-to-end D-ADS path (NetworkX/graph first; add solver only for a property requiring it). Make `unknown`/non-proof explicit. Move to D-DKE/D-DIS and external-fact verification only after evidence demonstrates need.
- **Before G4**, independently verify replay and source/tool change invalidation; no `Solution REUSABLE` from static validation.
- **Before choosing a framework**, compare a small typed JS Method DAG with one adapter experiment (DSPy or LangGraph), scoring reproducibility, dependency footprint, portability and total cost. Do not force framework migration from research alone.

**Research gate R0 outcome: DESIGN_DIRECTION_APPROVED_WITH_CONDITIONS; G2/G3 IMPLEMENTATION_NOT_YET_ADMITTED.** All sources above are public; the implementation recommendations are project-specific engineering inferences, not independently validated research claims. Tool downloads remain parallel and independent of this gate.
