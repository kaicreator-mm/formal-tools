# I4 R0 — real Linux engine-host runtime gate receipts (2026-11-13)

Scope: kaicreator-mm/formal-tools#4 only — original 13 tool families, 26 committed
fixtures, JS/TS CLI + SDK + MCP runtime contracts. Portfolio #24 owns the 23-tool
expansion; Product #11 owns Source/Oracle/Solution. Closed #7/#14 untouched.

## Exact-SHA binding

| Item | Value |
| --- | --- |
| Receipt source checkout | `5d8a10e3fdb4db0d36d224706f86cbba4efb07ec` (`source_identity.status=CLEAN`) |
| Canonical native assets | CC-LAN200 portable deb13 bundle (`#24` catalog), `out/packages/SHA256SUMS` sha256 `5daad69d51c5adff9dd2406937b2ca18ba460153793cc7cb9848d53767a202bc` |
| Host | Debian-bundle-compatible Linux x86_64, user `uid=1000(cc)` non-root, node `v22.16.0` (bundle runtime), Java 21.0.13 (bundle runtime) |
| Runner | `scripts/native-acceptance.mjs` (schema `formal-native-local-acceptance/1.3`), drivers under `drivers/` |

Fix commits leading to the receipt SHA (single Writer, ADS #1359):
`8f72b12` privacy scan scoped to metadata (P1: scan aborted every real-engine receipt) →
`449f605` CLI exec bit canonical (P1: `npm ci` workspace bin chmod left checkout DIRTY) →
`01789b2` Jena fixtures valid http IRIs (P1: Jena 5.x rejects `<urn:a>` at parse time) →
`81b1445` + `c8dc339` + `5d8a10e` gate driver determinism fixes.

## Harness recipe (reproducible)

1. `git bundle` of the branch → clean clone on the host → verify `HEAD` + clean status
   **before and after** `npm ci` (both printed `CLEAN_*` in the deploy log).
2. Neutral staging root `/tmp/fti4`: symlink farm `bin/` → canonical bundle executables,
   `tla2tools.jar`, `alloy.jar`, `python3` (bundle python313, `pyshacl` importable),
   `TMPDIR=/tmp/fti4/tmp`; env `FORMAL_TOOLS_BIN_DIR`, `TLA2TOOLS_JAR`,
   `FORMAL_ALLOY_JAR`, `FORMAL_PYSHACL_PYTHON`, `FORMAL_CLINGO_PYTHON`.
   Symlinks resolve to the real bundle files; `binaryIdentity()` hashes the real bytes.
3. `node scripts/native-acceptance.mjs /tmp/fti4/evidence/acceptance`
4. `drivers/sdk-driver.mjs` → `sdk/sdk-events.ndjson`
5. `drivers/mcp-driver.mjs` → `mcp/mcp-events.ndjson`
6. `drivers/cli-driver.sh` → `cli/` (43 commands, per-command raw logs + ndjson with
   per-log sha256 and true exit codes)
7. `isolation.txt`: uid/umask, root-owned bundle write-denial probe, canonical
   `SHA256SUMS` anchor.

## Result: 12/13 CANDIDATE_FOR_REVIEW, 1/13 INCONCLUSIVE

| Tool | Version observed | pos/neg fixture verdicts | Executable sha256 (head) |
| --- | --- | --- | --- |
| lean4 | 4.35.0 | PROVED+REJECTED both PASS | `bf8d54e4714cc4b0` |
| z3 | 5.4.0 | UNSAT+SAT both PASS | `e9d7e6e6d76c81b5` |
| cvc5 | 1.4.2 | UNSAT+SAT both PASS | `6aecddf466552b83` |
| tla-tlc | TLC2 2026.11.06 (tla2tools.jar `e1f11b75…`) | MODEL_CHECKED+INVARIANT_VIOLATED both PASS | java `7afc28801f744050` |
| apalache | 0.63.0 | NO_ERROR+ERROR_FOUND both PASS | `f8d4643705369d06` |
| alloy | 6.2.0 dispatcher (jar `6b8c1cb5…`) | UNSAT+SAT both PASS | java `7afc28801f744050` |
| souffle | 2.5 | ACYCLIC+CYCLIC both PASS | `28b6284150aae6c7` |
| rdf-shacl | pySHACL 0.40.2 (bundle python3.13) | TRUE+FALSE both PASS | python3 `bc1eac3518b3af71` |
| vampire | 5.1.0 | THEOREM+COUNTER_SATISFIABLE both PASS | `1bc3c598494d790f` |
| apache-jena | 5.5.0 | QUERY_MATCH+INVALID_TURTLE both PASS | riot `853c14708260512f` |
| prob | 1.16.1-final | NO_COUNTEREXAMPLE+INVARIANT_VIOLATION both PASS | `029d38ba5b8ffbc8` |
| dafny | 4.11.0 | VERIFIED+REFUTED both PASS | `e540b4826363afb8` |
| clingo | 5.8.3 binary present; **python-module runtime not provisioned in the canonical bundle** | pos/neg INCONCLUSIVE (`No module named clingo`) — honest BLOCK, not PASS | (interpreter only) |

Extra error/UNKNOWN cases (z3, cvc5 per script scope): `error_input` produced a real
parser error line (exit 1, never a sat/unsat verdict); `unknown_scope` hit the bounded
20s timeout (distinct TIMEOUT outcome) — both visibly different from PASS.

## Gate surfaces

- **CLI** (`cli/cli-events.ndjson`): 43 commands, 0 failures — `validate`,
  `doctor-all` search+probe (13/13 EXECUTED), 13 per-tool `doctor` probes, 12 typed
  `exec` with version-dependent flags (`z3 -T:10`, `cvc5 --produce-models --tlimit=10000`,
  `vampire --mode casc`, TLC `-workers 2 -config`, apalache `--length/--init/--next/--inv`,
  alloy `-c 0`, souffle `-D`, ProB bounded `-mc`, jena `--data/--query`, dafny `verify`,
  pyshacl `-f/-s`, lean `check`), 6 `native-help` probes, 6 fail-closed error paths
  (all exit 2 + ERROR JSON), pure JS engines, tracked-tree cleanliness (`git status
  --porcelain --untracked-files=no` empty after all runs).
- **SDK staged** (`sdk/sdk-events.ndjson`): 10/10 PASS — staged success with hashed
  generated artifacts (souffle CSVs, per-file sha256+bytes), z3 UNSAT semantics,
  invalid-model error path (NONZERO_EXIT, UNPARSED), deterministic TIMEOUT with
  `artifacts.status=PARTIAL` + `PROCESS_INCOMPLETE` skip, option parent-traversal /
  absolute-path / input-manifest-traversal / unstaged-file-option denials (TypeError
  fail-closed), missing-engine `NOT_STARTED`+`INCONCLUSIVE`, raw pass-through denied.
- **MCP stdio** (`mcp/mcp-events.ndjson`): real JSON-RPC handshake (protocol
  `2025-06-18`, SDK 2.4.0), 9-tool fixed set (no raw argv/shell surface), installed
  z3 probe EXECUTED, installed fixture run PASS with input hashes, `plan_native_cli`
  accepts valid typed plan and rejects unknown operation + invalid enum as MCP errors,
  pure engine PASS, unknown tool id denied, server exits 0 on stdio close.
- **Permissions/isolation** (`isolation.txt`): non-root uid 1000, root-owned bundle
  binaries (write probe denied), runner outputs confined to private mkdtemp workspaces,
  tracked tree untouched, metadata path redaction verified, hostname REDACTED.

## Disclosure notes

- Raw `cli/cmd-*.log` files are captured verbatim (per-log sha256 pinned in
  `cli-events.ndjson`, do not edit); engines may echo the documented canonical bundle
  path (`jar:file:/home/cc/formal-tools-build/...` via JVM `-cp` realpath through the
  staging symlink) — this layout is already public in #24 and is not operator-private.
  The hash-anchored acceptance receipt (`acceptance/native-acceptance.json`) has
  **metadata fully redacted** (hostname REDACTED, zero absolute paths outside stream
  texts); its verbatim `stdout`/`stderr` stream texts retain 17 neutral staging paths
  (`/tmp/fti4/...`) and no operator-home paths.
- `clingo` python-module runtime is a genuine asset gap in the canonical bundle
  (`tools/clingo` ships only the 5.8.3 binary). Recorded INCONCLUSIVE per the #4
  working policy; provisioning a canonical clingo wheel is a #24 asset task, not a
  runtime-gate blocker for the other 12 families.
- Run identity inside the event logs: both event files are append-logs across the
  deterministic-fix iterations. `sdk/sdk-events.ndjson` holds 3 runs — `81b1445`
  (8/10, two harness-case FAILs kept as the documented fix history), `c8dc339`
  (10/10) and the accepted final run `5d8a10e3fdb4db0d36d224706f86cbba4efb07ec`
  (10/10), identified by its `driver_identity.checkout` pin. `mcp/mcp-events.ndjson`
  holds 2 clean runs (`c8dc339`, then the accepted final at `5d8a10e` — last
  `driver_done` in append order, no FAIL lines at any point).
