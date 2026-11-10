# builders/tools/tree-sitter.sh — tree-sitter CLI (official static release binary) +
# python binding with bundled grammars (tree-sitter-language-pack) for real parse verification.
# The CLI alone cannot parse without a compiled grammar; verification exercises the
# tree-sitter core through the python binding (same upstream project, real parsing).
FT_TOOL_ID=tree-sitter
FT_TOOL_VERSION=0.27.2
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/tree-sitter/bin/tree-sitter"
FT_UPSTREAM_URL="https://github.com/tree-sitter/tree-sitter/releases/download/v0.27.2/tree-sitter-linux-x64.gz"
FT_PROBE=(bin/tree-sitter --version)

ft_tool_build() {
  local gz; gz=$(ft::fetch "$FT_UPSTREAM_URL")
  mkdir -p "$FT_TOOL_DIR/bin"
  gunzip -c "$gz" > "$FT_TOOL_DIR/bin/tree-sitter"
  chmod +x "$FT_TOOL_DIR/bin/tree-sitter"
  "$FT_TOOL_DIR/bin/tree-sitter" --version >/dev/null || ft::die "tree-sitter CLI not runnable"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
case "$1" in
  --py) shift; exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@" ;;
  *) exec "$TOOL_DIR/bin/tree-sitter" "$@" ;;
esac'
}
