# xDownload Interaction G4 — engineering-only dual-solver evidence

This fixture models the bounded state contract of the exact xDownload Interaction source pinned in PAIR.json. Five separate SMT-LIB inputs each contain exactly one check-sat, so both registered typed Native Runner operations can execute them without solver-specific incremental flags.

- Valid input can reach AWAITING_CONFIRMATION and READY_FOR_KDP after explicit confirmation.
- Unconfirmed input cannot reach READY_FOR_KDP.
- Invalid channel, request ID, URL or byte size cannot reach READY_FOR_KDP.
- Undeclared answers and a forged draft-ready status cannot bypass revalidation.
- Neither effect dispatch nor effect permission is reachable.

Z3 5.4.0 and cvc5 1.4.2 were executed in the Debian 13 x86_64 container using exact archive and executable SHA-256 values already recorded by the G3 native pair. Both solvers returned the same five-case sequence (1 SAT, 4 UNSAT), each exit 0 with empty stderr. Per-case raw stdout/stderr and hashes are retained in PAIR.json.

The earlier single-file push/pop prototype caused cvc5 exit 1 because the command omitted --incremental. That invocation error was not a solver failure. The final Method avoids this CLI mismatch by using one check-sat per file and the existing typed solve operation.

## Strict scope

This is a bounded Boolean abstraction and cross-solver engineering check, not a proof that the abstraction is semantically complete with respect to JavaScript, not an independently attested business Oracle, not trusted Host/process attestation, and not a qualified Solution. PROVENANCE.json deliberately remains BYTES_BOUND_UNATTESTED; G4 qualification anchors remain NOT_CONFIGURED; positive Solution Replay and business Claim promotion remain BLOCKED. The actual DIS consumer is tracked separately in domain-harness#1512 and remains gated by exact-head native CI failure triage.
