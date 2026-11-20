# UI_DESIGN.md — formal-tools V5 Web UI design system (OUTPUT_LABEL=FORMAL_TOOLS_I180_V5B_LIVE_ENGINE)

Scope: `apps/web/**` (zero-build vanilla frontend + bounded Node bridge) as delivered for
issue #185 (parent #180). **Since V5-b the execution engine is REAL**: plans are built by
the V2 planner (`workflow-plan.mjs` + `workflow-compiler.mjs`) and runs go through the V3
executor (`workflow-executor.mjs`). On machines without the trusted portable tool bundle
the executor fails closed before any step and the receipt honestly reports
`ABORTED / BLOCKED_TOOL_MISSING` — the UI renders this as a distinct blocked state, never
as a solver answer and never simulated. (V5-a's mocked engine is fully removed; its
evidence lives in git history.)

---

## 1. Design skill inventory (required by issue #185)

**Finding: no Product Design / UI Design skill is installed in this environment.**

- Recorded: 2026-11-19, ZCode CLI session on win32 (Git Bash, node v26.13.0), repo
  kaicreator-mm/formal-tools @ 33bd3d0, worktree `wt-i180-v5` (branch `i180/v5`).
- Full skill inventory of the session was inspected before any visual design work. It
  contains only: solver/product-domain skills (ads/dis/tally/runx/shun/formal-tools-portable),
  ops skills (cloud, woodpecker, docker), document skills (docx/pdf/pptx/xlsx), GitHub skills,
  browser-automation skills (browser-use:control-browser, web-gui-tester) and ZCode guide
  skills. **None of these is a Product/UI Design standard; per the issue, they were NOT
  treated as UI authority and no imaginary skill citations are made.**
- The repo (main @ 33bd3d0) contains no existing UI component/token rules
  (`docs/`, `registry/`, `packages/` carry no design system).
- Consequence (per issue): a compact, documented accessibility/responsive design system is
  defined below and implemented verbatim in `apps/web/public/styles.css`.

## 2. Design tokens (implemented 1:1 in styles.css `:root`)

### 2.1 Color — dark-on-light theme only this round

| Token | Value | Role |
|---|---|---|
| `--c-bg` | `#f7f8fa` | page background |
| `--c-surface` | `#ffffff` | cards, tables, header |
| `--c-ink` | `#1a202c` | primary text |
| `--c-ink-muted` | `#4b5563` | secondary text, hints, captions |
| `--c-border` / `--c-border-strong` | `#d4d8de` / `#9aa2ad` | hairlines / form borders |
| `--c-accent` | `#1d4ed8` | links, primary buttons, active step |
| `--c-accent-hover` | `#1a44bb` | primary button hover |
| `--c-accent-ink` | `#ffffff` | text on accent |
| `--c-focus` | `#1d4ed8` | focus ring color |

### 2.2 Semantic colors — verdict/error semantics are NEVER conflated

| Meaning | ink (on its bg) | bg | border | Used for |
|---|---|---|---|---|
| OK / agree | `#0f6b33` | `#e7f6ec` | `#b7e2c3` | `EXECUTED`, `OK`, `AGREE_SAT`, `AGREE_UNSAT`, `RUN COMPLETE`, `engine: … (real)` badge |
| warning / degraded | `#7a4900` | `#fff3d6` | `#ecd39b` | `TIMEOUT`, `PARTIAL`, **BLOCKED banner + chip** (dashed border + left accent to never read as FAILED) |
| danger / fail-closed | `#a92019` | `#fdecea` | `#f3c2bd` | `ERROR`, `FAILED`, `ABORTED`, `CONTRADICTION` |
| unknown / undecided | `#5b3ba8` | `#f1edfd` | `#d9cff2` | `UNKNOWN` verdict, honest "cannot decide" |
| info | `#0b4a6f` | `#e3f2fa` | `#bcdff2` | `mode:` badge, plan banner, plan-source badge |

Measured WCAG contrast (computed, WCAG 2.x relative luminance formula, all pass AA ≥ 4.5:1):

