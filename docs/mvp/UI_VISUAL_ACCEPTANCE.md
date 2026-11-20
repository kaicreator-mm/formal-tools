# UI_VISUAL_ACCEPTANCE.md — V5-b Web UI real-browser evidence (OUTPUT_LABEL=FORMAL_TOOLS_I180_V5B_LIVE_ENGINE)

Date: 2026-11-19 · Worktree `wt-i180-v5b` (branch `i180/v5b`, base `f2b6a8d`) · Server:
`node apps/web/server.mjs` on http://127.0.0.1:8788/ (`mode: local-only`,
`mocked_contracts: false`, engine `workflow-v2+v3` — the REAL V2 planner/compiler + V3
executor behind the bounded bridge). The MOCKED badge of V5-a is gone; the header now
carries a persistent `engine: workflow-v2+v3 (real)` badge.

**Honest scope note (read first):** the trusted native tool host (cc@192.168.100.200
portable bundle) is currently UNREACHABLE, and this Windows machine has no z3/cvc5/highs
binaries. Therefore every real run on this machine honestly fails closed BEFORE any tool
starts: the V3 executor returns a REAL `formal-tools/execution-receipt/1.0` receipt with
`overall.process_outcome=ABORTED`, `fail_closed_reason=BLOCKED_TOOL_MISSING`,
`claim_verdict=BLOCKED`, all steps `NOT_RUN`, and `tool_versions={}` (no probes were
possible). That blocked state is what the browser walk below shows and what the receipts
under `apps/web-tests/.runs/` contain — nothing is simulated and no solver answer is
claimed. The full happy-path browser walk with real solver output happens in **V6** on
the trusted host and is deliberately NOT faked here.

The one real LLM integration point IS real this round: `provider:"deepseek"` plans made
an actual DeepSeek API call (`deepseek-chat`, key from `DEEPSEEK_API_KEY`), and the
proposal entered the plan only through the V2 static validation gates.

Browser: ZCode in-app browser (IAB / Chromium), viewport 1280×800. All screenshots are
of the live running app; DOM snapshots were verified around every interaction.

## Artifacts (all under `apps/web-tests/artifacts/`)

| File | Screen | What it proves |
|---|---|---|
| `live-1-blocked-run.png` | 4 · Results (blocked) | Distinct **BLOCKED banner** (warn tones, dashed border + left accent): "BLOCKED — TRUSTED TOOLS UNAVAILABLE (fail-closed, nothing simulated)" with `fail_closed_reason: BLOCKED_TOOL_MISSING` and the plain-language fail-closed explanation. Verdict rows: `process_outcome=ABORTED`, `solver_answer=null (kind: none)`, `cross_tool_verdict=NOT_APPLICABLE`, `claim_verdict=BLOCKED`; environment line `host: 127.0.0.1 · node: v26.13.0 · portable root sha: none · receipt run_id: run-mwng24dx-…`; receipt + hash-manifest download buttons (no per-step stream links — none exist, honestly) |
| `live-2-deepseek-plan.png` | 2 · Plan review (real LLM) | Plan source badge **"DeepSeek (deepseek-chat) — LLM proposal, admitted as data via static validation"**; the LLM-proposed method rendered as steps `z3-solve` (z3/solve-smt, 30s) → `cvc5-solve` (cvc5/solve-smt, depends on z3-solve, 30s) plus the executor-side `step-agree` compare (5s) appended by the bridge; approve gate disabled |
| `live-3-negative-422.png` | 1 · negative path | Malformed prose input → red fail-closed status `fail-closed (422) UNSUPPORTED_PROBLEM: …neither SMT-LIB2 text … nor an LP JSON model with exactly sense/objective/variables/constraints keys`; stays on input screen, nothing executes |
| `live-4-plan-template.png` | 2 · Plan review (template) | Deterministic template badge "smt-cross-check@v1 — built-in, offline"; real V2 plan `wf-c8a68ee6…` with steps `step-z3`/`step-cvc5`/`step-agree`, real compiled manifest hash; **`Approve & run` disabled until the review checkbox is ticked** (verified `approveDisabledBeforeReview=true`, and enabled=true after check during the walk) |

## Journeys performed (server-side receipts persisted in `apps/web-tests/.runs/`)

