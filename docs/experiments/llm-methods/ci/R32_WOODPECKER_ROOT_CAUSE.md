# R32 — Woodpecker CI Root-Cause Investigation (Issue #11, Pipelines #999/#1002/#1003)

OUTPUT_LABEL=FORMAL_TOOLS_I11_R32_CI_ROOT_CAUSE_EVIDENCE
ROLE=ORIGINAL_LOCAL_EXECUTOR · PLATFORM=Windows Node 24.21.0 local + WSL Linux Node 24.21.0 · CI=Woodpecker ci.kaicreator.com (repo_id=39)
Machine-readable companion: `R32_WOODPECKER_ROOT_CAUSE.json`

## 1. Executive verdict

| Pipeline | PR | Event | Exact SHA (from clone log) | First failure | Classification |
|---|---|---|---|---|---|
| #999 | — | push main | `6e98fef4…cf06` (fetch attempted) | clone exit **128** — TLS `unexpected eof` ×4 (initial + 3 git-wrapper retries), zero build steps ran | **INFRASTRUCTURE** |
| #1002 | #98 | push | `802ec0e6…dc73` | test step exit **1** — file-level `SyntaxError` at `tests/ads-native-replay.test.mjs:135` (module parse) | **SOURCE** |
| #1003 | #98 | pull_request | `802ec0e6…dc73` | identical to #1002 (same SHA, same failure, same stats) | **SOURCE** |

- **No PR-vs-push SHA skew**: #1002/#1003 both checked out `802ec0e6` (verified from clone logs; the list view leaves `sha` empty).
- **No Node version skew**: every pipeline logged `node v24.21.0`, `npm 11.19.0`.
- **Pipeline message anomaly**: #1003's `message` field carries the message of *ancestor* commit `f3b0ac9` ("isolate native tool environment per execution"), not the fetched head `802ec0e6` ("isolate frozen ADS24 orchestration in worker environments"). The clone log is the only authoritative SHA source — Exact-SHA discipline holds.

## 2. Root cause with raw-log evidence

### #999 — clone network transient, code is fine

Clone log (`p999_step25316`, sha256 `fcf3e585…0331`): four consecutive `TLS connect error: error:0A000126:SSL routines::unexpected eof while reading` (initial + 3 git-wrapper retries), `exit status 128`. The downstream step has **no log** (logs API returns `null` — never started). Resolution: API restart of the same SHA → **#1174 SUCCESS** (clone fetched `6e98fef4` clean; tests 363 / pass 362 / fail 0).

### #1002/#1003 — one real defect, doubled by push+PR events

The CI step's first failing command is `node --test tests/*.test.mjs` (exit 1); `npm run typecheck` and the later CLI commands in the step never ran. The spec-reporter output shows a **detail-less file-level failure**:

```
ℹ tests 361  ℹ pass 359  ℹ fail 1  ℹ cancelled 0  ℹ skipped 1
✖ failing tests: test at tests/ads-native-replay.test.mjs:1:1
✖ tests/ads-native-replay.test.mjs (261.73749ms)  'test failed'
```

Zero tests from the file registered — the **module failed to parse**. Local reproduction at the exact SHA (Windows + WSL, Node 24.21.0) yields the full stack:

```
file:///…/tests/ads-native-replay.test.mjs:135
     "if [ \\"$1\\" = \\"-version\\" ]; then echo \\"worker-"+name+"\\"; …
              ^^^
SyntaxError: Invalid or unexpected token
```