| Pair | Ratio |
|---|---|
| `--c-ink` on `--c-surface` | 16.32 |
| `--c-ink` on `--c-bg` | 15.36 |
| `--c-ink-muted` on `--c-surface` | 7.56 |
| `--c-ink-muted` on `--c-bg` | 7.11 |
| `--c-accent` on `--c-surface` (links) | 6.70 |
| white on `--c-accent` (primary button) | 6.70 |
| `--c-ok-ink` on `--c-ok-bg` | 5.93 |
| `--c-warn-ink` on `--c-warn-bg` | 6.85 |
| `--c-danger-ink` on `--c-danger-bg` | 6.32 |
| `--c-unknown-ink` on `--c-unknown-bg` | 6.93 |
| `--c-info-ink` on `--c-info-bg` | 8.25 |

### 2.3 Spacing scale (px)

`--sp-1: 4 · --sp-2: 8 · --sp-3: 12 · --sp-4: 16 · --sp-5: 24 · --sp-6: 32 · --sp-7: 48`

### 2.4 Type scale (px, line-height 1.5 for body)

`--fs-0: 12` (badges/captions/table head) · `--fs-1: 13` (tables, code) · `--fs-2: 14`
(buttons, hints, body-secondary) · `--fs-3: 16` (root/body) · `--fs-4: 20` (h2, brand) ·
`--fs-5: 26` (h1). Fonts: `system-ui` stack; monospace for all model/code/stream content
(`ui-monospace, Cascadia Mono, Consolas`).

### 2.5 Radii & motion

- Radii: `--r-1: 4px` (inputs/buttons) · `--r-2: 8px` (cards/tables) · `--r-pill: 999px` (badges/chips/stepper).
- Motion: **subtle only** — single token `--motion-fast: 120ms ease-out` applied to
  background/border/color transitions; no transforms, no large animations.
  `@media (prefers-reduced-motion: reduce)` disables all transitions/animations.

### 2.6 Focus ring token

`--focus-ring: 2px solid var(--c-focus); --focus-offset: 2px` applied via
`:focus-visible` on all interactive elements (links, buttons, inputs, textareas,
checkbox, summary, headings used as focus targets).

## 3. Component conventions

- **Status chips** (`.chip--*`): one visual language for step/verdict state;
  `QUEUED` (muted), `RUNNING` (accent outline), `EXECUTED` (ok), `ERROR`/`FAILED`/
  `CONTRADICTION`/`ABORTED` (danger), `TIMEOUT`/`PARTIAL` (warning), `SKIPPED_DOWNSTREAM`
  (muted, dashed border), `UNKNOWN` (unknown-purple), `NOT_APPLICABLE` (muted).
- **Banners** (`.banner--ok|warn|danger|unknown|info|blocked`): a single top banner per
  screen for fail-closed / CONTRADICTION / UNKNOWN / BLOCKED messaging with `role="alert"`
  (the results-screen verdict banner is `#resultNote`, on the screen the user lands on).
- **Blocked presentation** (`.banner--blocked`): warn tones with a **dashed border and a
  4px left accent bar** so "trusted tools unavailable" never reads as FAILED/ERROR; text
  always names the exact `fail_closed_reason` (e.g. `BLOCKED_TOOL_MISSING`) and states
  that no step ran and nothing is simulated. `claim_verdict=BLOCKED` gets the matching
  `.chip--BLOCKED`.
- **Verdict block** (results screen): definition-list rows, one labeled row per verdict
  dimension (`process_outcome`, `solver_answer`, `cross_tool_verdict`, `claim_verdict`),
  each with its own plain-language description — the dimensions are deliberately rendered
  as separate rows so they can never be visually conflated into a single "PASS". The real
  receipt's `solver_answer` is an object; the row shows `value` (`null (kind: none)` when
  nothing ran) with a `by_step` hint line when answers exist. An environment line below
  the block discloses `host / node / formal_portable_root_sha / run_id`.
- **Stepper**: 4 steps (Input → Plan → Run → Results), `aria-current="step"` on active,
  done steps tinted ok.
