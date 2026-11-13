#!/usr/bin/env bash
# I24 x PR#69 gateway verification — executed INSIDE a fresh offline debian:13
# container (real Debian 13 userland), using the delivered bundle's embedded
# node22 runtime against PR #69 exact head e76a5617807fce68d4eeae87f2af7f314dab1a35.
# Read-only w.r.t. PR #69: no commits, no pushes to its branch or write set.
set -uo pipefail
TREE=/ft69
BUNDLE=/bundle
NODE="$BUNDLE/runtimes/node22/bin/node"
RUNNER_SHA=066674ca41414d1e80019218a5d20f404c0fef75785fb348fed313634720c1d3
cd "$TREE" || exit 9

echo "===== S1: node --test PR#69 I24 test files (real debian:13) ====="
"$NODE" --test tests/tool-portfolio-t4.test.mjs tests/tool-contract-parity.test.mjs > /tmp/t4-tests.log 2>&1
echo "TESTS_RC=$?"
grep -E '^# (pass|fail|tests|suites)' /tmp/t4-tests.log | head -6
grep -E '^not ok' /tmp/t4-tests.log | head -5

export FORMAL_PORTABLE_ROOT="$BUNDLE"
export FORMAL_PORTABLE_RUNNER_SHA256="$RUNNER_SHA"
CLI=("packages/runner/js/cli.mjs")

echo "===== S2: portfolio list (read-only discovery) ====="
"$NODE" "${CLI[@]}" portfolio list > /tmp/plist.json 2>/tmp/plist.err
echo "LIST_RC=$? status=$(grep -o '"status": "[^"]*"' /tmp/plist.json | head -1) tools=$(grep -c '"id":' /tmp/plist.json)"
grep -c '"t5_status": "NOT_QUALIFIED"' /tmp/plist.json

echo "===== S3: portfolio describe minizinc (raw argv must stay forbidden) ====="
"$NODE" "${CLI[@]}" portfolio describe minizinc 2>/dev/null | grep -E '"raw_argv_allowed"|"operations"|"expected_version"|"execution_adapter"'

echo "===== S4: portfolio inspect (SHA-pinned discovery, no execution) ====="
"$NODE" "${CLI[@]}" portfolio inspect minizinc > /tmp/pins-minizinc.json 2>&1
echo "INSPECT_RC=$?"
grep -E '"status"|"metadata_sha256"|"fixture_contract_sha256"|"packaged_version"|"packaged_kind"' /tmp/pins-minizinc.json
"$NODE" "${CLI[@]}" portfolio inspect alloy 2>/dev/null | grep -E '"status"|"packaged_version"'

echo "===== S5: fail-closed negatives ====="
env -u FORMAL_PORTABLE_ROOT -u FORMAL_PORTABLE_RUNNER_SHA256 "$NODE" "${CLI[@]}" portfolio inspect minizinc 2>/dev/null | grep '"status"'
FORMAL_PORTABLE_RUNNER_SHA256=0000000000000000000000000000000000000000000000000000000000000000 \
  "$NODE" "${CLI[@]}" portfolio inspect minizinc 2>/dev/null | grep -E '"status"|"reason"' | head -3
"$NODE" "${CLI[@]}" portfolio verify z3 2>/dev/null | grep -E '"status"|"reason"' | head -3

echo "===== S6: portfolio verify fixture (real execution, T4 technical scope) ====="
"$NODE" "${CLI[@]}" portfolio verify minizinc > /tmp/pgate-minizinc.json 2>&1
echo "GATE_MINIZINC_RC=$?"
grep -E '"status"|"receipt_sha256"|"elapsed_ms"|"exit_code"' /tmp/pgate-minizinc.json | head -6
grep -E '"phase"|"exit_code"|"label"' /tmp/pgate-minizinc.json | head -12
"$NODE" "${CLI[@]}" portfolio verify alloy > /tmp/pgate-alloy.json 2>&1
echo "GATE_ALLOY_RC=$?"
grep -E '"status"|"receipt_sha256"' /tmp/pgate-alloy.json | head -3
grep -E '"phase"|"label"' /tmp/pgate-alloy.json | head -12

echo "===== S7: portfolio doctor (executed, never promoted to T3) ====="
"$NODE" "${CLI[@]}" portfolio doctor minizinc 2>/dev/null | grep -E '"status"|"exit_code"' | head -3

echo "===== DONE ====="
