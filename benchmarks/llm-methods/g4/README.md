# xDownload Interaction G4 — engineering-only dual-solver evidence

This fixture models the bounded state contract of the exact xDownload Interaction source pinned in PAIR.json:

- valid complete input -> AWAITING_CONFIRMATION;
- valid, re-evaluated input plus allowlisted answers and explicit confirmation -> READY_FOR_KDP;
- invalid URL/size, unconfirmed input, undeclared answers, and a forged draft-ready status cannot yield READY_FOR_KDP;
- effectDispatched and permittedEffect remain false.

Z3 5.4.0 and cvc5 1.4.2 were executed in the Debian 13 x86_64 container using the exact tool archive and executable SHA-256 values already recorded by the G3 native pair. Both solvers returned the same 9-status sequence (2 SAT, 7 UNSAT), exit 0, empty stderr. Raw stdout/stderr and exact hashes are retained.

The first cvc5 invocation omitted --incremental while using SMT-LIB push/pop; it exited 1 with an invocation error. The command was corrected and executed once successfully. This is a runner invocation correction, not a solver failure.

## Strict scope

This is a bounded Boolean abstraction and a cross-solver engineering check. It is not a proof that the abstraction is semantically complete with respect to JavaScript, not an independently attested business Oracle, not a trusted Host/process attestation, and not a qualified Solution. PROVENANCE.json deliberately remains BYTES_BOUND_UNATTESTED; G4 qualification anchors remain NOT_CONFIGURED; positive Solution Replay and business Claim promotion remain BLOCKED. The actual DIS consumer is tracked separately in domain-harness#1512 and is still gated by its exact-head native CI failure triage.