- **Evidence links**: native `<a download>` buttons → same-origin attachment endpoints
  (receipt JSON + hash manifest always; per-step stream links only for steps that
  actually produced streams).
- **Honesty labels**: header `engine: workflow-v2+v3 (real)` badge (ok colors, tooltip
  explains the fail-closed behavior without the bundle) + `mode:` badge (`local-only` /
  `token-auth`) + a **plan-source badge** on the plan screen ("deterministic template
  (template@v) — built-in, offline" vs "DeepSeek (deepseek-chat) — LLM proposal, admitted
  as data via static validation") — all driven by `GET /api/meta` and the plan response.
- The planning-source `<select>` on the input screen offers template vs `provider:
  "deepseek"`; its hint states the LLM proposes only and has no execution authority.
- Real solver stdout/stderr (when a trusted host exists) render in dark `pre` blocks;
  steps that never ran show "NOT_RUN — this step never executed" instead of streams.

## 4. Screen flow (text diagram)

```
                    ┌──────────────────────────────────────────────┐
                    │ header: brand · mode badge · engine(real)    │
                    │ stepper: [1 Input]-[2 Plan]-[3 Run]-[4 Results] │
                    └──────────────────────────────────────────────┘
   (1) screen-input                     (2) screen-plan
   ┌─────────────────────────┐   POST   ┌──────────────────────────────┐
   │ textarea problem        │  /api/   │ plan banner (id/kind/hashes) │
   │ sample buttons:         │  plan    │ steps table (id/tool/op/     │
   │  A SMT sat · B LP ·     │─────────▶│  deps/timeout)               │
   │  UNKNOWN · NEGATIVE     │  422 →   │ assumptions editor (inline)  │
   │ assumptions (optional)  │  fail-   │ plan JSON <details>          │
   │ [Generate plan]         │  closed  │ ☐ "I have reviewed…" ──┐     │
   └─────────────────────────┘  banner  │ [Approve & run] ◀──────┘gate │
        ▲  fail-closed error             └──────────────┬───────────────┘
        │  shown here, nothing                          │ POST /api/runs
        │  executes                                     ▼
   (4) screen-results                (3) screen-run (1s polling)
   ┌─────────────────────────┐  done   ┌──────────────────────────────┐
   │ verdict banner          │ ◀───────│ run meta (run_id/status)     │
   │  BLOCKED / FAIL-CLOSED/ │ status≠ │ per-step cards: live chip +  │
   │  CONTRADICTION /UNKNOWN │ running │  expandable stdout/stderr    │
   │  / OK (role=alert)      │         │  (streams only if they ran)  │
   │ verdict block (4 rows)  │         └──────────────────────────────┘
   │ environment line        │
   │ evidence download links │
   │ [Start new task]        │
   └─────────────────────────┘
```

Empty state = screen 1 with empty textarea (initial). Loading states = button disabled +
status text ("Building plan…", "Starting run…", "Run in progress…", live regions announce).
Error states = inline `role="status"` text with error tone + fail-closed banner.

## 5. Accessibility rules (a11y)

1. **Keyboard**: all interactivity via native elements (button/input/a/details/checkbox);
   DOM order = tab order; skip-link to `#main`; screen switch moves focus to the new
   screen's `h1` (`tabindex="-1"`); no keyboard traps.
2. **Labels**: every control has an explicit `<label for>` (or `aria-label` for icon-only
   remove buttons); tables have `<caption>` and `<th scope>`; stepper is a labeled `<nav>`.
3. **Live regions**: run statuses and per-screen status lines use `role="status"`
   `aria-live="polite"`; fail-closed/verdict banners use `role="alert"`.
4. **Contrast**: all text pairs ≥ 4.5:1 (see 2.2 measured table); non-text UI (borders,
   focus ring) ≥ 3:1 vs adjacent colors.
5. **Focus visibility**: `:focus-visible` ring token everywhere; never removed.
6. **Responsive**: single column ≤ 720px; plan side-panel stacks below; tables get
   horizontal scroll wrappers; header stacks; verified at 360px and 1440px.
7. **Language**: `lang="en"`; honest wording — "unknown" is never rendered as an error;
   blocked runs state plainly that no step ran and nothing is simulated.

## 6. API surface (bounded trusted bridge, `apps/web/server.mjs`)

Transport: same-origin HTTP on `127.0.0.1` (default port 8788, env `PORT`; env `HOST`
rebinds, but any non-loopback bind **requires** `FORMAL_WEB_TOKEN` — `startServer`
throws at startup otherwise, so anonymous execution beyond loopback is impossible).
Auth: optional `FORMAL_WEB_TOKEN` — when set, every `/api/*` route except `/api/meta`
requires `Authorization: Bearer <token>` (401 missing / 403 wrong). No CORS headers are
emitted (same-origin only). Bodies capped at 1 MB (413). Static files served from a
whitelist only.

| Method+Path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/meta` | none | — | `{mode:"local-only"|"token-auth", mocked_contracts:false, engine:{kind:"workflow-engine-v2-v3", real:true, planner, executor, note}, provider:{deepseek:{configured,model}}, versions:{bridge,engine,plan_schema,receipt_schema}, caps:{body_limit_bytes,max_concurrent_runs,run_wall_clock_s,max_plan_steps,max_step_timeout_s}, evidence:{stream_cap_bytes,full_stream_hashes,artifacts,identity_claim}, allowlist}` |
| `POST /api/plan` | bearer (if set) | `{problem_text:string, assumptions?:string[], provider?:"deepseek"}` | `{plan:<ExecutionPlan 1.0 with real compiled hashes>, plan_source:{kind:"deterministic-template",template} \| {kind:"deepseek",provider,model,method_sha256}}` · 422 fail-closed codes: `EMPTY_PROBLEM`, `UNSUPPORTED_PROBLEM`, `MALFORMED_LP_JSON`, `UNSUPPORTED_LP_MODEL`, `INVALID_ASSUMPTIONS`, `MISSING_PROBLEM`, `INVALID_PROVIDER`, `BLOCKED_PROVIDER` (no key), `PLAN_OVERSIZED`, `PLAN_INPUT_INVALID`, `PLAN_METHOD_INVALID` · 502 `PROVIDER_FAILED` (provider transport, details carry only status/reason — never the key) |
| `POST /api/runs` | bearer (if set) | `{plan:<ExecutionPlan>}` | `{run_id, status:"running", poll}` · bridge hard caps then the **executor's own re-validation** (identical codes): `PLAN_BUDGET_EXCEEDED`, `PLAN_TOOL_NOT_ALLOWED`, `PLAN_OPERATION_MISMATCH`, `PLAN_HASH_MISMATCH`, `PLAN_SCHEMA_INVALID`, `PLAN_CYCLE`, `PLAN_TIMEOUT_INVALID`, `PLAN_EXPECTED_KIND_INVALID`, `PLAN_INPUT_INVALID`, … · 429 `CONCURRENCY_LIMIT` when 2 runs active |
| `GET /api/runs/:id` | bearer (if set) | — | `{run_id, plan_id, status, created_at, engine:"workflow-v2+v3", plan_summary, step_states, receipt:<ExecutionReceipt 1.0, null while running>, streams:{step:{stdout,stderr}}}` · 404 `RUN_NOT_FOUND` |
| `GET /api/runs/:id/evidence` | bearer (if set) | optional `?part=manifest` or `?part=stdout\|stderr&step=<id>[&scope=full\|bounded]` | full: **the persisted real `receipt.json` bytes** as `attachment; filename="receipt-<run_id>.json"` · `?part=manifest`: hash-bound artifact manifest `attachment; filename="manifest-<run_id>.json"` — artifacts carry `scope:"full-stream"\|"bounded-copy"` and a `streams[]` map binding each step/stream to the receipt's authoritative **full-stream** sha256 plus the bounded copy's own sha256 and `bounded_matches_full_stream: true\|false\|null` (null = not verifiable, never claimed) · per-stream log download: defaults to the verified full-stream bytes when retained, else the bounded copy; `scope=bounded` forces the ≤4 KiB display copy, `scope=full` 404s honestly when full bytes were not retained · headers `X-Formal-Evidence-Scope: full-stream\|bounded-copy` + `X-Formal-Full-Stream-Sha256` (receipt hash over the FULL captured stream, distinct from the served artifact's own hash) · filenames `"<part>-<run_id>-<step>.txt"` (full) / `"<part>-<run_id>-<step>.bounded.txt"` (bounded) · 404 `ARTIFACT_NOT_FOUND` / 422 `EVIDENCE_PART_INVALID`+`EVIDENCE_SCOPE_INVALID` / 409 while running |

Hard caps (enforced server-side, mirrored by the engine): body ≤ 1,000,000 bytes (413);
≤ 2 concurrent runs (429); run wall clock ≤ 120s (plan budgets); plan steps ≤ 8;
per-step `timeout_s` ≤ 120; tools allowlist `z3/cvc5 → solve-smt`, `highs → solve-lp`,
`compare → cross-check`; `input_sha256` = `sha256Canonical(input)`; the bridge file
imports no `child_process` — the only process launch lives inside the V3 executor
(`spawn` argv, `shell:false`) and is unreachable without the trusted bundle; fs writes
go to the runs directory (per-run `receipt.json` + `manifest.json` + `logs/` — bounded
copies named `logs/<step>.<part>.bounded.txt`, plain names reserved for verified
full-stream bytes) and the executor's temp workspace is removed after each run; run ids
validated `[A-Za-z0-9-]+` before any path use.

Receipt verdict semantics (REAL engine): verdict layering is receipt-owned — `overall`
carries `process_outcome` (`OK|PARTIAL|FAILED|ABORTED`), `solver_answer`
(`{kind, value, by_step}`; `value` null when nothing/nothing-definitive ran),
`cross_tool_verdict` and `claim_verdict` as separate fields, plus
`fail_closed_reason` (`BLOCKED_TOOL_MISSING`, `BLOCKED_TOOL_VERSION_PROBE`,
`STEP_TIMEOUT`, `SOLVER_NONZERO_EXIT`, `SOLVER_OUTPUT_UNPARSABLE`,
`CROSS_TOOL_CONTRADICTION`, `BUDGET_WALL_CLOCK_EXCEEDED`, …). On a binary-less machine
every run is `ABORTED` + `BLOCKED_TOOL_MISSING` + `claim_verdict=BLOCKED` (honest
fail-closed, displayed distinctly — never an error tone, never a solver answer). On the
trusted host the same UI renders `OK`/`AGREE_SAT|AGREE_UNSAT`/`UNKNOWN`/`CONTRADICTION`
receipts from real solver output; `claim_verdict` stays `NOT_APPLICABLE` in this MVP
(no user claim submitted) and is always its own labeled row.

## 7. File map

- `apps/web/server.mjs` — bounded bridge + REAL V2/V3 engine wiring (no deps, node ≥ 20;
  `node server.mjs`); imports `packages/runner/js/{workflow-plan,workflow-compiler,
  workflow-executor,workflow-evidence,method-planner}.mjs`
- `apps/web/public/{index.html,app.js,styles.css}` — zero-build UI (vanilla JS, fetch only)
- `apps/web/package.json` — own package (NOT in root workspaces), `npm start` convenience
- `apps/web-tests/api.test.mjs` — `node --test` API conformance against the real engine
  (plan shape, DeepSeek path incl. the real-call test when `DEEPSEEK_API_KEY` is set,
  honest blocked receipts, evidence bytes, caps, auth)
- `apps/web-tests/artifacts/` — real-browser screenshots (see UI_VISUAL_ACCEPTANCE.md)
- `docs/mvp/UI_VISUAL_ACCEPTANCE.md` — browser evidence & checklist (V5-b live engine)

---

## 8. R3 addendum (2026-11-20, branch `i180/r3-web-nl`) — NL lane: natural-language entry + user-inspectable model approval (OUTPUT_LABEL=FORMAL_TOOLS_I180_R3_WEB_NL_ENTRY)

Scope: wires the EXISTING `packages/runner/js/nl-model.mjs` pipeline into the EXISTING
Web UI. No second parser/runner/UI was built; design tokens, the four-phase stepper
and all V5-b behaviors are unchanged. Reproduced pre-fix state first: `POST /api/plan`
with Chinese prose fail-closed with 422 `UNSUPPORTED_PROBLEM` and no plan — ordinary
users had no prose entry at all.

### 8.1 New bridge endpoints (apps/web/server.mjs, additive)

| Method+Path | Request | Response |
|---|---|---|
| `POST /api/nl/propose` | `{text}` (≤ 8 KiB canonical) | `{proposal:<proposeConstraintModel result>, warnings:string[]}` — `MODEL_PROPOSED` (full provenance: original text/sha, provider name+model, prompt/response/proposal shas, structured model, rendered QF_LIA artifact + `semantic_status=TRANSLATION_PROPOSAL_NOT_VERIFIED_AGAINST_TEXT`, honesty note), `NEEDS_CLARIFICATION` (questions list, `model:null`, `rendering:null`, `proposal_sha256:null`), or `UNKNOWN` (reason+issues). Provider: the `"deepseek"` string path (env key, header-only; provenance names `{name:"deepseek", model:"deepseek-chat"}`); no key ⇒ 422 `BLOCKED_PROVIDER` before any provider is built. `NL_TEXT_INVALID` / `NL_TEXT_OVERSIZED` 422 |
| `POST /api/nl/revise` | `{proposal, edited:<structured model>}` | `{preview:{model, rendering, lp_model?, lp_render_error?}, warnings, note}` — status gate first (`NL_NOT_APPROVABLE` for non-MODEL_PROPOSED), then `proposal_sha256` integrity recheck (`NL_TAMPERED`), then `validateStructuredModel` + fresh `renderSmtArtifact` of the EDITED model. PREVIEW ONLY: proposal hashes unchanged; the edit is bound into the approval hash at approve time |
| `POST /api/nl/approve` | `{proposal, approved:boolean, edited?, reviewer?, note?}` | `approved:false` → `{decision:"USER_REJECTED", record}` (terminal; explicit rejection of NEEDS_CLARIFICATION/UNKNOWN records also allowed, mirroring `approveModel`). `approved:true` → `approveModel` (re-validates `edited`, sets `review.edited`) → `buildPlanFromApprovedModel` (re-checks `approved_sha256` + render drift) → `compilePlan` → `{decision:"USER_APPROVED", plan, plan_sha256, approval:{plan_sha256, approved_sha256, proposal_sha256, question, target}, question, target, warnings, approved:{approved_sha256, review}}`. Nothing auto-executes |
| `POST /api/runs` (additive) | `{plan, approval?:{plan_sha256, approved_sha256}}` | When `approval` is present the bridge refuses to run unless (a) `sha256Canonical(plan)` equals `approval.plan_sha256` and (b) that plan sha was produced by a real USER_APPROVED record in THIS process with the matching `approved_sha256`. Codes: `NL_APPROVAL_INVALID` (shape), `NL_APPROVAL_UNKNOWN` (no registered approval), `NL_PLAN_APPROVAL_MISMATCH` (binding violated — tamper/substitution). The run view gains additive `nl_approval_binding:{plan_sha256, approved_sha256, verified:true}` |

`GET /api/meta` gains additive `nl_lane` (module, endpoint contracts, execution-binding
rule, the verbatim LP relaxation disclosure, provider/configured flags). All NL routes
sit behind the same bearer-token gate as the rest of the API; the API key never
reaches the browser; no child_process is introduced; server NL state is one in-memory
approval registry (restart ⇒ approvals forgotten ⇒ bound runs fail closed
`NL_APPROVAL_UNKNOWN`, never silently execute).

### 8.2 UI flow (tokens/stepper unchanged)

- **Screen 1**: `Input mode` radio pair — structured model (previous behavior byte-for-byte) vs "Natural language". NL section: prose textarea (Chinese/English), three NL samples (整数对 sat / 最大化 LP / 模糊 clarification), "Propose model (DeepSeek)" button. `NEEDS_CLARIFICATION` renders a `role="alert"` warn banner listing the model's questions on the input screen — no plan, no approve path, execution impossible from that state; `UNKNOWN` renders reason+issues as a fail-closed status.
- **Screen 2a — NL model review** (replaces plan review until approval): original request (verbatim pre), editable structured form (variable bounds table, per-constraint rows with `name:int` coefficient shorthand + op select + rhs, assumptions editor, objective row for optimize) — NEVER a raw-SMT edit box; read-only rendered SMT-LIB2 (the hash-bound artifact the solvers will answer); LP box (HiGHS shape) for optimize; provenance panel (provider, schema, original-text/prompt/response/proposal/rendering shas, render status) + the verbatim honesty note; decision card with Approve (hash-bound `approved_sha256`) / Reject (terminal) / ← Edit input. "Apply edits & re-validate" posts to `/api/nl/revise` and re-renders the form FROM the validated model (the form state is the validated truth). `question:"optimize"` shows a prominent warn banner ("LP RELAXATION — NON-INTEGER RESULT") at propose, revise and again on the plan screen (server `warnings` + the plan's `NL_LP_RELAXATION_ASSUMPTION` assumption are cross-checked; never presented as an integer optimum).
- **Screen 2b — plan review**: after approval the existing plan review appears with the derived plan (`problem_kind:"nl_model"`), a new plan-source badge ("NL model (deepseek-chat) — user-approved translation proposal (hash-bound) → smt|lp plan") and the final existing "Approve & run" gate, which now submits the plan WITH the approval binding for server-side verification. Results screen gains the standing translation caveat: verdicts answer the APPROVED RENDERED MODEL, not the prose; render/solve validity does not prove translation fidelity.
- CSS: additive NL styles only (mode toggle, provenance list, constraint rows, coefficient/bound inputs) on the existing tokens; one global fix `[hidden]{display:none !important}` so author display rules can never defeat the hidden attribute (NL mode toggle depends on it).

### 8.3 Tests & CI

`apps/web-tests/nl.test.mjs` (17 tests, fully offline via the `nlProviderImpl` seam):
meta advertisement; propose happy path incl. provenance/rendering; NEEDS_CLARIFICATION
dead end (approve 422 `NL_NOT_APPROVABLE`, revise 422, explicit reject allowed);
hostile reply → UNKNOWN; empty/oversized/bad input 422; no-key 422
`BLOCKED_PROVIDER`; revise happy/edit-hash/render-change + tampered proposal
`NL_TAMPERED` + invalid edits (`bounds_crossed`, undeclared coefficient); approve→plan
binding (`plan_sha256 === sha256Canonical(plan)`, nl_model kind, assumptions verbatim,
z3+cvc5+compare); approval-bound run through the EXISTING `/api/runs` (honest
`BLOCKED_TOOL_MISSING` receipt, `nl_approval_binding.verified`); tamper matrix
(plan A approval + plan B submission → `NL_PLAN_APPROVAL_MISMATCH`; unregistered plan
sha → `NL_APPROVAL_UNKNOWN`; malformed binding → `NL_APPROVAL_INVALID`; mutated
proposal → `NL_TAMPERED`); edited approval changes approval+plan hashes and the plan
input carries the edited bound; reject terminal record; LP arm (warnings at
propose+approve, highs-only plan, integrality-drop assumption present); direct-lane
regression (prose still 422 on `/api/plan`); token-auth enforcement. CI
(`.woodpecker/formal-static.yaml`) gains an additive `web-bridge-tests` step running
`node --test apps/web-tests/*.test.mjs` with `DEEPSEEK_API_KEY=` cleared (fully
offline; the suite skips real-LLM paths when the key is unset).
