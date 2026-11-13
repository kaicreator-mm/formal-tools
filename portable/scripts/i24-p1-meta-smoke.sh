#!/usr/bin/env bash
# I24 P1 regression: unit smoke for restored portable/builders/make_meta.py
# Runs on CC-LAN200 host (python3). Exit 0 = all checks pass; nonzero = first failure.
set -uo pipefail
MM=/home/cc/formal-tools-build/src/portable/builders/make_meta.py
WORK=$(mktemp -d /home/cc/formal-tools-build/p1-smoke.XXXX)
PASS=0; FAIL=0
ck() { # ck <label> <expected_rc> <actual_rc> [extra_assert_file]
  local label=$1 want=$2 got=$3
  if [ "$want" = "$got" ]; then PASS=$((PASS+1)); echo "PASS  $label (rc=$got)";
  else FAIL=$((FAIL+1)); echo "FAIL  $label (want rc=$want got rc=$got)"; fi
}
ckc() { # ckc <label> <grep_pattern> <file>
  if grep -qE "$2" "$3" 2>/dev/null; then PASS=$((PASS+1)); echo "PASS  $1";
  else FAIL=$((FAIL+1)); echo "FAIL  $1 (pattern not found: $2)"; fi
}
echo "== smoke workdir: $WORK =="

# --- 1. happy path: available binary tool, all M_* set ---
export M_TOOL_ID=z3 M_TOOL_VERSION=5.4.0 M_TOOL_KIND=binary M_MAIN_BIN=tools/z3/bin/z3
export M_GLIBC_MAX=2.38 M_ELF_ARCH="Advanced" M_NEEDED="libm.so.6,libc.so.6"
export M_VERSION_OUTPUT="z3 5.4.0 - 64 bit (with spaces & (parens))" M_UPSTREAM_URL=https://github.com/Z3Prover/z3
export M_UPSTREAM_NOTE="pinned" M_BUILD_TS=2026-11-13T00:00:00Z
unset M_UNAVAILABLE M_REASON || true
mkdir -p "$WORK/z3"
python3 "$MM" "$WORK/z3" >/dev/null 2>"$WORK/z3.err"; ck "happy-path rc=0" 0 "$?"
ckc "meta.sh TOOL_ID"        '^TOOL_ID=z3$'                "$WORK/z3/meta.sh"
ckc "meta.sh TOOL_VERSION"   '^TOOL_VERSION=5\.4\.0$'      "$WORK/z3/meta.sh"
ckc "meta.sh TOOL_KIND"      '^TOOL_KIND=binary$'          "$WORK/z3/meta.sh"
ckc "meta.sh TOOL_MAIN_BIN"  '^TOOL_MAIN_BIN=tools/z3/bin/z3$' "$WORK/z3/meta.sh"
ckc "meta.sh TOOL_GLIBC_MAX" '^TOOL_GLIBC_MAX=2\.38$'      "$WORK/z3/meta.sh"
ckc "meta.sh TOOL_ELF_ARCH quoted" '^TOOL_ELF_ARCH=Advanced$' "$WORK/z3/meta.sh"
ckc "meta.sh UNAVAILABLE=0"  '^UNAVAILABLE=0$'             "$WORK/z3/meta.sh"
if grep -qE '^TOOL_TOOL_ID=' "$WORK/z3/meta.sh"; then FAIL=$((FAIL+1)); echo "FAIL  no TOOL_TOOL_ID double-prefix"; else PASS=$((PASS+1)); echo "PASS  no TOOL_TOOL_ID double-prefix"; fi
if grep -qE '^VERSION=' "$WORK/z3/meta.sh"; then FAIL=$((FAIL+1)); echo "FAIL  no bare VERSION key"; else PASS=$((PASS+1)); echo "PASS  no bare VERSION key"; fi
python3 - "$WORK/z3/meta.json" <<'PYEOF'
import json,sys
m=json.load(open(sys.argv[1]))
assert m["tool_id"]=="z3" and m["version"]=="5.4.0" and m["kind"]=="binary"
assert m["unavailable"] is False and m["unavailable_reason"] is None
assert m["target"]=={"os":"debian-13","arch":"x86_64","glibc_max":"2.41"}
assert m["version_output"]=="z3 5.4.0 - 64 bit (with spaces & (parens))"
assert m["needed_libs"]=="libm.so.6,libc.so.6"
print("PASS  meta.json fields round-trip")
PYEOF
ck "meta.json round-trip rc=0" 0 "$?"

