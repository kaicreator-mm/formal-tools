# UI_DESIGN.md — formal-tools V5 Web UI design system (OUTPUT_LABEL=FORMAL_TOOLS_I180_V5_WEB_UI)

Scope: `apps/web/**` (zero-build vanilla frontend + bounded Node bridge) as delivered for
issue #185 (parent #180). The execution engine is **MOCKED this round (V5-a)**; plans and
receipts use the pinned V0 contract shapes exactly so the real V2/V3 engine can be wired
behind the same endpoints in V5-b without UI changes.

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
| OK / agree | `#0f6b33` | `#e7f6ec` | `#b7e2c3` | `EXECUTED`, `OK`, `AGREE_SAT`, `AGREE_UNSAT`, `RUN COMPLETE` |
| warning / degraded | `#7a4900` | `#fff3d6` | `#ecd39b` | `TIMEOUT`, `PARTIAL`, MOCKED badge |
| danger / fail-closed | `#a92019` | `#fdecea` | `#f3c2bd` | `ERROR`, `FAILED`, `ABORTED`, `CONTRADICTION` |
| unknown / undecided | `#5b3ba8` | `#f1edfd` | `#d9cff2` | `UNKNOWN` verdict, honest "cannot decide" |
| info | `#0b4a6f` | `#e3f2fa` | `#bcdff2` | `mode:` badge, plan banner |

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
- **Banners** (`.banner--ok|warn|danger|unknown|info`): a single top banner per screen for
  fail-closed / CONTRADICTION / UNKNOWN messaging with `role="alert"`.
- **Verdict block** (results screen): definition-list rows, one labeled row per verdict
  dimension (`process_outcome`, `solver_answer`, `cross_tool_verdict`, `claim_verdict`),
  each with its own plain-language description — the dimensions are deliberately rendered
  as separate rows so they can never be visually conflated into a single "PASS".
- **Stepper**: 4 steps (Input → Plan → Run → Results), `aria-current="step"` on active,
  done steps tinted ok.
- **Evidence links**: native `<a download>` buttons → same-origin attachment endpoints.
- **Honesty labels**: header `MOCKED CONTRACTS` badge (warn colors, tooltip explains V5-a
  mock scope) + `mode:` badge (`local-only` / `token-auth`) — both driven by `GET /api/meta`.
- All simulated stdout/stderr streams rendered in dark `pre` blocks; every stream content
  produced by the mock engine starts with `# [SIMULATED]`.

## 4. Screen flow (text diagram)

