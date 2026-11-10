#!/usr/bin/env bash
# portable/builders/build-runtimes.sh — runs INSIDE ft-builder container.
# Builds the shared portable runtimes into $FT_OUT/runtimes/:
#   python313  CPython 3.13.5 compiled from source (prefix-independent via PYTHONHOME)
#   node22     official Node.js v22.16.0 linux-x64 tarball
#   java21     Eclipse Temurin 21 JRE (upstream-published sha256)
# Then installs ALL python-tool dependencies into the shared python runtime in one
# resolver pass (py-requirements.txt + py-constraints.txt), so python tool builds
# themselves never touch the shared runtime in parallel.
set -uo pipefail

: "${FT_SRC:?}" "${FT_OUT:?}" "${FT_CACHE:?}"
LOG="$FT_OUT/logs/runtimes.build.log"
mkdir -p "$FT_OUT/runtimes" "$FT_OUT/logs" "$FT_CACHE" /tmp/rt
: > "$LOG"
log() { printf '[%s] %s\n' "$(date -u '+%H:%M:%S')" "$*" | tee -a "$LOG" >&2; }

fetch() { # url [sha256]
  local url="$1" want="${2:-}" f="/tmp/rt/$(basename "${url%%\?*}")"
  if [ -f "$f" ] && [ -f "$f.ok" ]; then echo "$f"; return 0; fi
  log "fetch: $url"
  curl -fSL --retry 3 --retry-delay 3 --connect-timeout 25 -o "$f.part" "$url" || { rm -f "$f.part"; log "FATAL fetch $url"; exit 3; }
  mv "$f.part" "$f"
  local got; got=$(sha256sum "$f" | cut -d' ' -f1)
  log "sha256: $got"
  if [ -n "$want" ]; then
    [ "$got" = "$want" ] || { log "FATAL sha mismatch: got=$got want=$want"; exit 3; }
    log "sha_verified: upstream-pinned"
  fi
  touch "$f.ok"; echo "$f"
}

PYVER=3.13.5
NODEVER=22.16.0
# Eclipse Temurin 21 JRE — URL + sha256 as published by the Adoptium API (assets/latest/21/hotspot)
JAVA_URL="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_linux_hotspot_21.0.13_9.tar.gz"
JAVA_SHA="a535a1df9c6284d9618872984e026ae0352d1f7e9e0605425c0e6114f47351dd"

log "== python313: compile CPython $PYVER =="
if [ ! -x "$FT_OUT/runtimes/python313/bin/python3.13" ]; then
  p=$(fetch "https://www.python.org/ftp/python/$PYVER/Python-$PYVER.tgz")
  rm -rf /tmp/rt/Python-$PYVER && tar -xzf "$p" -C /tmp/rt
  ( cd /tmp/rt/Python-$PYVER \
    && ./configure --prefix=/opt/py313 --with-ensurepip=install >>"$LOG" 2>&1 \
    && make -j"$(nproc)" >>"$LOG" 2>&1 \
    && make install DESTDIR=/tmp/rt/pystage >>"$LOG" 2>&1 ) || { log "FATAL python build (see $LOG)"; exit 3; }
  mkdir -p "$FT_OUT/runtimes/python313"
  cp -a /tmp/rt/pystage/opt/py313/. "$FT_OUT/runtimes/python313/"
fi
PY="$FT_OUT/runtimes/python313/bin/python3.13"
export PYTHONHOME="$FT_OUT/runtimes/python313"
export PYTHONNOUSERSITE=1
"$PY" -s -c 'import ssl, sqlite3, ctypes, zlib, bz2, lzma, hashlib; print("PYOK", __import__("sys").version)' \
  || { log "FATAL python relocation self-test failed"; exit 3; }
"$PY" -s -m pip --version >>"$LOG" 2>&1 || { log "FATAL pip missing"; exit 3; }
log "python313 OK"

log "== java21: Temurin JRE =="
if [ ! -x "$FT_OUT/runtimes/java21/bin/java" ]; then
  j=$(fetch "$JAVA_URL" "$JAVA_SHA")
  rm -rf /tmp/rt/java && mkdir -p /tmp/rt/java && tar -xzf "$j" -C /tmp/rt/java
  srcdir=$(find /tmp/rt/java -maxdepth 1 -type d -name 'jdk-21*' | head -1)
  mkdir -p "$FT_OUT/runtimes/java21"
  cp -a "$srcdir/." "$FT_OUT/runtimes/java21/"
