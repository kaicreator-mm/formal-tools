# builders/tools/souffle.sh — Soufflé datalog engine (official ubuntu-24.04 deb, unpacked)
FT_TOOL_ID=souffle
FT_TOOL_VERSION=2.5
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/souffle/bin/souffle"
FT_UPSTREAM_URL="https://github.com/souffle-lang/souffle/releases/download/2.5/x86_64-ubuntu-2404-souffle-2.5-Linux.deb"
FT_PROBE=(bin/souffle --version)

ft_tool_build() {
  local deb; deb=$(ft::fetch "$FT_UPSTREAM_URL")
  # upstream publishes sha512sum.txt asset (not sibling URL) — verify explicitly
  local sums
  sums=$(curl -fsSL --retry 3 "https://github.com/souffle-lang/souffle/releases/download/2.5/sha512sum.txt") \
    || ft::note sha_verification "sha512sum.txt fetch failed (computed-only)"
  if [ -n "${sums:-}" ]; then
    local g512; g512=$(sha512sum "$deb" | cut -d' ' -f1)
    printf '%s\n' "$sums" | grep -q "$g512" || ft::die "sha512 not in upstream sha512sum.txt"
    ft::note sha_verified upstream-sha512sum.txt
  fi
  ft::deb_extract "$deb" /tmp/soufflex
  local binp; binp=$(find /tmp/soufflex -type f -name souffle | head -1)
  [ -n "$binp" ] || ft::die "souffle binary not found in deb"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp "$binp" "$FT_TOOL_DIR/bin/souffle"
  # souffle shells out to a C preprocessor (mcpp or gcc) — ship mcpp, it is tiny
  apt-get update -qq >>"$FT_LOG" 2>&1 || true
  apt-get install -y -qq --no-install-recommends mcpp >>"$FT_LOG" 2>&1 || ft::die "mcpp install failed (souffle preprocessor)"
  cp /usr/bin/mcpp "$FT_TOOL_DIR/bin/mcpp"
  ft::copy_libs "$FT_TOOL_DIR/bin/souffle" "$FT_TOOL_DIR/lib" || true
  patchelf --set-rpath '$ORIGIN/../lib' "$FT_TOOL_DIR/bin/souffle" 2>/dev/null || true
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$TOOL_DIR/bin:$PATH"
exec "$TOOL_DIR/bin/souffle" "$@"'
}
