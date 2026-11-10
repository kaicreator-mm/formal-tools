# RESEARCH-R0 — Primary Source Verification Receipt (2026-11-10)

**Project**: [formal-tools Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11) · **Implementation**: [PR #12](https://github.com/kaicreator-mm/formal-tools/pull/12) · **Purpose**: prepare independent reviewer with a source-to-decision audit trail.

> **Status: BUILDER SOURCE RECHECK; NOT AN INDEPENDENT DESIGN ADMISSION.** This file checks accessible primary landing pages/abstracts and explicitly separates their claims from our engineering inference. No paper artifact/code was independently reproduced and no numerical improvement was claimed for formal-tools.

| Source (primary/official page) | Venue/date as shown | Primary-level check | Scope of our inference |
|---|---|---|---|
| [Wang et al., requirement faithfulness](https://arxiv.org/abs/2610.32053) | arXiv preprint, 2026-10-23 | 1,403 C programs/Frama-C; weak/misled generated specifications may let incorrect code pass | Anchor specs to original requirements and held-out negative tests |
| [Agarwal et al., Verus-SpecGym](https://arxiv.org/abs/2605.26457) | arXiv preprint, 2026-05-26 | 581 Codeforces-based tasks; adversarial executable evaluation catches errors that LLM judges miss | Test both acceptance and rejection examples, not only compilation/prover success |
| [Yang et al., Coins](https://proceedings.mlr.press/v306/yang26am.html) | ICML/PMLR v306, July 2026 | Trusted cases generate proof obligations for specification-quality evaluation | Separate semantic-spec assessment from verifier runtime success |
| [Zeng et al., VeriEquivBench](https://proceedings.iclr.cc/paper_files/paper/2026/hash/ebfa4297cd6419f64efe86f657ba49d0-Abstract-Conference.html) | ICLR 2026 | Equivalence evaluation, 2,389 complex algorithmic problems | Add differential and equivalence tests where computable |
| [Poiroux et al., statement autoformalization](https://aclanthology.org/2025.emnlp-main.907/) | EMNLP 2025 | BEq+ evaluation and ProofNetVerif set of 3,752 annotated examples | Explicitly evaluate faithfulness of source ↔ formal claim alignment |
| [Ospanov et al., HERMES](https://proceedings.mlr.press/v306/ospanov26a.html) | ICML/PMLR v306, July 2026 | Interleaves informal reasoning and Lean checking on math tasks | Favor bounded plan-check-repair feedback; do not project benchmark gains to domains |
| [Lewis et al., VISTA](https://aclanthology.org/2026.acl-long.1890/) | ACL 2026 (July) | Claim-level source verification and sequential conversational consistency | Verify atomic claims, report unverifiable facts instead of general PASS |
| [Kadyrbek & Mansurova, proof-carrying actions](https://www.nature.com/articles/s41598-026-74900-x) | Scientific Reports 2026-10-13 | Typed per-action certificate accepted by planner-independent checker | Technical call receipts/approvals are useful but not business truth |
| [Qiao et al., tool orchestration privacy](https://aclanthology.org/2026.findings-emnlp.1293/) | EMNLP Findings 2026 (October) | Individually benign tool results may compose into sensitive inferences | Explicit cross-tool data-flow controls and result release policy |
| [Ma et al., Proof-of-Use](https://aclanthology.org/2026.emnlp-main.1664/) | EMNLP 2026 (October) | Superficial tool-use traces without evidence grounding can game evaluation | Claim→model→receipt→answer support must be auditable, not decorative |
| [Xu et al., tool-use orchestration survey](https://arxiv.org/abs/2603.22862) | arXiv 2026 preprint | Long-horizon orchestration involves state, changing environment, budgets, verification | Typed Method DAG with bounded attempts, fallback and provenance |

## Primary source check conclusions

- The central **research claim is supported** across multiple independent *papers*: machine checking an LLM-produced formula does not establish equivalence with the original user intent.
- The **project design inference** is reasonable but not proven by these papers: source-anchored ClaimSpec, independent frozen oracles, fail-closed tool states, and qualified Solution replay must be evaluated on the project's own domains.
- Source metadata and paper abstracts are verified, but **research gate R4 independent reviewer** must additionally assess whether these papers sufficiently justify the chosen contract and whether we have overlooked simpler solutions or incompatible licensing/sandbox constraints.
- This document does not claim a new independent review identity or G2/G3 permission. No Release/merge approval follows from these checks.

## Reviewer's executable and design checklist (pass/fail with Exact-SHA)

**R1 sources**: verify pivotal links/venues and do not mistake arXiv results for peer-reviewed deployment evidence.

**R2 claim and plan**: source→atomic requirement→formal model→oracle references, quantifiers/scope, and explicit `NEEDS_SOURCE` for external facts. Tool output cannot upgrade a claim without independent semantic evidence.

**R3 adversarial cases**: six fixed ADS examples include legitimate overlap on different resources, forbidden same-resource overlap, time/order/cycle errors; four candidate models include faithful, weak, overstrong, vacuous. Check model evaluator itself is independent enough for the claimed **fixture** result; it's not an independent human review.

**R4 no unintended runtime**: catalog still references `native-catalog.mjs` as execution authority; candidate records cannot execute, no raw shell/MCP, and privacy boundaries between simulator/forge/DIS remain.

**R5 exact-SHA evidence**: require final push and PR Woodpecker checks and independent reviewer PASS/BLOCK after repair. If CI stays PENDING, report as blocked by host evidence, **not** tool/semantic PASS. Do not import old-head SUCCESS.

## Minimal next step after admission

1. Choose one narrow D-ADS, non-native baseline using a deterministic graph algorithm before introducing solvers.
2. Freeze ProblemSpec, ClaimSpec and independent reference cases **before** LLM proposals.
3. Measure LLM-only vs LLM+single-tool vs multi-tool+independent verifier vs qualified AOT on matched cases, with dangerous false-PASS and abstention as primary metrics.
4. Only promote a Solution to REUSABLE after real positive and negative tool-native receipts, independent model/source equivalence assessment and source/version invalidation.

**No code execution, tool download, local agent invocation, or G2 implementation is asserted by this receipt.**