fi
"$FT_OUT/runtimes/java21/bin/java" -version >>"$LOG" 2>&1 || { log "FATAL java runtime broken"; exit 3; }
log "java21 OK"

log "== node22: official tarball =="
if [ ! -x "$FT_OUT/runtimes/node22/bin/node" ]; then
  n=$(fetch "https://nodejs.org/dist/v$NODEVER/node-v$NODEVER-linux-x64.tar.xz")
  curl -fsSL "https://nodejs.org/dist/v$NODEVER/SHASUMS256.txt" -o /tmp/rt/SHASUMS256.txt
  got=$(sha256sum "$n" | cut -d' ' -f1)
  grep -qE "^$got  node-v$NODEVER-linux-x64.tar.xz$" /tmp/rt/SHASUMS256.txt \
    || { log "FATAL node sha mismatch vs SHASUMS256.txt"; exit 3; }
  log "sha_verified: nodejs-SHASUMS256"
  rm -rf /tmp/rt/node && mkdir -p /tmp/rt/node && tar -xJf "$n" -C /tmp/rt/node
  mkdir -p "$FT_OUT/runtimes/node22"
  cp -a /tmp/rt/node/node-v$NODEVER-linux-x64/. "$FT_OUT/runtimes/node22/"
fi
"$FT_OUT/runtimes/node22/bin/node" --version >>"$LOG" 2>&1 || { log "FATAL node runtime broken"; exit 3; }
log "node22 OK"

log "== python tool dependencies: single resolver pass =="
# All python-library tools share one site-packages; one resolve keeps versions consistent.
# A failing optional group is retried without that group and recorded honestly.
PY="$FT_OUT/runtimes/python313/bin/python3.13"
export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1 PIP_CACHE_DIR="$FT_CACHE/pip" PIP_DISABLE_PIP_VERSION_CHECK=1
REQ="$FT_SRC/builders/py-requirements.txt"
CONS="$FT_SRC/builders/py-constraints.txt"
if ! "$PY" -s -m pip install --prefix "$FT_OUT/runtimes/python313" --constraint "$CONS" -r "$REQ" >>"$LOG" 2>&1; then
  log "WARN: full requirement set failed; retrying core then optional groups individually"
  # core numeric/plot stack first (most tools depend on it)
  "$PY" -s -m pip install --prefix "$FT_OUT/runtimes/python313" --constraint "$CONS" \
      numpy scipy pandas networkx sympy matplotlib joblib scikit-learn statsmodels patsy \
      >>"$LOG" 2>&1 || { log "FATAL core python stack failed"; exit 3; }
  for grp in "ortools highspy hypothesis pyshacl" "dowhy" "pymc" "causal-learn" "simpy mesa"; do
    if ! "$PY" -s -m pip install --prefix "$FT_OUT/runtimes/python313" --constraint "$CONS" $grp >>"$LOG" 2>&1; then
      log "GROUP_FAILED: $grp"
      printf 'GROUP_FAILED\t%s\n' "$grp" >> "$FT_OUT/receipts/py-deps.events"
    else
      printf 'GROUP_OK\t%s\n' "$grp" >> "$FT_OUT/receipts/py-deps.events"
    fi
  done
else
  printf 'FULL_RESOLVE_OK\tall\n' >> "$FT_OUT/receipts/py-deps.events"
fi
# smoke: import every python tool lib through the relocation entry
for m in sympy networkx ortools highspy hypothesis pyshacl dowhy pymc causallearn simpy mesa; do
  if "$PY" -s -c "import $m" 2>>"$LOG"; then
    printf 'IMPORT_OK\t%s\n' "$m" >> "$FT_OUT/receipts/py-deps.events"
  else
    printf 'IMPORT_FAILED\t%s\n' "$m" >> "$FT_OUT/receipts/py-deps.events"
    log "IMPORT_FAILED: $m"
  fi
done
log "runtimes build complete"
