# builders/tools/tree-sitter.sh — pinned native Tree-sitter CLI; no Python binding dependency.
FT_TOOL_ID=tree-sitter
FT_TOOL_VERSION=0.27.2
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/tree-sitter/bin/tree-sitter"
FT_UPSTREAM_URL="https://github.com/tree-sitter/tree-sitter/releases/download/v0.27.2/tree-sitter-linux-x64.gz"
# Hash of the official 0.27.2 Linux x86_64 executable extracted from the
# canonical Drive package. Verify the decompressed executable, not just the
# transport archive (the upstream release does not publish a sibling checksum).
FT_TREE_SITTER_CLI_SHA256=a658dfc7704d6595a3d2f50eba2590f5919ecd54beedf978ba9888ec914fec1f
FT_PROBE=(bin/tree-sitter --version)

ft_tool_build() {
  mkdir -p "$FT_TOOL_DIR/bin"
  if [ -n "${FT_TREE_SITTER_CLI_BIN:-}" ]; then
    [ -f "$FT_TREE_SITTER_CLI_BIN" ] || ft::die "FT_TREE_SITTER_CLI_BIN is not a regular file"
    install -m 0755 -- "$FT_TREE_SITTER_CLI_BIN" "$FT_TOOL_DIR/bin/tree-sitter"
    ft::note "binary_source" "caller-supplied canonical offline executable; executable SHA-256 pinned"
  else
    local gz
    gz=$(ft::fetch "$FT_UPSTREAM_URL")
    gunzip -c "$gz" > "$FT_TOOL_DIR/bin/tree-sitter"
    chmod 0755 "$FT_TOOL_DIR/bin/tree-sitter"
    ft::note "binary_source" "official upstream v0.27.2 Linux x86_64 release asset"
  fi

  local got version_output
  got=$(sha256sum "$FT_TOOL_DIR/bin/tree-sitter" | cut -d' ' -f1)
  [ "$got" = "$FT_TREE_SITTER_CLI_SHA256" ] || ft::die "Tree-sitter executable SHA-256 mismatch: got=$got"
  ft::note "binary_sha256" "$got"
  ft::note "binary_sha_verified" "canonical-official-release-executable"

  version_output=$("$FT_TOOL_DIR/bin/tree-sitter" --version 2>&1) \
    || ft::die "tree-sitter CLI version probe failed: $version_output"
  [ "$version_output" = "tree-sitter 0.27.2" ] \
    || ft::die "tree-sitter CLI version mismatch: $version_output"
  ft::note "version_output" "$version_output"
  ft::note "verification_route" "native CLI fixed grammar POS/NEG/ERR; Python binding not required"

  # The admitted fixture is CLI-only. The CLI compiles parser.c and writes its
  # cache; the installed portable bundle is read-only, so use the per-runner
  # writable FT_TMP location. No Python runtime or grammar cache is needed.
  ft::make_shim 'if [ -n "${FT_TMP:-}" ]; then
  export XDG_CACHE_HOME="$FT_TMP/tree-sitter-cache"
elif [ -z "${XDG_CACHE_HOME:-}" ]; then
  export XDG_CACHE_HOME="${HOME:-/tmp}/.cache"
fi
mkdir -p "$XDG_CACHE_HOME" || exit 2
exec "$TOOL_DIR/bin/tree-sitter" "$@"'
}
