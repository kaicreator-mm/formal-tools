#!/bin/bash
# I4 R0 CLI gate driver (engine-provisioned Linux host, repo root cwd).
# Every command's true exit code is captured immediately (rc=$? right after the
# command; no pipes on the gating command). Outputs go to per-command files whose
# sha256 is recorded; heads are echoed into the ndjson events stream.
# Usage: bash cli-driver.sh <out-dir>
set -u
REPO="$(pwd)"
OUT="${1:-validation/local-runtime-receipts/i4-r0/cli-receipts}"
SCRATCH="${2:-/home/cc/formal-tools-build/i4-runtime-r0/scratch}"
mkdir -p "$OUT"
EV="$OUT/cli-events.ndjson"
: > "$EV"
IDX=0
CLI="node packages/runner/js/cli.mjs"

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
FAILS=0
run() { # name expected-exit cmd...
  local name="$1" expected="$2"; shift 2
  local f="$OUT/cmd-$IDX-$name.log"
  f="${f//$IDX/$IDX}"
  "$@" > "$f" 2>&1
  local rc=$?
  record "$name" "$expected" "$rc" "$f"
}

stage() { # tool files...
  local tool="$1"; shift
  rm -rf "$SCRATCH/$tool"; mkdir -p "$SCRATCH/$tool"
  cp skills/"$tool"/examples/* "$SCRATCH/$tool/" 2>/dev/null
}

# ---- identity ---------------------------------------------------------------
{
  echo "== identity =="
  node -v
  git rev-parse HEAD
  echo "umask=$(umask)"
  id
} > "$OUT/identity.txt" 2>&1
grep -E "HEAD|refs" "$OUT/identity.txt" > /dev/null
run cli-list 0 $CLI list
run cli-validate 0 $CLI validate
run cli-doctor-all-searchplan 0 $CLI doctor-all
run cli-doctor-all-probe 0 $CLI doctor-all --probe --timeout 30

# ---- per-tool real version probes (doctor exit 0 == executed w/ output) -----
for t in z3 cvc5 lean4 dafny vampire souffle rdf-shacl apache-jena prob apalache alloy tla-tlc clingo; do
  run "doctor-$t" 0 $CLI doctor "$t" --timeout 30
done

# ---- sampled typed exec with real, version-dependent flags ------------------
stage z3
run exec-z3-solve-timeout-flag 0 $CLI exec z3 solve --timeout 10 --cwd "$SCRATCH/z3" --input positive.smt2
stage cvc5
run exec-cvc5-solve-models-tlimit 0 $CLI exec cvc5 solve --models true --tlimit 10000 --cwd "$SCRATCH/cvc5" --input positive.smt2
stage vampire
run exec-vampire-casc-mode 60 $CLI exec vampire casc --timeout 90 --cwd "$SCRATCH/vampire" --input positive.p
stage tla-tlc
run exec-tlc-check-workers-config 0 $CLI exec tla-tlc check --workers 2 --config Toggle.cfg --timeout 90 --cwd "$SCRATCH/tla-tlc" --input TogglePositive.tla
stage apalache
run exec-apalache-check-length-init 0 $CLI exec apalache check --length 3 --init Init --next Next --inv Inv --timeout 90 --cwd "$SCRATCH/apalache" --input TogglePositive.tla
stage alloy
run exec-alloy-command-flag 0 $CLI exec alloy exec --command 0 --timeout 90 --cwd "$SCRATCH/alloy" --input positive.als
stage souffle
run exec-souffle-run-output-dir 0 $CLI exec souffle run --output . --timeout 60 --cwd "$SCRATCH/souffle" --input positive.dl
stage prob
run exec-prob-bounded-mc 0 $CLI exec prob check --bounded 5 --timeout 60 --cwd "$SCRATCH/prob" --input Positive.mch
stage apache-jena
run exec-jena-query-data-query 0 $CLI exec apache-jena query --data data.ttl --query query.rq --timeout 45 --cwd "$SCRATCH/apache-jena"
stage lean4
run exec-lean-check 0 $CLI exec lean4 check --timeout 60 --cwd "$SCRATCH/lean4" --input Positive.lean
stage dafny
run exec-dafny-verify 0 $CLI exec dafny verify --timeout 90 --cwd "$SCRATCH/dafny" --input Positive.dfy
stage rdf-shacl
run exec-rdfshacl-format-shapes 0 $CLI exec rdf-shacl validate --format human --shapes shapes.ttl --timeout 60 --cwd "$SCRATCH/rdf-shacl" --input positive.ttl
# clingo typed exec: python-module runtime is not provisioned in the canonical
# bundle (binary clingo 5.8.3 only) -> expected BLOCK/INCONCLUSIVE, no fake PASS.
printf '{"i":"clingo-exec","name":"exec-clingo-solve","expected":"NOT_RUN_INCONCLUSIVE","reason":"python clingo module absent from canonical bundle; binary-only"}\n' >> "$EV"

# ---- engine-native help probes (real --help across installed versions) ------
run nativehelp-z3 0 $CLI native-help z3 --timeout 20
run nativehelp-sany 0 $CLI native-help tla-tlc --entry sany --timeout 30
run nativehelp-alloy 0 $CLI native-help alloy --timeout 30
run nativehelp-vampire-showoptions 0 $CLI native-help vampire --entry vampire --timeout 20
run nativehelp-riot 0 $CLI native-help apache-jena --entry riot --timeout 20
run nativehelp-probcli 0 $CLI native-help prob --timeout 20

# ---- fail-closed error paths (expected exit 2 + ERROR JSON on stderr) -------
run err-unknown-operation 2 $CLI exec z3 no_such_operation --input positive.smt2
run err-invalid-enum 2 $CLI plan vampire prove --mode shell
run err-unknown-tool 2 $CLI doctor no_such_tool
run err-invalid-case 2 $CLI run z3 --case bogus
run err-range-violation 2 $CLI plan z3 solve --timeout 0
run err-raw-in-mcp-toolset 2 $CLI catalog no_such_tool

# ---- pure JS engines ---------------------------------------------------------
run pure-dag-positive 0 $CLI pure dag --input validation/js/dag-positive.json
run pure-dag-negative ANY $CLI pure dag --input validation/js/dag-negative.json

# ---- isolation: no fixture/exec run wrote into the git tree -----------------
git status --porcelain > "$OUT/post-run-git-status.txt" 2>&1
if [ -s "$OUT/post-run-git-status.txt" ]; then
  printf '{"name":"git-tree-untouched","verdict":"FAIL","detail":"tree modified by runs"}\n' >> "$EV"
  FAILS=$((FAILS+1))
else
  printf '{"name":"git-tree-untouched","verdict":"PASS"}\n' >> "$EV"
  echo "ok: git-tree-untouched"
fi
printf '{"driver_done":true,"fails":%s,"commands":%s}\n' "$FAILS" "$IDX" >> "$EV"
echo "CLI_DRIVER_DONE fails=$FAILS commands=$IDX"
exit "$FAILS"
