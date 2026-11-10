# portable/builders/lib.sh — shared helpers for per-tool builders.
# Runs INSIDE the ft-builder container (debian:13 + toolchains).
# Required env: FT_TOOL_ID, FT_SRC (mounted /src), FT_OUT (mounted /out), FT_CACHE (mounted /cache)
# Each tool spec (builders/tools/<id>.sh) sets FT_TOOL_VERSION/FT_TOOL_KIND/FT_MAIN_BIN/FT_PROBE
# and defines ft_tool_build(). Scripts are driven by builders/build-tool.sh.

set -uo pipefail

FT_TOOL_DIR="${FT_OUT}/tools/${FT_TOOL_ID}"
FT_LOG="${FT_LOG:-${FT_OUT}/logs/${FT_TOOL_ID}.build.log}"
mkdir -p "$FT_TOOL_DIR" "$FT_OUT/receipts" "$FT_OUT/logs" "$FT_CACHE" /tmp/ft-work
FT_EV_FILE="$FT_OUT/receipts/build-${FT_TOOL_ID}.events"
: > "$FT_EV_FILE"

ft::log() { printf '[%s] [%s] %s\n' "$(date -u '+%H:%M:%S')" "$FT_TOOL_ID" "$*" | tee -a "$FT_LOG" >&2; }
ft::die() { ft::log "FATAL: $*"; ft::note build_status FAILED; ft::note failure_reason "$*"; exit 3; }

# Record a provenance event (key TAB value, single-line) into the build evidence stream.
ft::note() {
  printf '%s\t%s\n' "$1" "$(printf '%s' "${2-}" | tr '\t\r\n' '   ')" >> "$FT_EV_FILE"
}

# ---------------------------------------------------------------------------
# Downloads with supply-chain hash accounting.
# ft::fetch <url> [expected_sha256]  -> echoes local file path
#   - expected sha256 given  -> hard verify (mismatch = fatal)
#   - else try sibling <url>.sha256 / .sha512 published by upstream -> verify against it
#   - else record computed sha256 with provenance note "computed-only"
# ---------------------------------------------------------------------------
ft::fetch() {
  local url="$1" want="${2:-}"
  local key base f got
  key=$(printf '%s' "$url" | sha256sum | cut -c1-16)
  base=$(basename "${url%%\?*}")
  f="$FT_CACHE/$key-$base"
  if [ -f "$f" ] && [ -f "$f.ok" ]; then echo "$f"; return 0; fi
  ft::log "fetch: $url"
  if ! curl -fSL --retry 3 --retry-delay 3 --connect-timeout 25 -o "$f.part" "$url"; then
    rm -f "$f.part"; ft::die "download failed: $url"
  fi
  mv "$f.part" "$f"
  # content-type sanity: mirrors behind HTML-SPA frontends may serve 200 with an error page
  case "$base" in
    *.tar.gz|*.tgz|*.tar.xz|*.tar.zst|*.tar.bz2|*.zip|*.jar|*.deb|*.gz)
      if ! file -b "$f" | grep -qiE 'gzip|Zip archive|XZ|Zstandard|POSIX tar|Debian binary'; then
        rm -f "$f"; ft::die "download is not an archive (mirror served HTML?): $url"
      fi ;;
  esac
  got=$(sha256sum "$f" | cut -d' ' -f1)
  ft::note "download_url" "$url"
  ft::note "download_sha256" "$got"
  if [ -n "$want" ]; then
    if [ "$got" != "$want" ]; then ft::die "sha256 mismatch for $url: got=$got want=$want"; fi
    ft::note "sha_verified" "upstream-pinned"
  else
    local g512 ok=0
    if curl -fsSL --retry 2 --connect-timeout 20 "$url.sha256" -o "$f.up.sha256" 2>/dev/null; then
      if grep -qiE "^$got( |$)" "$f.up.sha256" || grep -qE "$got" "$f.up.sha256"; then
        ft::note "sha_verified" "upstream-sibling-sha256"; ok=1
      fi
    fi
    if [ "$ok" = 0 ] && curl -fsSL --retry 2 --connect-timeout 20 "$url.sha512" -o "$f.up.sha512" 2>/dev/null; then
      g512=$(sha512sum "$f" | cut -d' ' -f1)
      if grep -qE "$g512" "$f.up.sha512"; then ft::note "sha_verified" "upstream-sibling-sha512"; ok=1; fi
    fi
    [ "$ok" = 1 ] || ft::note "sha_verified" "computed-only:no-upstream-hash-published"
  fi
  touch "$f.ok"
  echo "$f"
}

# ft::fetch_first "url1" "url2" ... — first URL that downloads successfully (for mirrors/candidates)
ft::fetch_first() {
  local u f
  for u in "$@"; do
    if f=$(ft::fetch "$u" 2>/dev/null); then echo "$f"; return 0; fi
  done
  ft::die "all candidate URLs failed: $*"
}

