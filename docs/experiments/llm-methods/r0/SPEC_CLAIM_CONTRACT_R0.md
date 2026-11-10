# Research R0 — Source-Anchored Problem / Claim / Method Contract

**Authority:** Issue #11 · **Status:** DESIGN_CONTRACT_NOT_YET_ADMITTED · 2026-11-10

## Semantic trust boundary

A proof engine may check only the **encoded model**, not the natural-language requirement or the truthfulness of arbitrary tool citations. **Three distinct results** are mandatory:

1. `PROCESS_EXECUTED` / tool-native result (e.g. SAT/UNSAT) — executable ran under a recorded environment.
2. `MODEL_CHECKED_WITH_SCOPE` — a particular source version of the formula/property was checked against recorded assumptions and boundedness.
3. `CLAIM_SUPPORTED_WITH_SCOPE` — an *independently anchored* original claim matches the model, its known negative/positive semantics, and the relevant evidence.

No result in layer 1 implies layer 2 or 3 by itself. `NOT_RUN / UNKNOWN / INCONCLUSIVE / NEEDS_SOURCE` are normal outputs, not exceptions hidden as success.

## Frozen specification concepts before G2

### ProblemSpec R0 (not an LLM prompt template)

- `problem_id`, `source_refs[]` with URI/content-addressed identity and trust scope; a statement of the original goal and non-goals.
- `requirement_anchors[]`: stable IDs for every atomic requirement, source text/range, exclusions, and required acceptance criteria.
- `input_contract`: typed, bounded input schema; domains and assumptions, including quantifiers and resource/temporal interpretation.
- `claim_specs[]`: checkable independent claims, each mapped to one or more requirement anchors and an intended verification kind.
- `independent_oracle_refs[]`: separately reviewed positive, negative, boundary, metamorphic and counterexample cases; record who authored them and when the candidate was frozen.
- `budget`: max tool invocations, maximum recursion/depth, tokens, time, retries and expected financial cost, with explicit refusal behavior.

### ClaimSpec R0

- `claim_id` and verbatim text / extracted assertion.
- `source_anchors[]` and `assumptions[]`; **nonempty provenance for factual claims** but provenance alone not factual validation.
- `verification_kind`: `symbolic`, `bounded_model`, `program`, `statistical`, `external_fact`, `not_formalizable`.
- `model_ref` and `semantic_oracle_ref` (if appropriate), `data_scope` and `proof_strength` (`TESTED_SAMPLES / BOUNDED / FORMAL / EMPIRICAL / NONE`).
- `evidence_refs[]` with exact `claim_id`, tool/source identity, invocation SHA, model SHA and result SHA; **independent check** required before claim level `SUPPORTED_WITH_SCOPE`.
- `result`: `SUPPORTED_WITH_SCOPE`, `REFUTED`, `INCONCLUSIVE`, `UNVERIFIED`, `NEEDS_SOURCE`; result is not `SAT`/`UNSAT`.

### Method DAG R0

- `method_id`, `problem_spec_digest`, `goal_claim_ids`, `steps[]` (each unique ID, trusted `tool_id`, allowed typed `operation`, pinned input/output artifact references, explicit dependency IDs).
- `tool_availability`: dynamic runtime probe, independent of `registry/PROBLEM_CAPABILITIES.json` discovery-only metadata.
- `budget` and `failure_policy`: no unknown native shell, no silent retry of a non-idempotent tool, max effort and safe `UNKNOWN` fallback.
- `verification_plan`: independent oracle **frozen before** candidate model, at least one positive and one negative requirement case; detect weak/overstrong/vacuous formulas and claim/evidence mismatch.
- `status` stays `CANDIDATE` or `STRUCTURALLY_VALID` until *independent semantic review* and exact tool-native evidence are recorded.

### Qualified Solution R0 (later G4)

Immutable package with applicability envelope, requirement/claim/model/method/tool version hashes, frozen oracle references, replay procedure, evidence and expiration/invalidation policies. **Method structural validity alone can never promote to `REUSABLE`.** Changed requirements or tool implementations invalidate earlier evidence until requalification.

## R4 tool permission, privacy and cross-tool data-flow admission (design-only)

No LLM or tool result can grant itself an execution permission or upgrade a data-release permission. Before G2 implementation, each ProblemSpec / proposed Method must carry a reviewable **data-flow policy**:

