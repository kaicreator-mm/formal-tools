# builders/tools/nuxmv.sh — nuXmv symbolic model checker (FBK).
# Distribution is behind a license-acceptance form; probe the known direct URLs and
# record an honest UNAVAILABLE when they are not automatable.
FT_TOOL_ID=nuxmv
FT_TOOL_VERSION=2.1.0
FT_TOOL_KIND=binary
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://nuxmv.fbk.eu/ (license-gated download)"
FT_PROBE=()

ft_tool_build() {
  local f=""
  for u in \
    "https://nuxmv.fbk.eu/releases/nuxmv-2.1.0-linux64.tar.gz" \
    "https://nuxmv.fbk.eu/index.php?page=download&file=nuxmv-2.1.0-linux64.tar.gz" \
    "https://es-static.fbk.eu/tools/nuxmv/index.php?page=download&file=nuxmv-2.1.0-linux64.tar.gz"; do
    if f=$(ft::fetch "$u" 2>/dev/null); then break; fi
  done
  if [ -z "$f" ]; then
    ft::unavailable "nuXmv binaries require manual license acceptance on nuxmv.fbk.eu (form-gated); no automatable official channel — candidates tried all failed"
  fi
  ft::extract "$f" /tmp/nuxmvx
  local binp; binp=$(find /tmp/nuxmvx -type f -name nuXmv | head -1)
  [ -n "$binp" ] || ft::unavailable "nuXmv binary not found in bundle"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp "$binp" "$FT_TOOL_DIR/bin/nuXmv"
  ft::copy_libs "$FT_TOOL_DIR/bin/nuXmv" "$FT_TOOL_DIR/lib" || true
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/bin/nuXmv" "$@"'
}
