# builders/tools/cvc5.sh — cvc5 SMT solver (official STATIC release binary)
FT_TOOL_ID=cvc5
FT_TOOL_VERSION=1.4.2
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/cvc5/bin/cvc5"
FT_UPSTREAM_URL="https://github.com/cvc5/cvc5/releases/download/cvc5-1.4.2/cvc5-Linux-x86_64-static.zip"
FT_PROBE=(bin/cvc5 --version)

ft_tool_build() {
  local zip; zip=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$zip" /tmp/cvc5x
  local binp; binp=$(find /tmp/cvc5x -type f -name cvc5 | head -1)
  [ -n "$binp" ] || ft::die "cvc5 binary not found in release zip"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp "$binp" "$FT_TOOL_DIR/bin/cvc5"
  chmod +x "$FT_TOOL_DIR/bin/cvc5"
  ft::make_shim 'exec "$TOOL_DIR/bin/cvc5" "$@"'
}
