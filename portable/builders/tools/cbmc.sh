# builders/tools/cbmc.sh — CBMC bounded model checker (official ubuntu-24.04 deb, unpacked)
FT_TOOL_ID=cbmc
FT_TOOL_VERSION=6.11.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/cbmc/bin/cbmc"
FT_UPSTREAM_URL="https://github.com/diffblue/cbmc/releases/download/cbmc-6.11.0/ubuntu-24.04-cbmc-6.11.0-Linux.deb"
FT_PROBE=(bin/cbmc --version)

ft_tool_build() {
  local deb; deb=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::deb_extract "$deb" /tmp/cbmcx
  local binp; binp=$(find /tmp/cbmcx -type f -name cbmc | head -1)
  [ -n "$binp" ] || ft::die "cbmc binary not found in deb"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp "$binp" "$FT_TOOL_DIR/bin/cbmc"
  ft::copy_libs "$FT_TOOL_DIR/bin/cbmc" "$FT_TOOL_DIR/lib" || true
  patchelf --set-rpath '$ORIGIN/../lib' "$FT_TOOL_DIR/bin/cbmc" 2>/dev/null || true
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/bin/cbmc" "$@"'
}
