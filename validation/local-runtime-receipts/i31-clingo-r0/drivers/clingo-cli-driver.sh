#!/bin/bash
# I31 Clingo-only CLI gate driver (canonical Debian 13 container, PR #76 lane).
# Successor scope to the #4 clingo exception: run ONLY clingo at the exact PR
# checkout SHA against the pinned official native binary from the #24 canonical
# deb13 bundle. Every command's true exit code is captured immediately
# (rc=$? right after the command; no pipes on the gating command). Outputs go
# to per-command files whose sha256 is recorded; heads are echoed into ndjson.
# Usage: bash clingo-cli-driver.sh <out-dir> <scratch-dir>
set -u
REPO="$(pwd)"
OUT="${1:-validation/local-runtime-receipts/i31-clingo-r0/cli}"
SCRATCH="${2:-/tmp/ft-i31-scratch}"
mkdir -p "$OUT" "$SCRATCH"
EV="$OUT/cli-events.ndjson"
: > "$EV"
IDX=0
FAILS=0
NODE="${FT_NODE:-node}"
CLI="$NODE packages/runner/js/cli.mjs"
CLINGO_BIN="${FORMAL_CLINGO_BIN:?FORMAL_CLINGO_BIN must pin the official native clingo executable}"

record() { # name expected actual detail-file
  local name="$1" expected="$2" actual="$3" file="$4"
  local head sha
  head="$(head -c 300 "$file" 2>/dev/null | tr '\n' ' ' | tr -d '\r')"
  sha="$(sha256sum "$file" 2>/dev/null | cut -d' ' -f1)"
  IDX=$((IDX+1))
  printf '{"i":%s,"name":"%s","expected_exit":"%s","actual_exit":"%s","out_sha256":"%s","head":"%s"}\n' \
    "$IDX" "$name" "$expected" "$actual" "$sha" "${head//\"/\\\"}" >> "$EV"
  if [ "$expected" != "ANY" ] && [ "$expected" != "$actual" ]; then
    printf '{"i":%s,"name":"%s","verdict":"FAIL","expected":"%s","actual":"%s"}\n' "$IDX" "$name" "$expected" "$actual" >> "$EV"
    echo "FAIL: $name expected=$expected actual=$actual" >&2
    FAILS=$((FAILS+1))
  else
    echo "ok: $name exit=$actual"
  fi
}
run() { # name expected-exit cmd...
  local name="$1" expected="$2"; shift 2
  local f="$OUT/cmd-$IDX-$name.log"
  "$@" > "$f" 2>&1
  local rc=$?
  record "$name" "$expected" "$rc" "$f"
}

# ---- identity & pinned launcher provenance -----------------------------------
# The canonical deb13 container ships no git: checkout identity is authoritative
# on the host side (host-identity.txt, pre/post run) and the expected HEAD is
# injected via FT_EXPECTED_HEAD for cross-checking inside the container.
{
  echo "== i31 clingo identity =="
  "$NODE" -v
  if command -v git >/dev/null 2>&1; then
    echo "git_head=$(git rev-parse HEAD)"
    echo "git_dirty_tracked=$(git status --porcelain --untracked-files=no | wc -l)"
  else
    echo "git_head=${FT_EXPECTED_HEAD:?FT_EXPECTED_HEAD required when git is unavailable}"
    echo "git=UNAVAILABLE_IN_CONTAINER (authoritative checkout identity: host-identity.txt)"
  fi
  echo "umask=$(umask)"
  id
  echo "FORMAL_CLINGO_BIN=$CLINGO_BIN"
  sha256sum "$CLINGO_BIN"
  "$CLINGO_BIN" --version | head -1
  echo "LD_LIBRARY_PATH=${LD_LIBRARY_PATH:-UNSET}"
  [ -f "$CLINGO_BIN" ] && [ -x "$CLINGO_BIN" ] && echo "pinned_file=OK_REGULAR_EXECUTABLE" || echo "pinned_file=BAD"
} > "$OUT/identity.txt" 2>&1
grep -q "^git_head=[0-9a-f]\{40\}$" "$OUT/identity.txt" || { echo "FAIL: no checkout HEAD" >&2; exit 1; }