- **Source labels**: `PUBLIC / USER_PRIVATE / RESTRICTED`, issuer/source identity, allowed processing purpose, and permitted consumers; unknown provenance defaults to restricted treatment, not public.
- **Tool boundary**: an allowlisted tool ID + typed operation, approved input sensitivity, external/network side effects, destination policy, maximum input/output size, and budget. Candidate-only discovery records never confer execution permission.
- **Derived outputs**: track every input artifact/source in a derived evidence/claim dependency graph. A derived artifact cannot silently have a less restrictive release classification than its inputs. Independent review/approval is required before release or declassification, especially when individually innocuous tool outputs together reveal a sensitive conclusion.
- **Receipt boundary**: attach exact source/model/claim/operation identifiers, tool version, redacted hashes, and disclosed recipients. A receipt is a process-evidence link, never evidence that private inputs may be disclosed or that the original claim is true.
- **Failure handling**: if destination, source identity, data-flow lineage, authorization or external-fact provenance cannot be established, emit `INCONCLUSIVE/NEEDS_SOURCE` or `BLOCKED_BY_POLICY` as appropriate; never retry using an arbitrary shell or a different tool to bypass policy.

**Frozen design-negative obligations for later G2/G3 tests (NOT_EXECUTED in R0):**

| Case | Invalid proposal | Required admission response |
|---|---|---|
| DP1 | Tool A and B reveal separate harmless-looking properties; combined output infers a restricted user attribute and is sent to a public endpoint | Refuse release without explicit approved declassification; keep input→derived-output lineage |
| DP2 | Discovery returns a candidate tool as `NOT_ASSESSED`, but Method attempts to invoke it | Reject execution capability; `NOT_RUN` |
| DP3 | Two solver receipts share the same incomplete generated specification | Do not accept agreement as an independent semantic oracle; `INCONCLUSIVE` until source-anchored review |
| DP4 | A qualified Solution is replayed after its source, assumptions, model or tool version changes | Invalidate / requalify before `REUSABLE` status |
| DP5 | A tool returns successful exit status with a receipt for another claim/model | Refuse Claim promotion, retain claim↔model↔receipt mismatch |

These are **design acceptance rules**, not new executable G2/G3 functionality, no claim of privacy proof, and no substitute for independent implementation tests.

## Research R0 executable negative-case baseline

Synthetic D-ADS resource-writer scheduling semantics used **only as cross-tool regression fixture**, not as a domain-simulator authority:

- `benchmarks/llm-methods/r0/spec-fidelity-cases.json`: frozen R1–R3 natural-language requirement anchors and 6 expected example outcomes (2 positive/4 negative).
- `tests/spec-fidelity.test.mjs`: independently written deterministic candidate-model evaluator checks 4 models: faithful, **weak** missing same-resource writer exclusion, **overstrong** preventing unrelated concurrency, and **vacuous** always false.
- Separate claim test refuses to label an unsourced external fact as verified simply because an unrelated tool receipt has exit_code=0.
- This baseline measures **specified syntactic examples and candidate model alignment**, not domain completeness, native proof correctness, semantic reviewer independence, or the ability of an LLM to build those models.

## Research → G2 admission checklist

| Requirement | Source prepared | Independent acceptance |
|---|---|---|
| R1 dated research and practice citations, with nontransferable limitations | Technical review in PR #12 | Independent reviewer checks pivotal sources/claims |
| R2 source-anchored ProblemSpec, ClaimSpec, Method contracts | This document, frozen reference cases | Independent reviewer checks omissions, quantifier, domain and proof-scope semantics |
| R3 reproducible weak, overstrong, vacuous, evidential negative tests | 6 cases / 4 candidates, Node tests | Exact-SHA Woodpecker, additional adversarial cases if reviewer finds gaps |
| R4 delivery/fail-closed permission model, component ownership | This document + Product/L1 | Independent design/source review; P0/P1 repair and recheck |
| R5 Git authoritative status and G2 dependency | Issue #11 and versioned DAG | Explicit `ADMITTED` or `BLOCK` with final HEAD and evidence |

**Current outcome:** `DESIGN_READY_FOR_INDEPENDENT_REVIEW`, **not** `ADMITTED`. No G2 native execution or real LLM A/B benchmark is implied. Future framework/LLM adapters remain optional, behind typed interfaces; no general shell/MCP raw execution.
