# builders/tools/z3.sh — Z3 SMT solver (official release binary, glibc-2.39 build)
FT_TOOL_ID=z3
FT_TOOL_VERSION=5.4.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/z3/bin/z3"
FT_UPSTREAM_URL="https://github.com/Z3Prover/z3/releases/download/z3-5.4.0/z3-5.4.0-x64-glibc-2.39.zip"
FT_PROBE=(bin/z3 --version)

ft_tool_build() {
  local zip; zip=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$zip" /tmp/z3x
  local binp; binp=$(find /tmp/z3x -type f -name z3 | head -1)
  [ -n "$binp" ] || ft::die "z3 binary not found in release zip"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp "$binp" "$FT_TOOL_DIR/bin/z3"
  chmod +x "$FT_TOOL_DIR/bin/z3"
  ft::make_shim 'exec "$TOOL_DIR/bin/z3" "$@"'
}