# ---- official exit-code semantics on the pinned binary (direct, no runner) ---
T="$SCRATCH/exit-probe"; rm -rf "$T"; mkdir -p "$T"
printf 'candidate(a;b).\n1 { choose(X) : candidate(X) } 1.\n#show choose/1.\n' > "$T/p.lp"
printf 'candidate(a;b).\n1 { choose(X) : candidate(X) } 1.\n:- choose(a).\n:- choose(b).\n#show choose/1.\n' > "$T/n.lp"
printf 'this is not asp )(\n' > "$T/bad.lp"
"$CLINGO_BIN" "$T/p.lp" 0 > "$T/pos.out" 2> "$T/pos.err"; POS_RC=$?
POS_SHA=$(sha256sum "$T/pos.out" | cut -d' ' -f1)
POS_MODELS=$(grep -c "^Answer:" "$T/pos.out")
{ echo "pos_exit=$POS_RC pos_models=$POS_MODELS pos_stdout_sha256=$POS_SHA pos_satisfiable=$(grep -c '^SATISFIABLE$' "$T/pos.out")"; } > "$T/pos.meta"
grep -q "^SATISFIABLE$" "$T/pos.out" && [ "$POS_RC" = "30" ] && [ "$POS_MODELS" = "2" ] \
  && echo "ok: exit-probe-pos exit=30 models=2" || { echo "FAIL: exit-probe-pos rc=$POS_RC models=$POS_MODELS" >&2; FAILS=$((FAILS+1)); }
"$CLINGO_BIN" "$T/n.lp" 0 > "$T/neg.out" 2>&1; NEG_RC=$?
grep -q "^UNSATISFIABLE$" "$T/neg.out" && [ "$NEG_RC" = "20" ] \
  && echo "ok: exit-probe-neg exit=20" || { echo "FAIL: exit-probe-neg rc=$NEG_RC" >&2; FAILS=$((FAILS+1)); }
"$CLINGO_BIN" "$T/bad.lp" 0 > "$T/err.out" 2> "$T/err.err"; ERR_RC=$?
ERR_SHA=$(sha256sum "$T/err.err" | cut -d' ' -f1)
grep -qi "error" "$T/err.err" && [ "$ERR_RC" = "65" ] \
  && echo "ok: exit-probe-err exit=65" || { echo "FAIL: exit-probe-err rc=$ERR_RC" >&2; FAILS=$((FAILS+1)); }
IDX=$((IDX+1))
printf '{"i":%s,"name":"official-exit-codes","pos":{"exit":%s,"models":%s,"stdout_sha256":"%s"},"neg_exit":%s,"invalid_exit":%s,"invalid_stderr_sha256":"%s","note":"official 10/20/65 family observed as 30(all-model enumeration)/20/65 on pinned 5.8.3"}\n' \
  "$IDX" "$POS_RC" "$POS_MODELS" "$POS_SHA" "$NEG_RC" "$ERR_RC" "$ERR_SHA" >> "$EV"

# ---- CLI static + catalog surfaces -------------------------------------------
run cli-list 0 $CLI list
run cli-validate 0 $CLI validate
run cli-catalog-clingo 0 $CLI catalog clingo
run cli-where-clingo-pinned 0 $CLI where clingo
run cli-plan-solve 0 $CLI plan clingo solve --input skills/clingo/examples/positive.lp
run cli-plan-solve-json 0 $CLI plan clingo solve-json --input skills/clingo/examples/positive.lp --models 0

# ---- doctor probes (real pinned binary) --------------------------------------
run cli-doctor-clingo 0 $CLI doctor clingo --timeout 30

# ---- engine-native help on the pinned binary ---------------------------------
run cli-nativehelp-clingo 0 $CLI native-help clingo --timeout 20

