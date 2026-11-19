# mvp-user-e2e fixtures (issue #186; V6 live resync @ 646859f)

Real-user E2E fixtures. All expectations are OUTCOME CLASSES; nothing here fabricates
solver internals. The live execution has run on the trusted Debian host
(`cc@192.168.100.200`, portable bundle `/home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64`,
z3 5.4.0 / cvc5 1.4.2 / HiGHS 1.15.1) — receipts live under `../evidence/live-*`.

## Files

| file | role |
| --- | --- |
| `scenario-a.smt2` | deterministic UNSAT QF_LIA (`x,y∈[0,1]`, `x+y>=4`); z3 and cvc5 must both answer `unsat` → `AGREE_UNSAT` |
| `scenario-a-sat.smt2` | SAT variant (`x+y>=2`); witness `x=1,y=1` → `AGREE_SAT` |
| `scenario-b-lp.json` | feasible LP, exact shape for `validateHighsModel` (tool-portfolio-t4): max 3x+2y, x+y≤4, x≤3, x,y≥0 → `kOptimal`, objective **11** (hand-derived; offline proof: primal vertex (3,1) + dual certificate u=2,v=1) |
| `scenario-b-infeasible.json` | x+y≤1 with x≥2, y≥0 → `kInfeasible` |
| `user-prompt-a.txt` / `user-prompt-b.txt` | natural-language user requests; input for the real DeepSeek planning path next round |
| `negatives/*.plan.json` | V3-shaped plans (typed `{smt_lib}` inputs, canonical-JSON input hashes, null compiled hashes) that must fail closed (`PLAN_UNKNOWN_TOOL`, `PLAN_HASH_MISMATCH`, `TIMEOUT_BUDGET`) |
| `negatives/malformed.smt2` | unbalanced paren → `PARSE_ERROR` fail-closed |
| `expected-relation.json`, `negatives/expected-relation.json` | scenario → expected outcome class tables |

## Hash conventions (binding for all plan fixtures here)

- **Canonical hash rule** (pinned, for JSON values incl. `plan_sha256` and JSON step
  inputs): `sha256(JSON.stringify(sorted))` — recursively sort object keys, no
  whitespace. Implemented in `harness/lib.mjs` (`canonicalJsonSha256`).
- **Plan step inputs** (V3 contract): inputs travel inline in the plan as typed objects (`{smt_lib}`, LP model, compare operands); `input_sha256` = canonical JSON hash of that object. `.smt2` raw-byte hashes are used only for `source.problem_sha256` bookkeeping.
- **JSON inputs** (LP models): `input_sha256` = canonical JSON hash of the parsed model.
  Note: `runPortfolioOperation` computes its own hash over its normalized model at run
  time; receipt-level comparison across entries uses outcome classes, not this hash.
- `compiled.launcher_sha256` / `compiled.manifest_sha256` in the negative plans are
  `null` (the honest un-compiled state; the real planner/executor contract admits
  null or 64-hex).

## Harness budget policy (resynced to the frozen V2 CAPS @ 646859f)

`max_steps ≤ 8`, `max_total_timeout_s ≤ 120`, `max_step_timeout_s ≤ 120`.
Plans exceeding these are classified `TIMEOUT_BUDGET` before any launch.

## Outcome class enum (closed)

`AGREE_UNSAT`, `AGREE_SAT`, `K_OPTIMAL_OBJECTIVE_<n>`, `K_INFEASIBLE`, `K_UNBOUNDED`,
`PARSE_ERROR`, `PLAN_UNKNOWN_TOOL`, `PLAN_HASH_MISMATCH`, `TIMEOUT_BUDGET`,
`PLAN_SCHEMA_INVALID`, `PROVIDER_BLOCKED`, `SKIP_NOT_WIRED`, `NOT_REGISTERED_YET`,
`SKIP_WEB_NOT_RUNNING`, `FAIL_CLOSED_OTHER`.
