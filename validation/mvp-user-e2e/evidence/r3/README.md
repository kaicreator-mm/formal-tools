# R3 E2E acceptance evidence (i180 R3 final validation)

OUTPUT_LABEL=**FORMAL_TOOLS_I180_R3_E2E_VALIDATION** · branch `i180/r3-e2e`
(stacked on `i180/r3-web-nl`) · **EXACT_HEAD 7eec0f25d067665ad2b68bca275a53c2ea1c25b2**
(the merged Web+NL-model stack: A's web seam @0ef452d + B's nl-model semantics
58dd77e1, CI #2220/#2221 green).

Produced by the R3 **non-Writer** E2E validator (subagent D; authored none of
the lanes A/B/C under validation). All live journeys ran on CC-LAN200
(192.168.100.200) Docker container(s) with the portable bundle's own node
v22.16.0 and the REAL tools: **DeepSeek deepseek-chat** (API key from the
validator's environment, transferred via stdin into a `0600` env file,
sourced by the server process, file deleted at startup — never logged,
never committed), **z3 5.4.0 + cvc5 1.4.2** (cross-checked), **HiGHS 1.15.1
(highspy / Python 3.13.5 / numpy 2.5.4)**. The apps/web bridge + UI at the
EXACT_HEAD were driven over an SSH loopback tunnel from a real browser
(agent-surrogate user); every receipt names its environment and the pinned
`formal_portable_root_sha`.

## Environments (exactly what ran where)

| server | container / bundle | runner sha (pinned) | NL provider | used by |
| --- | --- | --- | --- | --- |
| 127.0.0.1:8790 (Windows loopback, tunneled) | `formal-tools-ssh` (deb13-r0) `/home/cc/formal-tools` | `0db55eab9c1b…` (C's launcher-validation pin) | **REAL deepseek** (env key) | S1, S3 |
| 127.0.0.1:8791 | `formal-tools-ssh` (deb13-r0) | `0db55eab9c1b…` | deterministic stub via the bridge's `nlProviderImpl` test seam | S2, S5(a), S4 |
| 127.0.0.1:8792 | throwaway `ft-r3-e2e-lp2` (deb13-r1) + read-only bind-mount of the repo-canonical highs op script (see s5 forensics) | `020f8f5ed428…` (R2's pin) | same stub | S5(b) |

The z3/cvc5 S1 journey runs on deb13-r0 exactly as C's launcher validation did
(same bundle, same runner pin). The HiGHS journey needed the deb13-r1 bundle:
both published images carry a highs drift (details + full forensics:
`s5-lp-relaxation/00-bundle-drift-defect.md` — recorded as a P2 environment
defect; the engine's honest fail-closed is itself verified evidence).

## Scenarios and labels

| scenario | verdict | labels | evidence |
| --- | --- | --- | --- |
| S1 P0 main journey: new Chinese bounded-integer sat text -> REAL DeepSeek propose -> 12/12 line-by-line review checklist -> structured edit (b upper 9->4) + server-side re-validation/re-render -> explicit approve -> hash-bound ExecutionPlan -> REAL z3+cvc5 cross-check | PASS | REAL_LLM · SURROGATE_APPROVED · REAL_SOLVER | `s1-main-journey/` (proposal review dump, checklist, post-edit SMT `(<= b 4)`, approved plan JSON, results dump `AGREE_SAT`/`PASS`, screenshot, receipts + manifest + `sat` stdout logs, all hash-verified) |
| S2 rejection: propose -> click Reject (terminal) | PASS | MOCK_PROVIDER · SURROGATE_APPROVED | `s2-rejection/` (REJECTED banner screenshots, `USER_REJECTED` record with no plan, API mirror record) |
| S3 NEEDS_CLARIFICATION: vague Chinese text -> REAL DeepSeek | PASS | REAL_LLM | `s3-needs-clarification/` (4 clarification questions rendered, model review never shown, "nothing was rendered or planned") |
| S4 approval-binding tamper: planA+approvalB / mutated planA+approvalA / unknown binding -> all refused pre-execution; positive control (planA+approvalA) runs | PASS | MOCK_PROVIDER · REAL_SOLVER (control) | `s4-tamper/` (`NL_PLAN_APPROVAL_MISMATCH` x2, `NL_APPROVAL_UNKNOWN`, control `AGREE_SAT` receipt with `verified:true` binding) |
| S5 LP gate: (a) optimize approved WITHOUT ack -> restricted record, no plan; (b) with ack -> REAL HiGHS -> LP_RELAXATION_ONLY, objective 2.5 (integer optimum 2 — never conflated) | PASS (with P2 env defect recorded) | (a) MOCK_PROVIDER (b) MOCK_PROVIDER · REAL_SOLVER · SURROGATE_APPROVED | `s5-lp-relaxation/` (restricted-record screenshot, plan LP banner screenshot, results screenshot, receipts, forensics note) |
| S6 offline suites at EXACT_HEAD (Windows): `node --test tests/nl-model.test.mjs tests/workflow-user-e2e.test.mjs` + `node --test apps/web-tests/api.test.mjs apps/web-tests/nl.test.mjs` | PASS 33 + 37(33 pass + 4 optional live re-runs skipped) + 60, 0 fail | OFFLINE | transcript in the issue receipt comment |

REAL DeepSeek budget: **2 calls** (S1 propose; S3 propose) — within the <=4 cap.
All driver-driven approvals are labeled SURROGATE_APPROVED (never claimed as a
real human approval).

## Layout

* `drivers/mock-provider-server.mjs` — MOCK_PROVIDER bridge launcher (the
  documented `nlProviderImpl` test seam; everything downstream of the stub reply
  is the REAL server code path).
* `drivers/s4-tamper-flow.mjs`, `drivers/s5-r1-api-mirror.mjs` — the API-level
  journey drivers (run against a tunneled bridge; not in the CI glob).
* `s1-main-journey/`, `s2-rejection/`, `s3-needs-clarification/`,
  `s4-tamper/`, `s5-lp-relaxation/` — per-scenario artifacts.
* `launcher-external-cwd/` — verbatim copy of integrator subagent C's launcher
  externalization receipts (`i180-r2-launcher-ext-2026-11-20`), see the
  provenance note inside.
* `SHA256SUMS` — pins every file in this directory tree; re-verified offline by
  `tests/e2e-r3-nl-web.test.mjs`.