expect_in_file() { # name pattern file
  local name="$1" pattern="$2" file="$3"
  IDX=$((IDX+1))
  if grep -q -- "$pattern" "$file" 2>/dev/null; then
    printf '{"i":%s,"name":"%s","verdict":"PASS","pattern":"%s"}\n' "$IDX" "$name" "${pattern//\"/\\\"}" >> "$EV"
    echo "ok: $name"
  else
    printf '{"i":%s,"name":"%s","verdict":"FAIL","pattern":"%s","file":"%s"}\n' "$IDX" "$name" "${pattern//\"/\\\"}" "$file" >> "$EV"
    echo "FAIL: $name pattern not found in $file" >&2
    FAILS=$((FAILS+1))
  fi
}

# ---- typed exec + committed fixtures (runner paths) --------------------------
run cli-run-positive 0 $CLI run clingo --case positive --timeout 45
run cli-run-negative 0 $CLI run clingo --case negative --timeout 45
# "suite" is the separate all-13-tools action (out of this clingo-only lane);
# an invalid --case value must fail closed:
run err-invalid-case 2 $CLI run clingo --case bogus
mkdir -p "$SCRATCH/exec"; cp skills/clingo/examples/*.lp "$SCRATCH/exec/"
# The CLI propagates nonzero solver outcomes as its own exit 2 with a technical
# receipt carrying the TRUE upstream exit codes (30 all-model SAT fixture /
# 20 UNSAT); "counterexample is a meaningful observation" per cli.mjs mapping.
run cli-exec-solve-positive 2 $CLI exec clingo solve --timeout 45 --cwd "$SCRATCH/exec" --input positive.lp
EXEC_LOG="$OUT/cmd-$((IDX-1))-cli-exec-solve-positive.log"
expect_in_file cli-exec-true-exit-30 '"exit_code":30' "$EXEC_LOG"
expect_in_file cli-exec-run-executed '"run_status":"EXECUTED"' "$EXEC_LOG"
expect_in_file cli-exec-satisfiable '"tool_outcome":"SATISFIABLE"' "$EXEC_LOG"
run cli-invoke-solve-negative 2 $CLI invoke clingo solve --timeout 45 --cwd "$SCRATCH/exec" --input negative.lp
INVOKE_LOG="$OUT/cmd-$((IDX-1))-cli-invoke-solve-negative.log"
expect_in_file cli-invoke-true-exit-20 '"exit_code":20' "$INVOKE_LOG"
expect_in_file cli-invoke-unsatisfiable '"tool_status":"UNSATISFIABLE"' "$INVOKE_LOG"

# ---- fail-closed error paths (expected exit 2) --------------------------------
run err-unknown-operation 2 $CLI exec clingo no_such_operation --input positive.lp
run err-invalid-enum-optmode 2 $CLI plan clingo solve --opt-mode shell
run err-range-models-negative 2 $CLI plan clingo solve --models -3
run err-range-timelimit-zero 2 $CLI plan clingo solve --time-limit 0
run err-unknown-tool 2 $CLI doctor no_such_tool
run err-pinned-missing 2 env -u FORMAL_CLINGO_BIN FORMAL_CLINGO_BIN=/nonexistent/clingo $CLI where clingo

# ---- isolation ----------------------------------------------------------------
# Tracked-tree cleanliness is authoritative on the host (same bind-mounted tree,
# checked after the whole container run). In-container git check is best-effort.
if command -v git >/dev/null 2>&1; then
  git status --porcelain --untracked-files=no > "$OUT/post-run-git-status.txt" 2>&1
else
  printf 'git-unavailable-in-container; authoritative tree check: host post-run receipt\n' > "$OUT/post-run-git-status.txt"
fi
if [ -s "$OUT/post-run-git-status.txt" ] && ! grep -q "^git-unavailable" "$OUT/post-run-git-status.txt"; then
  printf '{"name":"git-tree-untouched","verdict":"FAIL","detail":"tree modified by runs"}\n' >> "$EV"
  FAILS=$((FAILS+1))
else
  printf '{"name":"git-tree-untouched","verdict":"PASS"}\n' >> "$EV"
  echo "ok: git-tree-untouched"
fi
printf '{"driver_done":true,"fails":%s,"commands":%s}\n' "$FAILS" "$IDX" >> "$EV"
echo "CLINGO_CLI_DRIVER_DONE fails=$FAILS commands=$IDX"
exit "$FAILS"