```
                    ┌──────────────────────────────────────────────┐
                    │ header: brand · mode badge · MOCKED badge    │
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
   │ verdict block:          │ ◀───────│ run meta (run_id/status)     │
   │  process_outcome (chip) │ status≠ │ overall banner: CONTRADICTION │
   │  solver_answer   (chip) │ running │  / UNKNOWN / FAILED warn      │
   │  cross_tool_verdict     │         │ per-step cards: live chip +   │
   │  claim_verdict          │         │  expandable stdout/stderr     │
   │ evidence download links │         └──────────────────────────────┘
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
   simulated streams always carry the `[SIMULATED]` prefix.

## 6. API surface (bounded trusted bridge, `apps/web/server.mjs`)

Transport: same-origin HTTP on `127.0.0.1` (default port 8788, env `PORT`). Auth: optional
`FORMAL_WEB_TOKEN` — when set, every `/api/*` route except `/api/meta` requires
`Authorization: Bearer <token>` (401 missing / 403 wrong). No CORS headers are emitted
(same-origin only). Bodies capped at 1 MB (413). Static files served from a whitelist only.

| Method+Path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/meta` | none | — | `{mode:"local-only"|"token-auth", mocked_contracts:true, engine:{kind,note}, versions:{bridge,engine,plan_schema,receipt_schema}, caps:{body_limit_bytes,max_concurrent_runs,run_wall_clock_s,max_plan_steps,max_step_timeout_s}, allowlist}` |
| `POST /api/plan` | bearer (if set) | `{problem_text:string, assumptions?:string[]}` | `{plan:<ExecutionPlan 1.0>, assumptions:[{id,text}], mocked_contracts:true}` · 422 fail-closed codes: `EMPTY_PROBLEM`, `UNSUPPORTED_PROBLEM`, `MALFORMED_LP_JSON`, `UNSUPPORTED_JSON`, `INVALID_ASSUMPTIONS`, `MISSING_PROBLEM` |
| `POST /api/runs` | bearer (if set) | `{plan:<ExecutionPlan>}` | `{run_id, status:"running", poll, mocked:true}` · 422 codes: `PLAN_SCHEMA_MISMATCH`, `UNKNOWN_TOOL`, `OPERATION_MISMATCH`, `STEP_INPUT_HASH_MISMATCH`, `PLAN_STEPS_COUNT`, `PLAN_CYCLE`, `BUDGETS_EXCEEDED`, `STEP_TIMEOUT_INVALID`, … · 429 `CONCURRENCY_LIMIT` when 2 runs active |
| `GET /api/runs/:id` | bearer (if set) | — | `{run_id, plan_id, status, created_at, plan_summary, step_states, receipt:<ExecutionReceipt 1.0, partial while running>, streams:{step:{stdout,stderr}}, mocked:true}` · 404 `RUN_NOT_FOUND` |
| `GET /api/runs/:id/evidence` | bearer (if set) | optional `?part=stdout\|stderr&step=<id>` | full: `attachment; filename="receipt-<run_id>.json"` with `{receipt, streams}` · per-stream: `attachment; filename="<part>-<run_id>-<step>.txt"` · 404/409/422 codes as applicable |

Hard caps (enforced server-side): body ≤ 1,000,000 bytes; ≤ 2 concurrent runs (429);
run wall clock ≤ 120s (hard ABORTED timer); plan steps ≤ 8; per-step `timeout_s` ≤ 120;
tools allowlist `z3/cvc5 → solve-smt`, `highs → solve-lp`, `compare → cross-check`;
`input_sha256` must equal `sha256(input)`; no `child_process` anywhere; fs writes only to
the runs directory; run ids validated `[A-Za-z0-9-]+` before any path use.

Receipt verdict semantics (mock engine, deterministic, marker-driven via `;; @expect:` in
the SMT input): default `sat` → `AGREE_SAT`/`OK`; `unsat` → `AGREE_UNSAT`/`OK`;
`unknown` → `UNKNOWN`/`OK` (honest undecided, not an error); `contradiction` →
`CONTRADICTION`/`PARTIAL` (danger warning in UI); `error` → step `ERROR` (exit 1) +
downstream `SKIPPED_DOWNSTREAM` → `FAILED` with `fail_closed_reason`; `timeout` → step
`TIMEOUT` (exit null) + skip → `FAILED`. LP scenario → `optimal`,
`cross_tool_verdict: NOT_APPLICABLE`. `claim_verdict` is always `NOT_APPLICABLE` in this
MVP round (no user claim is submitted); it is rendered as its own labeled row regardless,
so the four verdict dimensions stay distinct.

## 7. File map

- `apps/web/server.mjs` — bridge + mocked engine (no deps, node ≥ 20; `node server.mjs`)
- `apps/web/public/{index.html,app.js,styles.css}` — zero-build UI (vanilla JS, fetch only)
- `apps/web/package.json` — own package (NOT in root workspaces), `npm start` convenience
- `apps/web-tests/api.test.mjs` — `node --test` API conformance + caps (28 tests)
- `apps/web-tests/artifacts/` — real-browser screenshots (see UI_VISUAL_ACCEPTANCE.md)
- `docs/mvp/UI_VISUAL_ACCEPTANCE.md` — browser evidence & checklist
