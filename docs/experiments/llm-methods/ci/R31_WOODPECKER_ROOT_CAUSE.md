# R31 — Woodpecker CI Root-Cause Investigation (Issue #11, Pipelines #971/#973/#976/#977/#978)

OUTPUT_LABEL=FORMAL_TOOLS_I11_CI_ROOT_CAUSE_EVIDENCE_R31
ROLE=ORIGINAL_LOCAL_EXECUTOR · PLATFORM=Windows Node 24.21.0 local · CI=Woodpecker ci.kaicreator.com (repo_id=39)
Machine-readable companion: `R31_WOODPECKER_ROOT_CAUSE.json`

## 1. Executive verdict

| Pipeline | PR | Event | Exact SHA (from clone log) | First failure | Classification |
|---|---|---|---|---|---|
| #971 | #97 | pull_request | `a6316dfa…7917` (fetch attempted) | clone exit **128** — TLS `unexpected eof` ×4 (initial + 3 git-wrapper retries), zero build steps ran | **INFRASTRUCTURE** |
| #973 | #98 prior | push | `f3b0ac94…1d1a` | test step exit **1** — `SyntaxError` at `tests/ads-native-replay.test.mjs:71` (module parse), then R21 binding `AssertionError` | **SOURCE** |
| #976 | #98 prior | pull_request | `f3b0ac94…1d1a` | identical to #973 (same two errors, same values) | **SOURCE** |
| #977 | #98 current | push | `d65eb49b…cb8f` | test step exit **1** — `AssertionError` at `tests/i11-dag-receipt-reconciliation.test.mjs:174` | **SOURCE** |
| #978 | #98 current | pull_request | `d65eb49b…cb8f` | identical to #977 | **SOURCE** |

- **No PR-vs-push SHA skew**: #973/#976 both checked out `f3b0ac94`, #977/#978 both `d65eb49b` (verified from clone logs; the pipeline list view leaves `sha` empty).
- **No Node version skew**: every pipeline logged `node v24.21.0`, `npm 11.19.0`.
- **PR event semantics**: PR pipelines build `refs/pull/NN/merge`; the `branch` field showing `main` is the base branch used by `git init -b` — not a wrong checkout.

## 2. Root causes with raw-log evidence

### #971 (PR #97) — clone network transient, code is fine

Clone log (`p971_step25198`, sha256 `2a04fa2b…22b8`):

```
fatal: unable to access 'https://github.com/kaicreator-mm/formal-tools.git/':
  TLS connect error: error:0A000126:SSL routines::unexpected eof while reading
git-wrapper: transient transport failure (attempt 1/3), retrying in 2s
… (attempts 2/3 and 3/3 identical) …
exit status 128
```

The downstream step has **no log** (never started). Decisive cross-evidence: **push pipeline #970 ran the exact same SHA `a6316dfa` and is SUCCESS** — its clone hit the *same* TLS transient but the 3rd wrapper retry succeeded. PR #97's green on #963 belongs to an older head (`76a8dba8`) and is not citable for `a6316dfa`. Resolution: API restart of the same SHA → **#989 SUCCESS** (tests 362 / pass 361 / fail 0).

### #973/#976 (PR #98 prior `f3b0ac94`) — two source defects

1. **First failure in execution order — SyntaxError (module load)**:
   `tests/ads-native-replay.test.mjs:71` contained a JS string with a `\\"` sequence (escaped backslash followed by a closing quote), which terminated the string literal early → `SyntaxError: Invalid or unexpected token` at parse time; the whole test file failed.
2. **R21 binding AssertionError**:
   `tests/i11-dag-receipt-reconciliation.test.mjs:174`
   `assert.equal(native.original_js_runner_replay.source_git_blob, gitBlob('benchmarks/llm-methods/g3/ads-native-replay.mjs'))`
   → actual (receipt-pinned) `9794ec4b62d3f5e9c22fa1f45ee3999565aa9a68` ≠ expected (actual file bytes) `cb807f27da46e8de3b9de797fc344f0bcc99da3e`.

The writer fixed (1) in `d65eb49b` (current head); in #977/#978 the `ads-native-replay` test file passes.

### #977/#978 (PR #98 current `d65eb49b`) — frozen-provenance binding, fail-closed by design

