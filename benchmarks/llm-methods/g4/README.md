# xDownload Interaction G4 — engineering-only dual-solver evidence

This fixture models the bounded state contract of the exact xDownload Interaction source pinned in PAIR.json. Five separate SMT-LIB inputs each contain exactly one check-sat, so both registered typed Native Runner operations can execute them without solver-specific incremental flags.

- Valid input can reach AWAITING_CONFIRMATION and READY_FOR_KDP after explicit confirmation.
- Unconfirmed input cannot reach READY_FOR_KDP.
- Invalid channel, request ID, URL or byte size cannot reach READY_FOR_KDP.
- Undeclared answers and a forged draft-ready status cannot bypass revalidation.
- Neither effect dispatch nor effect permission is reachable.

Z3 5.4.0 and cvc5 1.4.2 were executed using exact archive and executable SHA-256 pins already recorded by the G3 native pair. The initial pair and a separately timestamped rerun each contain five cases and ten native invocations. The rerun was executed on Debian GNU/Linux 13 (trixie), x86_64, glibc 2.41. All ten rerun invocations exited 0 with empty stderr; pair agreement was 5/5 (1 SAT, 4 UNSAT). The per-invocation raw stdout and empty-stderr artifact are retained under `validation/xdownload-interaction-2026-11-16/rerun-20261116T123757Z/`.

`EVIDENCE_INDEX.json` binds the initial pair and the independent rerun. `PROVENANCE.json.evidence_sha256` binds the index, rather than only one run. The Candidate regression verifies both evidence packs, every stdout/stderr digest, and the unchanged fail-closed qualification state.

The earlier single-file push/pop prototype caused cvc5 exit 1 because the command omitted --incremental. That invocation error was not a solver failure. The final Method uses one check-sat per file and the existing typed solve operation.

## Strict scope

This is a bounded Boolean abstraction and cross-solver engineering check, not a proof that the abstraction is semantically complete with respect to JavaScript, not an independently attested business Oracle, not trusted Host/process attestation, and not a qualified Solution. PROVENANCE.json deliberately remains BYTES_BOUND_UNATTESTED; G4 qualification anchors remain NOT_CONFIGURED; positive Solution Replay and business Claim promotion remain BLOCKED. The actual DIS consumer is tracked separately in domain-harness#1512 and remains gated by exact-head CI failure triage.
