# Verification and evidence protocol

`record` minimal JSON keys: `claim_id, project, git_head, input_sha256, assumptions, formal_property, tool, version, argv, timeout_s, environment, exit_code, stdout_sha256, stderr_sha256, expected, observed, status, bounded_scope, source_provenance, operator_notes`.

A tool must be independently launched. File-existence, a successful prompt, a planned command or exit code alone is insufficient. Perform one positive test and one mutation/negative test per engine before marking runtime verified. Save exact inputs alongside receipts.

Statuses: `PASS` (expected property confirmed in stated scope); `COUNTEREXAMPLE` (a concrete model/trace violates property); `UNKNOWN` (timeout, resource or inconclusive proof search); `ERROR` (unsupported, parse, dependency, execution failure); `NOT_RUN` (no executable runtime). In cross-checking, record solver disagreement separately rather than forcing a consensus.

Evidence gate for skills: `SOURCE_REVIEWED` (docs read), `STATIC_VALIDATED` (syntax and examples reviewed), `RUNTIME_SMOKE_VERIFIED` (actual binary), `MUTATION_VERIFIED` (detects injected error), `PROJECT_CONSUMER_VERIFIED` (ADS/DKE/DIS realistic case). Independently prove/validate each gate; one gate does not imply the next.

For ADS: express role/Task/DAG/write-set constraints explicitly and ensure a failing counterexample represents a truly prohibited execution. For DIS: link Function contracts, knowledge semantics and Evidence obligations. For DKE: test decomposition, closure, recursive depth, conflicting defaults and incremental evolution. All are *model-specific*, not universal acceptance stamps.