1. **Scenario A (SMT cross-check) → honest BLOCKED run** — load sample A → Generate plan
   (deterministic template, plan `wf-c8a68ee603a810d9a5ef4a7f049be057`, 3 steps) → tick
   review checkbox (approve button flips disabled→enabled; verified both states) →
   Approve & run (`run-mwng24dx-125c1c30`) → results screen renders the blocked state
   (live-1). Persisted artifacts: `.runs/run-mwng24dx-125c1c30/{receipt.json,
   manifest.json, logs/}` — the same files the evidence endpoints serve byte-identically
   (asserted in `apps/web-tests/api.test.mjs`).
2. **Real DeepSeek plan** — planning source = DeepSeek → Generate plan → a real
   `deepseek-chat` call proposed the two-solver method (live-2; `method_sha256` recorded
   in the plan response). The proposal is untrusted data: it passed `assessMethod` +
   `buildExecutionPlan` before the plan existed.
3. **Negative (fail-closed)** — "Negative · malformed" sample → Generate plan → HTTP 422
   `UNSUPPORTED_PROBLEM` rendered in red on the input screen (live-3); no plan, no run.
4. **Evidence endpoints over HTTP** (cross-checked outside the browser):
   `GET /api/runs/:id/evidence` serves the persisted `receipt.json` bytes as an
   attachment; `?part=manifest` serves the hash-bound artifact manifest; per-step stream
   downloads honestly 404 with `ARTIFACT_NOT_FOUND` ("step never produced a stdout
   stream") on this binary-less machine.

## Checklist

| Item | Result |
|---|---|
| Page loads at configured address, server live | PASS — http://127.0.0.1:8788/, title `formal-tools — task console` |
| Submit a real supported model | PASS — scenarios A (SMT) and B (LP, exercised via API tests + earlier walks) |
| Inspect/approve plan (explicit gate) | PASS — approve disabled until review checkbox ticked (verified both states, live-4) |
| Plan source honesty | PASS — deterministic template vs DeepSeek (deepseek-chat) badges (live-2 / live-4) |
| Live run status | PASS — 1s polling; on this machine the run completes as an honest fail-closed ABORT within ~1s |
| Actual result / blocked display | PASS — distinct BLOCKED banner + `ABORTED / null / NOT_APPLICABLE / BLOCKED` verdict rows (live-1); no solver answer claimed |
| Evidence open/download | PASS — receipt + hash-manifest attachments verified over HTTP; byte-identical to persisted files (API tests) |
| Negative fail-closed message | PASS — 422 rendered on-screen, no execution (live-3) |
| Mocked-ness removed | PASS — `MOCKED CONTRACTS` badge deleted from HTML (asserted in api.test.mjs), `/api/meta.mocked_contracts=false`, engine `workflow-v2+v3 (real)` badge shown |
| Real LLM disclosure | PASS — DeepSeek plans labeled with the real provider + model name; no key ⇒ honest `BLOCKED_PROVIDER` (API test) |
| Keyboard order / focus / labels | PASS — unchanged from V5-a (native controls, explicit labels, skip-link, focus-visible ring); not re-walked this round |

## Honest gaps / limitations

1. **Trusted tool host unreachable (this round)** — no real z3/cvc5/highs execution and
   therefore no AGREE_SAT/UNKNOWN/CONTRADICTION happy-path walks in the browser. The
   BLOCKED state shown is the true, fail-closed behavior of a binary-less machine, not a
   mock. **V6 on the trusted host must re-walk the happy paths** (sat agreement, unknown,
   contradiction, LP optimal) with real receipts.
2. **Download materialization** — the in-app browser fires the download event but cannot
   save files to a host path in this sandbox; receipt/manifest bytes + `Content-Disposition`
   headers were verified over HTTP instead (and by API tests).
3. **Automation input path** — in this IAB session neither Playwright locator
   `click()` nor DOM-CUA node-path clicks dispatched to the page (same degradation V5-a
   documented). All journeys were driven via in-page genuine `el.click()` calls through
   `evaluate` — the same handler paths a user click takes, but not OS-level input
   events. Checkbox/enable/disable gate states were read back before/after.
4. **Results-screen banner placement bug fixed this round** — the verdict banner is now
   rendered on the results screen itself (`#resultNote`); V5-a wrote it to an element on
   the hidden run screen.
5. One transient blank full-viewport capture occurred (IAB capture glitch, V5-a gap #4
   recurrence); the affected screenshot was retaken.
6. `claim_verdict` renders as `BLOCKED` on this machine (receipt-derived); the
   `NOT_APPLICABLE` no-claim case and `PASS`/`UNSUPPORTED_BY_MVP` semantics await V6
   happy-path receipts.

## V5-a (mock round) evidence

The mocked-engine round (V5-a, PR #191) evidence lives in git history
(`docs/mvp/UI_VISUAL_ACCEPTANCE.md` @ `5a9085e`); its `[SIMULATED]` walkthroughs are
obsolete now that the real engine is wired and the mock artifacts were removed.

## R2-D addendum (2026-11-19, branch `i180/r2-web-evidence`) — full-stream vs bounded evidence hashes, honestly separated

OUTPUT_LABEL=FORMAL_TOOLS_I180_R2_WEB_EVIDENCE · base `80a0a07` · review item: P2
"output evidence clarity" (independent review, #185 comment 7010610614 item 5).

**Diagnosis (reproduced deterministically before the fix).** The receipt's
`steps[].stdout_sha256`/`stderr_sha256` hash the **FULL** captured streams, while the
persisted log artifacts were built from `stdout_bounded`/`stderr_bounded`
(`BOUNDED_BYTES = 4096` display copies). For a synthetic 8197-byte stdout the old
persistence wrote `logs/<step>.stdout.txt` containing 4096 bytes whose manifest sha256
(`9ce9834d…`) silently mismatched the receipt's full-stream hash (`50cdfe43…`) — with
nothing in the file name or manifest labeling the truncation, so a verifier comparing
artifact against receipt hash saw an unexplained mismatch and a downloader got an
unlabeled excerpt. The V3 executor's own workspace artifacts are equally bounded and
the workspace does NOT retain full stream bytes anywhere, so after a run the full bytes
were unrecoverable. Existing short-output (≤4 KiB) proofs were and remain valid:
below the cap the bounded copy IS the full stream.

**Fix (evidence honesty, no engine changes).**
1. Bounded copies are now persisted as `logs/<step>.<part>.bounded.txt` with their OWN
   sha256 and `scope:"bounded-copy"` in the manifest.
2. A plain-named `logs/<step>.<part>.txt` (`scope:"full-stream"`) is written ONLY when
   its bytes verify against the receipt's full-stream hash — from retained full bytes
   (test-only `executorCaptureImpl` tee) or provably from a bounded copy shorter than
   the cap. The manifest carries a `streams[]` map binding each stream to its
   authoritative full-stream hash plus `bounded_matches_full_stream: true|false|null`
   (null = not verifiable on this host, never claimed) and an explicit
   `labeling_note` ("never claim byte identity across them").
3. The evidence endpoint serves the full bytes when retained (default) and otherwise
   the labeled bounded copy; `&scope=full|bounded` selects explicitly; response headers
   `X-Formal-Evidence-Scope` + `X-Formal-Full-Stream-Sha256` keep the two hashes
   distinct; `scope=full` without retained bytes 404s with an honest explanation.
4. UI evidence list shows both hashes labeled ("full-stream SHA-256 … (over the FULL
   captured stream)" vs "bounded copy SHA-256 … (verified identical / TRUNCATED
   prefix / not verified on this host)") with distinct download links; no identity is
   claimed that does not hold. Screenshot:
   `apps/web-tests/artifacts/r2-full-vs-bounded-evidence.png` (results screen of a real
   >4 KiB-output run through the capture seam).
5. Non-loopback hardening (same review, item 6): a bind host other than
   `127.0.0.1`/`localhost`/`::1` now REQUIRES `FORMAL_WEB_TOKEN` — `startServer` throws
   at startup otherwise; `HOST` env added to the main entry (default unchanged
   `127.0.0.1`). Tests: non-loopback without token refuses to start; with token,
   unauthenticated request → 401.

**Proof (deterministic, any machine, no solver binaries needed).** A REAL
`executeWorkflowPlan` run through the HTTP bridge whose process capture is stubbed via
the executor's own `captureImpl` injection (bridge test seam `executorCaptureImpl`;
plan/preflight/receipt/bounded-copy/persistence all fully real) produces a 9005-byte
stdout: the plain-named artifact's sha256 equals `receipt.steps[].stdout_sha256`, the
bounded artifact differs and is labeled, the endpoint serves the full 9005 bytes by
default and the 4096-byte labeled copy under `scope=bounded`, and deleting the full
artifact (simulating the default-capture production state) yields the honest bounded
fallback + 404 with explanation. All asserted in `apps/web-tests/api.test.mjs`
(describes "full-vs-bounded evidence hashes" and "persistRunEvidence"). 41/41 green.

**Honest gaps:** the >4 KiB bounded-only HTTP path is exercised by removing the full
artifact in the test (the default capture never retains full bytes, so that state has
no other deterministic producer on a binary-less machine); the teed capture seam covers
solve-smt steps only (the solve-lp portfolio path does not route through `captureImpl`,
so LP streams stay bounded-only with `bounded_matches_full_stream: null` — correct, just
not verifiable); browser download materialization still verified over HTTP headers +
API tests (IAB sandbox limitation unchanged from V5-b).

---

## R3 addendum (2026-11-20, branch `i180/r3-web-nl`) — NL lane real-browser evidence (OUTPUT_LABEL=FORMAL_TOOLS_I180_R3_WEB_NL_ENTRY)

Server: `node apps/web/server.mjs` on http://127.0.0.1:8801/ (real engine
`workflow-v2+v3`, `mocked_contracts:false`, `provider.deepseek.configured:true` from
`DEEPSEEK_API_KEY`). Browser: ZCode in-app browser (IAB/Chromium), viewport 1280×900.
**All journeys were agent-surrogate driven** (in-page genuine `el.click()` calls
through the same handler paths a user click takes — the documented IAB input-path
degradation of V5-a/V5-b recurred; locator `click()` did not dispatch). Button
disabled/enabled states and banner/checkbox states were read back before/after every
step; nothing was fabricated.

**Real-LLM budget disclosure: exactly 2 real DeepSeek calls were made, both
`deepseek-chat` proposes of the sat sample on the production server (journey A). The
first was spent on a pre-fix build (its proposal is NOT used as evidence — see bugs
below); the second is the recorded journey A. The clarification/reject journeys (B/C)
run on a second local instance (port 8802) with the deterministic `nlProviderImpl`
stub (provider provenance honestly displays `injected (stub-nl-model)`) to stay
within the 2-call budget; the real-DeepSeek clarification precedent for the same
vague text is the committed receipt
`validation/local-runtime-receipts/nl-model-j3-clarification.proposal.json`
(docs/mvp/NL_MODEL.md §3.3). The BLOCKED run receipt is a real V3 executor receipt on
this binary-less machine — the honest negative, not a mock.

### Artifacts (all under `apps/web-tests/artifacts/`)

| File | Screen | What it proves |
|---|---|---|
| `r3-nl-1-input.png` | 1 · Input (NL mode) | Input-mode radio pair; NL prose textarea with the sat sample loaded; untrusted-proposal hint; "Generate plan" correctly hidden in NL mode (the `[hidden]` CSS fix) |
| `r3-nl-2-model-review.png` | 2 · NL model review (REAL DeepSeek) | Real `deepseek-chat` proposal of the 7-multiples problem: x∈[3,50], y∈[1,50], auxiliary k∈[0,14] with derivation recorded in 4 assumptions; constraints `x:1 y:1 k:-7 == 0` / `y:1 x:-1 <= 0`; provenance panel names `deepseek (deepseek-chat)` with prompt/response/proposal/rendering shas + `TRANSLATION_PROPOSAL_…` status; honesty note verbatim. Note: the decision-card gate paragraph still shows the pre-fix flex-wrap layout bug (fixed immediately after; corrected layout visible in r3-nl-3/7) |
| `r3-nl-3-edited-revalidated.png` | 2 · after structured edit | x upper edited 50→40 in the FORM (never the raw SMT); "Apply edits & re-validate" → server preview note "NOT yet part of the proposal hash — approving now binds the edited model into the approval hash"; read-only SMT re-rendered with `(assert (<= x 40))`; status "Edits validated (preview only). Approve to bind them." |
| `r3-nl-4-plan-review.png` | 2 · plan review (post-approval) | Banner `Plan wf-19cd9f7c1af1016cefd77b6e4793791d · kind: nl_model`; plan-source badge "NL model (deepseek-chat) — user-approved translation proposal (hash-bound) → smt plan"; steps z3 → cvc5 → compare; the model's 4 assumptions carried verbatim; Approve & run still gated by the review checkbox |
| `r3-nl-5-results-blocked.png` | 4 · Results | **BLOCKED banner** (warn tones, dashed border): `BLOCKED_TOOL_MISSING`, nothing simulated; verdict rows `ABORTED / null (kind: none) / NOT_APPLICABLE / BLOCKED`; standing NL translation caveat "verdicts answer the approved RENDERED MODEL … not your natural-language text"; environment line `run_id: run-mwnt7tkj-96c3b3b2`; receipt+manifest downloads. Run view (verified over HTTP): `nl_approval_binding.verified:true` with `approved_sha256 bd0cc96d4fc69604…` — the executed plan is the exact approved one |
| `r3-nl-6-clarification.png` | 1 · NEEDS_CLARIFICATION (stub instance 8802) | Vague text → warn `role="alert"` banner listing the model's 2 questions ("no model was proposed, nothing can be executed"); red status "nothing was rendered or planned"; stays on input; no approve/execution path exists in this state |
| `r3-nl-7-reject-terminal.png` | 2 · REJECTED terminal (stub instance 8802) | Danger banner "REJECTED — terminal decision · Decision record: USER_REJECTED (proposal_sha256 92e181a2ff8aad8f…) · No plan was built and nothing will execute"; Approve/Reject buttons disabled; provider honestly shows `injected (stub-nl-model)`; also evidences the fixed gate-paragraph layout and the fixed model-review visibility on a fresh load |

### Journeys

1. **A (REAL DeepSeek, production server 8801)** — NL mode → sat sample → Propose
   (real `deepseek-chat` call) → model review with full provenance → structured edit
   x.upper 50→40 → Apply edits (server re-validate/re-render preview) → "Approve model
   & build plan" (`approved_sha256 bd0cc96d…`, edited=true) → plan review
   (`wf-19cd9f7c…`, `nl_model`, z3+cvc5+compare) → review checkbox → "Approve & run"
   (submits plan + approval binding) → honest `ABORTED / BLOCKED_TOOL_MISSING`
   receipt + translation caveat (r3-nl-1…5). Run artifacts persisted under
   `apps/web-tests/.runs/run-mwnt7tkj-96c3b3b2/` (receipt.json + manifest.json).
2. **B (stub instance 8802)** — vague sample → Propose → NEEDS_CLARIFICATION banner
   with the two questions; no plan, no approve path (r3-nl-6).
3. **C (stub instance 8802)** — sat sample → Propose → model review → "Reject
   (terminal)" → USER_REJECTED terminal banner, both decision buttons disabled
   (r3-nl-7).

### Bugs found & fixed during this walk (each reproduced before the fix)

1. **Model review never became visible** — `renderNlProposal` filled the review but
   never cleared `hidden`; the first real proposal was fully rendered yet invisible.
   Fix: renderNlProposal unhides `#nlModelReview` / hides `#planReview` (verified on
   fresh loads in journeys B/C and by the live session continuing to completion).
2. **`[hidden]` defeated by author CSS** — `.actions{display:flex}` (V5-b rule)
   overrode the UA hidden style, so "Generate plan" stayed visible in NL mode. Fix:
   global `[hidden]{display:none !important}`.
3. **Provider provenance mislabeled "injected"** — passing the provider OBJECT from
   `makeNlModelProvider` made `normalizeProvider` name the real DeepSeek call
   "injected". Fix: production passes the `"deepseek"` string (env-key path,
   provenance `{name:"deepseek", model:"deepseek-chat"}`); no-key requests are
   refused 422 `BLOCKED_PROVIDER` server-side before any provider is built; the
   `nlProviderImpl` seam remains the only injection path (honestly named
   `injected`).
4. **Decision-card gate paragraph used the flex checkbox-gate class** and wrapped
   into columns; now a plain hint paragraph.

### Honest gaps / limitations

1. **Local execution stays BLOCKED by design** — this machine has no z3/cvc5/highs;
   journey A's receipt is the real fail-closed ABORT (nothing simulated). The real
   solver full-chain walk is deferred to the trusted-host lane (sub-agent D, V6).
2. **LLM call budget** — 2 real calls total (both journey-A proposes; the first on a
   pre-fix build is disclosed, not used as evidence). Clarification/reject UI states
   were exercised via the deterministic stub instance and are labeled as such in the
   screenshots; the real-LLM clarification behavior for the same text is committed
   evidence (`nl-model-j3-clarification.proposal.json`).
3. **Agent-surrogate input** — all clicks were in-page `el.click()` calls (IAB
   input-path degradation documented since V5-a); no OS-level input events. States
   were verified programmatically around every step.
4. **In-flight `UNSUPPORTED_EXACT_INTEGER_OPTIMIZATION` alignment** — per the R3
   split, the LP arm is coded against current main (relaxation plan + verbatim
   assumption + prominent warning; `renderLpModel` rejections surface as
   `NL_RENDER_INVALID` 422s). Additive metadata/codes the nl-model lane gains later
   (e.g. exact-integer restrictions) flow through the same defensive rendering and
   WorkflowError → 422 mapping; alignment happens at integration.
5. One IAB full-page capture glitch (duplicated content) occurred on the model-review
   screenshot; viewport captures were used instead (known V5-b gap #5 recurrence).
