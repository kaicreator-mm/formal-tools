# Changelog

This changelog describes **consumer-facing formal-tools releases**, not historical development-branch version numbers.

## [0.0.1] — pending final #180 integration and release tag

First bounded MVP intended for other applications:

- Unified capability discovery / diagnostics for the registered 36 tools; existing native checks are fixture-scoped.
- One typed, hash-bound DAG execution contract shared by trusted-host CLI, MCP and JS SDK, with native Z3/cvc5 SMT execution, cross-checking and a typed HiGHS LP operation.
- Inspectable deterministic execution plan/launcher, bounded budgets, distinct execution/solver/claim verdicts, and hash-linked receipts and evidence.
- Bounded local Web UI for natural-language constraint-model proposal, user edits, explicit approval/rejection, execution status and evidence.
- Fail-closed behavior for unknown operations, unavailable providers/binaries, mismatched plan or approval bindings and unsupported exact-integer optimization.
- Documentation for consumer installation, integration and supported/unsupported use.

### Release qualification

The above is the **target** scope, not a declaration that it has shipped on `main`. Publish `v0.0.1` only after #180 required PRs are merged, scoped reviews and final Exact-SHA CI pass, and at least one current-main end-to-end real-host receipt is recorded. See [release checklist](docs/releases/v0.0.1.md).

### Explicit exclusions

- No universal natural-language semantic equivalence or domain-business correctness guarantee.
- No claim that all 36 registry entries support arbitrary user-supplied operations.
- No mixed-integer optimum from the continuous HiGHS LP relaxation.
- No public multi-tenant HTTP service, general shell execution, npm package publication or dependency on domain-harness.

