# I31 R0 — Clingo 5.8.3 native-runtime successor receipts (2026-11-14)

Scope: the tool-specific T4 lane of issue #31 (clingo), recorded as the
**successor to the #4 closeout clingo exception** — #4's historical 12/13
closeout receipt stays immutable; no rerun of the other 12 engines or the 23
portfolio-expansion tools. Coordinator #24; product authority #11 (unchanged);
closed #7/#14 untouched.

## Resolution path (issue #31 minimum-delivery item 1)

**Preferred path taken:** reuse the already-verified official native `clingo`
binary from the #24 canonical deb13 bundle via a narrowly scoped, explicit,
pinned binary-launcher adapter (`FORMAL_CLINGO_BIN`). Zero new binaries, no
Python wheel provisioning. The default launcher remains the explicitly
configured Python module (`FORMAL_CLINGO_PYTHON`, `python3 -m clingo`): with no
wheel present in the canonical bundle that lane fails honestly
(NOT_STARTED/NONZERO_EXIT + INCONCLUSIVE, asserted in the SDK driver) — no
implicit binary≡module equivalence is claimed or relied upon.

## Exact-SHA binding

| Item | Value |
| --- | --- |
| Receipt source checkout | `eb7e669e5a0a05b9123a99dd5748dd1d96b551e8` (PR branch `task/ft-i31-clingo-zcode`, PR #76) — **last product-code commit**; every later commit on the branch (7e6e87f receipts/docs, c939fbc driver-label fix) touches only `validation/` |
| Gate-B re-run note | after the independent review's P2 receipt-labeling fix, gate B was re-run at `c939fbc7f7b4e570658ca0711633b736494077f8` in the same canonical container (fails 0 / 28 commands, corrected enum/range cases now hit `invalid enum opt` / `invalid number for models` / `invalid number for time`); gates A/A′/C/D receipts remain from the coherent eb7e669 run — product code is byte-identical across all three SHAs |
| Canonical binary | `clingo 5.8.3` official native executable, sha256 `d6250068a6cb2c931f952f5554f7aa3a07491975c10832b577be322f8371ad41`, 385144 bytes |
| Canonical bundle anchor | `out/packages/SHA256SUMS` sha256 `5daad69d51c5adff9dd2406937b2ca18ba460153793cc7cb9848d53767a202bc` (#24 catalog, unchanged) |
| Canonical runtime env | Docker image `formal-tools:deb13-r0` — Debian **13.7 (trixie)** + full 36-tool bundle at `/opt/formal-tools-portable-debian13-x86_64`, `--network none` (offline), `--user 1000:1000` (non-root), bundle node `v22.16.0`, bundle write-denied |
| Git-anchored repeat | Same clone + same binary on the bundle host (has git): `source_identity CLEAN @ eb7e669…` — the canonical image ships no git, so its own receipt records `source_identity UNVERIFIED` honestly; the authoritative checkout identity is `receipts/host-identity.txt` (HEAD + tracked-clean checked **before and after** the whole run) |
| Runner | `scripts/native-acceptance.mjs` schema `formal-native-local-acceptance/1.3` + three committed drivers under `drivers/` |

## Harness recipe (reproducible)

1. `git bundle` of the PR branch → clean clone on the bundle host → verify HEAD
   and tracked-clean **before** `npm ci` (registry: local pull-through cache)
   and **after** the whole run (`receipts/host-identity.txt`).
2. Run in the canonical container, receipts written **outside** the clone:

   ```
   docker run --rm --network none --user 1000:1000 \
     -v <clone>:/work/ft -v <receipts>:/work/receipts -w /work/ft \
     -e FORMAL_CLINGO_BIN=/opt/formal-tools-portable-debian13-x86_64/tools/clingo/bin/clingo \
     -e LD_LIBRARY_PATH=/opt/formal-tools-portable-debian13-x86_64/tools/clingo/lib \
     -e FT_NODE=/opt/formal-tools-portable-debian13-x86_64/runtimes/node22/bin/node \
     -e FT_EXPECTED_HEAD=eb7e669e5a0a05b9123a99dd5748dd1d96b551e8 \
     formal-tools:deb13-r0 bash -c '<gates>'
   ```

   `LD_LIBRARY_PATH` mirrors the bundle's own generated `tools/clingo/run`
   shim (the binary's RUNPATH `$ORIGIN/../lib` covers only its direct deps;
   `libclingo.so.4` needs `libexpat`/`libz` from the bundle `lib/`). This is
   the canonical bundle's documented launch configuration, not a JS-layer
   search path.
3. Gates: `native-acceptance.mjs … clingo` (A), `drivers/clingo-cli-driver.sh`
   (B), `drivers/clingo-sdk-driver.mjs` (C), `drivers/clingo-mcp-driver.mjs` (D).
4. Host-side gate A repeat for the git-anchored `CLEAN` source identity (same
   clone, same canonical binary sha256) + post-run tree check.

## Results — all gates green at `eb7e669…` (single coherent run)

| Gate | Result | Evidence |
| --- | --- | --- |
| A: native acceptance (canonical container) | clingo **CANDIDATE_FOR_REVIEW** (candidate 1 / blocked 0): doctor EXECUTED (`clingo version 5.8.3`), installation FOUND_NOT_PROBED launcher `clingo-bin`, binary+dependency identity sha256 `d6250068…`, positive SATISFIABLE **exit 30** PASS (2 answers, all-model enumeration `0`), negative UNSATISFIABLE **exit 20** PASS | `receipts/acceptance/native-acceptance.json` |
| A′: git-anchored repeat (host) | **CLEAN @ `eb7e669…`**, same verdicts, same binary sha | `receipts/acceptance-host/native-acceptance.json` |
| B: CLI (28 commands, 0 fails) | list/validate/catalog/where (pinned, no bin-dir shadowing), plan solve/solve-json, doctor, native-help `--help=3`, `run --case positive/negative` PASS, typed `exec` default (true exit 10 + SATISFIABLE receipt) and `--models 0` (true exit 30, flag reaches binary as `--models=0`), `invoke` negative (true exit 20 + UNSATISFIABLE), official exit-code family probe 30/20/65 on the pinned binary, 7 fail-closed error paths (exit 2) | `receipts/cli/` (per-command raw logs, sha256-pinned events ndjson) |
| C: staged SDK (11 checks, 0 fails) | single-model 10 + all-models 30 with stream sha256s, negative 20, invalid input 65 + UNPARSED (never a verdict), missing-pinned NOT_STARTED fail-closed (no PATH substitution), default python-module contract honestly INCONCLUSIVE without a wheel, traversal/absolute/unstaged-input/raw-pass-through denials, 1s budget bound | `receipts/sdk/sdk-events.ndjson` |
| D: MCP stdio (9 checks, 0 fails) | real handshake protocol `2025-06-18` server `formal-tools-skill/0.4.0`; current **12-tool** fixed registry (9 original + 3 portfolio, post-#69), no raw argv/shell surface; pinned clingo probe EXECUTED; both fixtures PASS through MCP; valid/invalid `plan_native_cli`; read-only `inspect_native_installation` (`clingo-bin`, FOUND_NOT_PROBED); unknown-tool denial; graceful shutdown exit 0 | `receipts/mcp/mcp-events.ndjson` |
| Isolation | non-root uid 1000, bundle write-denied, offline network, umask 0022, private tmp workspaces, tracked tree clean before/after (host-authoritative), canonical SHA256SUMS anchor | `receipts/isolation.txt`, `receipts/host-identity.txt` |

## Exit-code semantics note (why positive accepts 30)

The committed fixture command enumerates **all** models (suffix `0`). On the
pinned official 5.8.3 binary this deterministically exits **30** (SATISFIABLE
with 2 answer sets — measured repeatedly; the portable R3 harness allowed
exactly `30 10 0` for the same fixture class), while single-model runs and the
Python module exit 10. `interpret()` therefore accepts exits `[0,10,30]` for
positive **only** together with the `SATISFIABLE` verdict text and exactly two
enumerated `Answer:` sets; negative stays `[0,20]`; anything else (including
`UNKNOWN`) fails closed. The old `[0,10]` check was the real false-INCONCLUSIVE
that made this lane BLOCK.

## Honest boundaries

- The canonical container receipt's `source_identity` is `UNVERIFIED` (no git
  in the minimal trixie image); the authoritative checkout identity is the
  host-side `CLEAN @ eb7e669…` receipt plus pre/post tracked-clean checks.
- No timeout case is manufactured for clingo: the committed fixture solves in
  ~5 ms; the budget gate proves a 1s bound completes and the timeout machinery
  itself is regression-covered by unit tests.
- upstream signature/supply-chain audit of the binary is **not** performed here
  (binary inherited from the #24-verified canonical bundle; sha256 anchored);
  publisher-chain authentication remains a separate T0/T1 concern per #31.
- `ENV_PASS`/`CANDIDATE_FOR_REVIEW` are not business proof: this receipt does
  not advance T5/T6, the 23 expansion tools, or any Product #11 gate.
