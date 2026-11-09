# Pure JS model fixtures

Eight explicit finite models for actual JS-only verification. These are simplified examples, **not** project-grade proofs of ADS/DKE/DIS. Each file is JSON with a clearly expected outcome:

- `dag-positive.json` → `ACYCLIC`
- `dag-negative.json` → `CYCLE_FOUND`
- `writers-positive.json` → `EXCLUSIVE`
- `writers-negative.json` → `WRITE_CONFLICT`
- `cnf-sat.json` → `SAT`
- `cnf-unsat.json` → `UNSAT`
- `states-positive.json` → `SAFE_FINITE`
- `states-negative.json` → `INVARIANT_VIOLATED`

Execute in Node via `node packages/runner/js/cli.mjs pure dag --input validation/js/dag-positive.json`; or load `packages/core/src/finite.mjs` into any supported JS evaluator. Negative examples are expected observations, not test-suite failures.