**Root cause**: commit `802ec0e6` (this PR's head) added the worker-isolation test and re-typed the fake-tool script template with double escapes (`\\n` → literal backslash-n, `\\"` → escaped backslash + closing quote). `\\` consumed the intended backslash, `"` terminated the string literal early, and `$1` became a bare token → `SyntaxError` at module load → whole file failed on **every** platform (not Linux-specific). `npm run typecheck` on the same tree fails with 9 tsc syntax errors, all at line 135 — same single root cause.

## 3. Recurrence analysis

This is the **second occurrence of the same defect class in this file**: R31 pipeline #973 failed with the identical SyntaxError signature at `tests/ads-native-replay.test.mjs:71`; the writer fixed it in `d65eb49b`; and the new worker-isolation test added by `802ec0e6` re-typed the same template with double escapes at line 135. The fix therefore removes the duplication instead of patching the line a second time.

## 4. Fix (commit `f8f2eae` on the PR #98 branch)

1. **Single shared template** — the fake-tool script is now one module-scope `fakeToolScript(label, status)` helper with correct escaping (`\n`, `\"`), used by both the per-execution concurrent-isolation test (label `isolated-<name>`) and the worker-isolation test (label `worker-<name>`); emitted bytes are unchanged from the previously-correct variant.
2. **Regression test** — new platform-independent test *"G3 fake native tool scripts remain valid one-command-per-line POSIX templates"*: asserts the shebang terminates on a real newline, the script ends with a newline, one command per line, and **no literal `\n` (backslash+n) or `\"` (backslash+quote) sequences**. A re-escaped variant now fails on every platform before it can reach CI — and, had the original double-escaped variant parsed, it would have produced a single-line sh comment whose empty probe output fails the isolation assertions anyway.
3. **Frozen provenance untouched** — `benchmarks/llm-methods/g3/ads-native-replay.mjs` and `validation/ads24-native-2026-11-13/NATIVE_PAIR.json` are byte-identical (the provenance blob test passes); no Z3/cvc5 24×2 native re-verification executed.

## 5. Local Node 24.21.0 verification (real exit codes)

| Check | Pre-fix | Post-fix (Windows 24.21.0) | Post-fix (WSL Linux 24.21.0, CI-equivalent) |
|---|---|---|---|
| `node --test tests/ads-native-replay.test.mjs tests/i11-dag-receipt-reconciliation.test.mjs` | EXIT 1 (SyntaxError:135, file-level) | EXIT 0 — 15 tests / 12 pass / 0 fail / 3 skip (linux-only by design) | EXIT 0 — **15 tests / 15 pass / 0 fail / 0 skip**: both worker concurrency tests execute (`runner binds concurrent native executions` 48.1ms, `concurrent frozen ADS24 orchestrations isolate each worker's native environment` 284.5ms) |
| `node --test tests/*.test.mjs` (full suite) | — | — | EXIT 0 — **367 tests / 366 pass / 0 fail / 1 skip** (pre-existing platform skip), 1862ms |
| `npm run typecheck` (`tsc --noEmit`) | EXIT 2 (9 errors, all at line 135) | EXIT 0 | EXIT 0 |
| CLI smoke ×5 (`validate`, `pure dag`, `catalog z3`, `info z3`, `plan z3 solve`) | — | — | EXIT 0 ×5 (the remaining commands of the CI step) |

Pre-fix WSL repro at exact SHA `802ec0e6`: cold clone from the workspace mirror, `node --test tests/ads-native-replay.test.mjs` → exit 1, 1 test entry / 0 pass / 1 fail — the exact CI failure shape.

## 6. Post-fix CI

| Pipeline | Event | SHA | Status | Test evidence |
|---|---|---|---|---|
| **#1174** | push main (API restart of #999) | `6e98fef4…cf06` | **SUCCESS** | tests 363 / pass 362 / fail 0 / skip 1 |
| #1197 | push `f8f2eae` (first attempt) | `f8f2eaec…86f8` | failure — **clone exit 128**, TLS transient (same class as #999); zero build steps | — |
| **#1203** | push (API restart of #1197, same SHA) | `f8f2eaec…86f8` | **SUCCESS** | tests **367 / pass 366 / fail 0 / skip 1** — regression test and both worker concurrency tests pass on CI Linux; identical to the WSL local full suite |
| **#1198** | pull_request (hook replay) | `f8f2eaec…86f8` | **SUCCESS** | tests 367 / pass 366 / fail 0 / skip 1 |

**Webhook delivery forensics (new failure mode recorded)**: the push of `f8f2eae` never created a pipeline. GitHub's delivery log shows the server answered **HTTP 400 to every webhook between 08:24-08:41Z** — the same forge-degradation window that killed #999's clone and makes manual pipeline triggers return 400/500. The push delivery (`3854156675629973504`) and the PR #98 synchronize delivery (`3854156678811353088`) both landed in that window. GitHub's redelivery API is unavailable for this credential (404 on a delivery id that GET resolves). Resolution: the two delivery payloads were replayed byte-faithfully to the Woodpecker hook endpoint after recovery → pipelines **#1197/#1198**. Zero commits fabricated; the first push attempt #1197 itself died in a later clone-transient window and was resolved by the standard same-SHA API restart (#1203).

## 7. Open blocks

None.

## 8. Log integrity

SHA256 of every cited step log (Woodpecker logs API decoded text, same convention as R31) is recorded in the companion JSON. Raw decoded logs were retained locally during the investigation; no credentials, tokens or private environment data are reproduced in these evidence files.