# ft::gh_url <owner/repo> <tag|latest> <asset-regex> -> echo download URL of first matching asset
ft::gh_url() {
  local repo="$1" tag="$2" re="$3" api
  case "$tag" in
    latest) api="/releases/latest" ;;
    *) api="/releases/tags/$tag" ;;
  esac
  curl -fsSL --retry 3 --connect-timeout 25 "https://api.github.com/repos/$repo/releases$api" \
    | python3 -c '
import json, sys, re
d = json.load(sys.stdin)
pat = re.compile(sys.argv[1])
for a in d.get("assets", []):
    if pat.search(a["name"]):
        print(a["browser_download_url"]); break
' "$re"
}

# ft::extract <archive> <dest>  (tar.gz/tgz/tar.xz/tar.zst/tar.bz2/zip/jar)
ft::extract() {
  local ar="$1" dest="$2"
  mkdir -p "$dest"
  case "$ar" in
    *.tar.zst) tar --zstd -xf "$ar" -C "$dest" ;;
    *.tar.gz|*.tgz) tar -xzf "$ar" -C "$dest" ;;
    *.tar.xz|*.txz) tar -xJf "$ar" -C "$dest" ;;
    *.tar.bz2) tar -xjf "$ar" -C "$dest" ;;
    *.tar) tar -xf "$ar" -C "$dest" ;;
    *.zip|*.jar) unzip -qo "$ar" -d "$dest" ;;
    *.deb) ft::die "use ft::deb_extract for debs" ;;
    *) tar -xf "$ar" -C "$dest" 2>/dev/null || ft::die "unknown archive type: $ar" ;;
  esac
}

# ft::deb_extract <deb> <dest> — unpack a .deb without dpkg install
ft::deb_extract() {
  local deb="$1" dest="$2"
  mkdir -p "$dest"
  dpkg-deb -x "$deb" "$dest"
}

# ft::copy_libs <executable> <libdir> — copy non-glibc-core shared library deps (libstdc++, etc.)
ft::copy_libs() {
  local bin="$1" libdir="$2"
  mkdir -p "$libdir"
  ldd "$bin" 2>/dev/null | awk '/=> \//{print $3} /^[[:space:]]*\//{print $1}' | sort -u | while read -r so; do
    [ -n "$so" ] || continue
    case "$so" in
      */libc.so*|*/libm.so*|*/ld-linux*|*/libpthread*|*/libdl*|*/librt*|*/libresolv*) continue ;;
    esac
    cp -Ln "$so" "$libdir/" 2>/dev/null || true
  done
}

# ft::glibc_max <elf> -> e.g. 2.39 (highest GLIBC_x.y symbol version referenced)
ft::glibc_max() {
  readelf -W --dyn-syms "$1" 2>/dev/null | grep -o 'GLIBC_2\.[0-9]\+' | sort -uV | tail -1 | cut -d_ -f2
}

# ft::make_shim "<sh body>" — generate tools/<id>/run (POSIX sh), body may use $FT_ROOT/$TOOL_DIR
ft::make_shim() {
  local body="$1"
  {
    echo '#!/bin/sh'
    echo '# generated by formal-tools portable builders — do not edit'
    echo 'FT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)'
    echo 'TOOL_DIR="$FT_ROOT/tools/'"$FT_TOOL_ID"'"'
    echo "$body"
  } > "$FT_TOOL_DIR/run"
  chmod +x "$FT_TOOL_DIR/run"
}

# ft::pip_install <req...> — install python packages into the SHARED python313 runtime
# (serialized by the orchestrator across python tools; constraints keep the closure consistent)
ft::pip_install() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  [ -x "$PY" ] || ft::die "python313 runtime not built yet"
  export PIP_CACHE_DIR="$FT_CACHE/pip"
  "$PY" -m pip install --no-cache-dir --prefix "$FT_OUT/runtimes/python313" \
      --constraint "$FT_SRC/builders/py-constraints.txt" "$@" \
    || ft::die "pip install failed: $*"
  ft::note "pip_installed" "$*"
}

# ft::require_env <name>...
ft::require_env() {
  local v
  for v in "$@"; do
    eval "[ -n \"\${$v:-}\" ]" || ft::die "missing required env: $v"
  done
}

# ft::unavailable "<reason>" — honest UNAVAILABLE exit (not a failure): no usable official
# download channel / license gate. Reason is recorded in build events + status report.
ft::unavailable() {
  ft::note build_status UNAVAILABLE
  ft::note failure_reason "$1"
  FT_TOOL_UNAVAILABLE=1
  ft::log "UNAVAILABLE: $1"
  exit 0
}
