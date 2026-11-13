#!/usr/bin/env bash
# I24 host probes: timeout enforcement + exit-code propagation through the REAL
# delivered tool-runner, in a fresh offline debian:13 container context.
# Runs on CC-LAN200 (host side prepares files; execution happens in-container).
set -uo pipefail
MIN=/home/cc/formal-tools-build/out/bundle/i24-min
EV=/home/cc/formal-tools-build/i24-ev
mkdir -p "$EV"

# --- mock tools exercising runner timeout & propagation semantics ---
rm -rf "$MIN/tools/mockslow" "$MIN/tests/mockslow" "$MIN/tools/mockexit7" "$MIN/tests/mockexit7" "$MIN/tools/badmeta" "$MIN/tests/badmeta"

mk_tool() { # id run_body expect_extra
  local id=$1 body=$2 extra=$3
  mkdir -p "$MIN/tools/$id" "$MIN/tests/$id"
  printf 'TOOL_ID=%s\nTOOL_VERSION=0.0-probe\nTOOL_KIND=mock\nTOOL_MAIN_BIN=\nUNAVAILABLE=0\n' "$id" > "$MIN/tools/$id/meta.sh"
  printf '#!/bin/sh\n%s\n' "$body" > "$MIN/tools/$id/run"
  chmod +x "$MIN/tools/$id/run"
  printf "EXPECT_POS_ARGS=''\nEXPECT_POS_EXIT=0\nEXPECT_POS_REGEX='^SAT'\nEXPECT_POS_LABEL=SAT\n%s\n" "$extra" > "$MIN/tests/$id/expect.sh"
}

mk_tool mockslow 'sleep 30; echo SAT' 'EXPECT_TIMEOUT=2'
mk_tool mockexit7 'echo SAT; exit 7' ''

# badmeta: doctor probe — main_bin points nowhere
mkdir -p "$MIN/tools/badmeta" "$MIN/tests/badmeta"
printf 'TOOL_ID=badmeta\nTOOL_VERSION=0.0-probe\nTOOL_KIND=binary\nTOOL_MAIN_BIN=tools/nothing/exists/here\nUNAVAILABLE=0\n' > "$MIN/tools/badmeta/meta.sh"
printf '#!/bin/sh\nexit 0\n' > "$MIN/tools/badmeta/run"; chmod +x "$MIN/tools/badmeta/run"

run_in_deb13() { # mimic do_verify isolation
  docker run --rm --network none \
    -v /home/cc/formal-tools-build/out/bundle/i24-min:/bundle:ro \
    -v /home/cc/formal-tools-build/i24-ev:/evidence \
    -e FT_EVIDENCE_DIR=/evidence -e HOME=/tmp \
    debian:13 /bundle/bin/tool-runner "$@"
}

echo "== P1: timeout enforcement (mockslow, EXPECT_TIMEOUT=2 vs sleep 30) =="
run_in_deb13 verify mockslow >"$EV/probe-timeout.stdout" 2>"$EV/probe-timeout.stderr"
echo "runner_rc=$?"
grep -E 'mockslow/(pos|verdict)' "$EV/verify-mockslow.tsv" 2>/dev/null || cat "$EV/verify-mockslow.tsv" 2>/dev/null

echo "== P2: exit-code must not be swallowed by matching stdout (mockexit7) =="
rm -f "$EV/verify-mockexit7.tsv"
run_in_deb13 verify mockexit7 >"$EV/probe-exit7.stdout" 2>"$EV/probe-exit7.stderr"
echo "runner_rc=$?"
grep -E 'mockexit7/pos|verdict' "$EV/verify-mockexit7.tsv" 2>/dev/null || cat "$EV/verify-mockexit7.tsv" 2>/dev/null

echo "== P3: unknown tool id fails closed =="
run_in_deb13 meta no-such-tool >/dev/null 2>&1; echo "meta_unknown_rc=$?"
run_in_deb13 verify no-such-tool >/dev/null 2>&1; echo "verify_unknown_rc=$?"

echo "== P4: doctor detects missing main_bin =="
run_in_deb13 doctor badmeta >"$EV/probe-doctor.stdout" 2>&1
echo "doctor_badmeta_rc=$?"
grep -E 'binary MISSING|verdict' "$EV/probe-doctor.stdout" | head -3

echo "== P5: list sweep count =="
run_in_deb13 list 2>/dev/null | tail -n +2 | grep -c . || true
