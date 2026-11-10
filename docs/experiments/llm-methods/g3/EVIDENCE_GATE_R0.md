# G3 PREP R0 — Evidence/Claim Linkage Gate

**Authority:** [Issue #11](https://github.com/kaicreator-mm/formal-tools/issues/11) · **Depends on:** G2 PR #13 independent source/security review and integration · **Status:** isolated preparation, not native verification.

## Decision and component boundary

G3 must close two distinct loops: (1) controlled *real* solver invocation with exact binary/input/output receipts, and (2) claim-level independent semantic verification of model fidelity and tool evidence. This PR prepares a reusable **pure metadata-binding gate** only, so G3 can progress while G2 PR #13 is being independently reviewed.

- `packages/runner/js/evidence-gate.mjs` exports `inspectEvidenceBundle(bundle)`.
- `tests/evidence-gate.test.mjs` provides adversarial contract cases.
- Existing `native-catalog.mjs` remains the tool-ID/typed-operation authority. This component **never executes a tool** or spawns any process.
- It is independent of G2 code at build time and must be integrated onto the G2-reviewed mainline **only after G2 acceptance**.

## Contract v0.1

A bundle declares an **atomic claim** (stable ID, verification kind, required step IDs), the exact source, model and method SHA-256 digests, a local-only policy with a **tool-and-typed-operation allowlist**, and up to 16 tool receipts. A receipt must independently repeat the claim/step/tool/typed operation, binary and invocation SHA, result SHA, source/model/method SHA, tool-specific status, OS exit and input/output privacy labels. IDs may not be reused. Claimed source/model/method digests must match the bundle, and all required steps need receipts.

**Outcome separation:**

| `status` | Meaning | Claim outcome | Can become reusable Solution? |
|---|---|---|---|
| `BLOCKED` | Missing, unrelated, unverifiable or inconsistent declared receipt data | `INCONCLUSIVE` | NO |
| `INCONCLUSIVE` | Tool UNKNOWN/ERROR/TIMEOUT/NOT_RUN or no decisive trace | `INCONCLUSIVE` | NO |
| `NEEDS_SOURCE` | External factual / non-formalizable claim | `NEEDS_SOURCE` | NO |
| `LINKED_UNVERIFIED` | Declared claim/source/method/steps/tool receipts are mutually consistent **only** | `UNVERIFIED` | NO |

**Explicitly NOT ENOUGH for truth**: `tool_status=SAT/UNSAT/PROVED`, matching self-declared SHA values, `exit_code=0`, an independent-oracle *name* or an LLM-generated `PASS` flag. `LINKED_UNVERIFIED` is never `SUPPORTED_WITH_SCOPE`. Receipts are treated as **self-assertions** until a trusted runner attests their byte-level identities.

## Next G3 runtime and semantic work (not implemented here)

1. Bridge approved G2 typed method/operation and the existing runner's real invocation; verify binary and command identity at the host, enforce OS/process/network/time/size limits and input sensitivity, generate **actual** SHA receipts. Never pass arbitrary `argv`, shell or unsupported candidate tools.
2. Link each source-anchored claim to a **frozen, independently authored Oracle**: positive, negative, adversarial and boundary cases. Validate model-to-original-source semantics separately from tool execution.
3. Distinguish `FORMAL_WITH_SCOPE` vs `BOUNDED` vs `TESTED_SAMPLES` vs `STATISTICAL` claims. SAT/UNSAT is not inherently proof of source truth; measure false-PASS, scope and abstention.
4. Compare Solve, Verify and Solve+Verify in a D-ADS deterministic minimal demo before adding more solver families. Only after evidence and review can G4 consider a reusable Solution.
5. Actual tool downloads remain parallel; no forced full 36-tool host installation. No activities in Issue #7.

## Test / acceptance

At current source stage: 14 synthetic cases cover output forging, different claim/source/model SHA, wrong tool/operation/permission, duplicated or missing steps, unsupported statuses, privacy declassification, local-only policy and arbitrary-size malformed arrays.

**Gate:** exact final-SHA `node --test tests/evidence-gate.test.mjs`, `node --test tests/*.test.mjs`, `npm run typecheck`, Woodpecker push+PR, then source review. All this is **G3 PREP**, not G3 ACCEPTED. G2's independent review must not be bypassed by merging this PR prematurely.