# --- key-set parity with deployed contract ---
diff <(grep -oE '^[A-Z_]+=' "$WORK/z3/meta.sh" | sort) \
     <(grep -oE '^[A-Z_]+=' /home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64/tools/z3/meta.sh | sort) \
  >/dev/null 2>&1; ck "meta.sh key set == deployed z3 contract" 0 "$?"

# --- 2. quoting: value with single quote / spaces survives shlex.quote ---
export M_TOOL_VERSION="1.2.3-beta it's"
mkdir -p "$WORK/q"; python3 "$MM" "$WORK/q" >/dev/null 2>&1; ck "quoting rc=0" 0 "$?"
# CPython shlex.quote embeds single quotes as '"'"' (functional correctness
# proven by the source round-trip check below; this pins the exact bytes).
if grep -qF "TOOL_VERSION='1.2.3-beta it'\"'\"'s'" "$WORK/q/meta.sh"; then PASS=$((PASS+1)); echo "PASS  TOOL_VERSION quoted safely";
else FAIL=$((FAIL+1)); echo "FAIL  TOOL_VERSION quoted safely"; fi

# --- 3. fail-closed cases ---
mkdir -p "$WORK/f1"
env -u M_TOOL_ID -u M_TOOL_VERSION -u M_TOOL_KIND -u M_BUILD_TS python3 "$MM" "$WORK/f1" >/dev/null 2>&1
ck "missing all required env -> rc=1" 1 "$?"
M_TOOL_ID=x M_TOOL_VERSION= M_TOOL_KIND=binary M_BUILD_TS=T python3 "$MM" "$WORK/f1" >/dev/null 2>&1
ck "empty M_TOOL_VERSION -> rc=1" 1 "$?"
python3 "$MM" >/dev/null 2>&1; ck "missing argv -> rc=2" 2 "$?"
python3 "$MM" "$WORK/does-not-exist" >/dev/null 2>&1; ck "bad tool_dir -> rc=1" 1 "$?"
mkdir -p "$WORK/f2"
M_TOOL_ID=x M_TOOL_VERSION=1 M_TOOL_KIND=binary M_BUILD_TS=T M_UNAVAILABLE=1 python3 "$MM" "$WORK/f2" >/dev/null 2>&1
ck "M_UNAVAILABLE=1 without M_REASON -> rc=1" 1 "$?"

# --- 4. unavailable path recorded, not failed ---
mkdir -p "$WORK/u1"
M_TOOL_ID=nuxmv M_TOOL_VERSION=2.2.0 M_TOOL_KIND=binary M_MAIN_BIN= M_BUILD_TS=T \
  M_UNAVAILABLE=1 M_REASON="upstream fetch 404" python3 "$MM" "$WORK/u1" >/dev/null 2>&1
ck "unavailable rc=0" 0 "$?"
ckc "unavailable UNAVAILABLE=1" '^UNAVAILABLE=1$' "$WORK/u1/meta.sh"
python3 - "$WORK/u1/meta.json" <<'PYEOF'
import json,sys
m=json.load(open(sys.argv[1]))
assert m["unavailable"] is True and m["unavailable_reason"]=="upstream fetch 404"
print("PASS  unavailable meta.json round-trip")
PYEOF
ck "unavailable meta.json rc=0" 0 "$?"

# --- 5. runner consumes produced meta.sh (source + read TOOL_VERSION) ---
cat > "$WORK/src-test.sh" <<'EOF'
set -a
. "$1/meta.sh"
set +a
[ "$TOOL_VERSION" = "1.2.3-beta it's" ] && [ "$TOOL_ID" = z3 ] && [ "$TOOL_KIND" = binary ]
EOF
bash "$WORK/src-test.sh" "$WORK/q" >/dev/null 2>&1
ck "meta.sh sources cleanly (runner tool_meta path)" 0 "$?"

echo "== RESULT: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" = 0 ]
