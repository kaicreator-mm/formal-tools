# builders/tools/vampire.sh — Vampire first-order theorem prover (official release binary)
FT_TOOL_ID=vampire
FT_TOOL_VERSION=5.1.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/vampire/bin/vampire"
FT_UPSTREAM_URL="https://github.com/vprover/vampire/releases/download/v5.1.0/vampire-Linux-X64.zip"
FT_PROBE=(bin/vampire --version)

ft_tool_build() {
  local zip; zip=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$zip" /tmp/vampx
  local binp; binp=$(find /tmp/vampx -type f -name vampire | head -1)
  [ -n "$binp" ] || ft::die "vampire binary not found in release zip"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp "$binp" "$FT_TOOL_DIR/bin/vampire"
  chmod +x "$FT_TOOL_DIR/bin/vampire"
  ft::copy_libs "$FT_TOOL_DIR/bin/vampire" "$FT_TOOL_DIR/lib" || true
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/bin/vampire" "$@"'
}
