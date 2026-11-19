# Provenance — launcher-external-cwd/

Verbatim copy of integrator subagent C's launcher externalization validation
receipts, directory `i180-r2-launcher-ext-2026-11-20/` (validated 2026-11-20),
copied byte-for-byte into the R3 E2E evidence by validator D.

* What C validated: the compiled-launcher external-cwd chain (PR #198 stack)
  at `cf0e16d8fd603430d5941bc399229c6b32511b7b` (on top of PR #197 @
  `770c06065ebc11279d62c0b9d38219f2dabe8791`) — negative windows on Windows
  (BLOCKED / NOT_COMPILED_FOR_EXECUTION / RUNNER_ROOT_INVALID, exit code 2)
  and the positive REAL-solver run inside the trusted container
  (formal-tools:deb13-r0 on cc@192.168.100.200, node v22.16.0 from the
  bundle, `FORMAL_PORTABLE_ROOT=/home/cc/formal-tools`,
  `FORMAL_PORTABLE_RUNNER_SHA256=0db55eab9c1b1006289030203e97002d89a61e37b9756697070e7a9470212e17`):
  z3 5.4.0 + cvc5 1.4.2, `AGREE_UNSAT`, claim PASS, all artifact hashes verified.
* `validation-log.json` carries C's exact commands and exit codes.
* `launcher.mjs` is the external launcher C used; `pass.execution-receipt.json`
  / `blocked-win-nosolver.execution-receipt.json` are the two retained receipts;
  `artifacts/` holds the workspace receipt+manifest+logs of the positive run.
* No bytes were modified in the copy. The R3 validator reused C's pinned
  container recipe verbatim for the S1 z3+cvc5 journey (server on 8790 runs
  with the same `FORMAL_PORTABLE_ROOT` + runner sha).
* These receipts pin the i180/r2-launcher stack (cf0e16d8), NOT the R3 head;
  they are included because the R3 brief names them as the solver-environment
  reference for the container execution chain.
