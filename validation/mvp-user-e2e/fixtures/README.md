# mvp-user-e2e fixtures (issue #186 preparation, r0 @ 33bd3d0)

Real-user E2E fixtures. All expectations are OUTCOME CLASSES; nothing here fabricates
solver internals. Live execution happens next round on the trusted Debian host
(`cc@192.168.100.200`, portable bundle `/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64`)
after V1–V5 merge.

## Files

| file | role |
| --- | --- |
| `scenario-a.smt2` | deterministic UNSAT QF_LIA (`x,y∈[0,1]`, `x+y>=4`); z3 and cvc5 must both answer `unsat` → `AGREE_UNSAT` |
| `scenario-a-sat.smt2` | SAT variant (`x+y>=2`); witness `x=1,y=1` → `AGREE_SAT` |
| `scenario-b-lp.json` | feasible LP, exact shape for `validateHighsModel` (tool-portfolio-t4): max 3x+2y, x+y≤4, x≤3, x,y≥0 → `kOptimal`, objective **11** (hand-derived; offline proof: primal vertex (3,1) + dual certificate u=2,v=1) |
| `scenario-b-infeasible.json` | x+y≤1 with x≥2, y≥0 → `kInfeasible` |
| `user-prompt-a.txt` / `user-prompt-b.txt` | natural-language user requests; input for the real DeepSeek planning path next round |
| `negatives/*.plan.json` | plans conforming to the pinned `formal-tools/execution-plan/1.0` shape that must fail closed (`PLAN_UNKNOWN_TOOL`, `PLAN_HASH_MISMATCH`, `TIMEOUT_BUDGET`) |
| `negatives/malformed.smt2` | unbalanced paren → `PARSE_ERROR` fail-closed |
| `expected-relation.json`, `negatives/expected-relation.json` | scenario → expected outcome class tables |

## Hash conventions (binding for all plan fixtures here)

- **Canonical hash rule** (pinned, for JSON values incl. `plan_sha256` and JSON step
  inputs): `sha256(JSON.stringify(sorted))` — recursively sort object keys, no
  whitespace. Implemented in `harness/lib.mjs` (`canonicalJsonSha256`).
- **Text inputs** (`.smt2`): `input_sha256` = sha256 of the raw file bytes.
- **JSON inputs** (LP models): `input_sha256` = canonical JSON hash of the parsed model.
  Note: `runPortfolioOperation` computes its own hash over its normalized model at run
  time; receipt-level comparison across entries uses outcome classes, not this hash.
- `compiled.launcher_sha256` / `compiled.manifest_sha256` in the negative plans carry
  the format-conformant placeholder `e3b0c442…b855` (sha256 of empty string); real
  values are planner-owned and only exist after the V4-b workflow planner lands.

## Harness budget policy (harness-side r0 pre-check, refined after V4-b)

`max_steps ≤ 16`, `max_total_timeout_s ≤ 300`, `max_step_timeout_s ≤ 120`.
Plans exceeding these are classified `TIMEOUT_BUDGET` before any launch.

## Outcome class enum (closed)

`AGREE_UNSAT`, `AGREE_SAT`, `K_OPTIMAL_OBJECTIVE_<n>`, `K_INFEASIBLE`, `K_UNBOUNDED`,
`PARSE_ERROR`, `PLAN_UNKNOWN_TOOL`, `PLAN_HASH_MISMATCH`, `TIMEOUT_BUDGET`,
`PLAN_SCHEMA_INVALID`, `PROVIDER_BLOCKED`, `SKIP_NOT_WIRED`, `NOT_REGISTERED_YET`,
`SKIP_WEB_NOT_RUNNING`, `FAIL_CLOSED_OTHER`.