The receipt `validation/ads24-native-2026-11-13/NATIVE_PAIR.json` (a real Z3/cvc5 24×2 execution record, `claim_verdict=UNVERIFIED`) pins `original_js_runner_replay.source_git_blob = 9794ec4b62…` — the replay source *as it existed when the native run was recorded* (this is also main's current blob, which is why main CI is green). PR98 commit `f3b0ac9` ("isolate native tool environment per execution") edited that frozen source in place (blob → `cb807f27da…`) without re-recording the receipt. The R21 reconciliation test is the product's fail-closed guard against exactly this drift.

Provenance chain (two fail-closed layers): `TASK_DAG.reconciliation` pins the receipt file blob (`cee8f188…`), and the receipt pins the frozen source blob (`9794ec4b…`). Editing either without a real re-verification must fail — editing the receipt was therefore **not** an option, and re-running the Z3/cvc5 24×2 native verification is out of scope for this round.

## 3. Fix (commit `38258be` on the PR #98 writer branch)

1. **Restore the frozen source to its receipt-pinned bytes** — `benchmarks/llm-methods/g3/ads-native-replay.mjs` byte-identical to blob `9794ec4b62…` (verified by hash before commit).
2. **Keep the isolation feature where it really lives** — the typed Native Runner (`packages/runner/js/native.mjs`, delivered by `f3b0ac9`+`d65eb49b`) accepts `{env}` and resolves executables from that environment (`executable(name, env)` reads `FORMAL_TOOLS_BIN_DIR` from the passed env; signatures are backward-compatible with the frozen source). The writer's concurrent-isolation test was retargeted to exercise `doctor()`/`executeNativePlan()` with explicit `{env}` — testing the real capability, not a lowered bar.
3. **Regression test reproducing the original failure** — new test `G3 frozen ADS24 replay source stays byte-identical to its recorded receipt provenance`: recomputes the file's Git blob and asserts equality with the receipt's `source_git_blob`. Any future byte edit of the frozen source without re-recording the receipt turns CI red again (exactly the #973/#976/#977/#978 signature).
4. Receipt untouched; no native re-run performed.

## 4. Local Node 24.21.0 verification (real exit codes)

| Check | Windows (fnm 24.21.0) | WSL Linux (node 24.21.0, CI-equivalent) |
|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` | EXIT 0 (8 packages) | — |
| `node --test tests/ads-native-replay.test.mjs tests/i11-dag-receipt-reconciliation.test.mjs` | EXIT 0 — 13 tests / 11 pass / 0 fail / 2 skip (linux-only) | ads-native-replay file: **5/5 pass** incl. concurrent-isolation test |
| `node --test tests/*.test.mjs` (full) | 355 tests / 329 pass / 7 fail / 19 skip — all 7 are Windows-environment-incompatible (R13 symlink ×3, R13 P2 `ldd`, doctor bundled-library, G6/G4 fail-closed real-call); each passes on CI Linux (#978 log), none intersects the repair surface | **356 tests / 355 pass / 0 fail / 1 skip, exit 0** |
| `npm run typecheck` (`tsc --noEmit`) | EXIT 0 | — |
| CLI smoke ×5 (`validate`, `pure dag`, `catalog z3`, `info z3`, `plan z3 solve`) | EXIT 0 ×5 | — |

## 5. Post-fix CI (same-SHA double-green)

| Pipeline | Event | SHA | Status | Test evidence |
|---|---|---|---|---|
| **#987** | push | `38258be…ecb` | **SUCCESS** | tests 356 / pass 355 / fail 0 |
| **#988** | pull_request | `38258be…ecb` | **SUCCESS** | same; new regression test ✔ and runner-isolation test ✔ in log, zero ✖ |
| **#989** | pull_request (restart of #971) | `a6316dfa…7917` | **SUCCESS** | tests 362 / pass 361 / fail 0 |

PR #97 requires no source change: push #970 + restarted PR #989 are both SUCCESS on the same exact SHA `a6316dfa`.

## 6. Open blocks

None. Observation (non-blocking, out of R31 scope): `TASK_DAG.reconciliation.reconciled_against_main_sha` points at an older main (`eeabfc96…`); the R21 test only asserts the 40-hex format, not the value.

## 7. Log integrity

SHA256 of every cited step log (Woodpecker logs API decoded text) is recorded in the companion JSON. Raw decoded logs were retained locally during the investigation; no credentials, tokens or private environment data are reproduced in these evidence files.
