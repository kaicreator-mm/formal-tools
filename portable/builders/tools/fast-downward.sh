# builders/tools/fast-downward.sh — Fast Downward classical planner (source build from official repo).
FT_TOOL_ID=fast-downward
FT_TOOL_VERSION=24.06
FT_TOOL_KIND=bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="resolved at build (aibasel/downward)"
FT_PROBE=(fast-downward.py --help)

ft_tool_build() {
  local tgz=""
  for u in \
    "https://gitlab.com/aibasel/downward/-/archive/main/downward-main.tar.gz" \
    "https://github.com/aibasel/downward/archive/refs/heads/main.tar.gz" \
    "https://codeload.github.com/aibasel/downward/tar.gz/refs/heads/main"; do
    tgz=$(ft::fetch "$u" 2>/dev/null) && break
  done
  [ -n "$tgz" ] || ft::unavailable "downward source unreachable (gitlab.com + github mirror both failed)"
  ft::extract "$tgz" /tmp/fdx
  local src; src=$(find /tmp/fdx -maxdepth 1 -type d -name 'downward*' | head -1)
  [ -n "$src" ] || ft::die "downward source dir not found"
  local commit
  commit=$( (cd "$src" && git rev-parse HEAD 2>/dev/null) || sha256sum "$tgz" | cut -d' ' -f1)
  ft::note downward_source_ref "$commit"
  ( cd "$src" && python3 build.py release >>"$FT_LOG" 2>&1 ) || ft::die "downward build.py failed"
  cp -a "$src" "$FT_TOOL_DIR/payload"
  ( cd "$FT_TOOL_DIR" && cp "$FT_TOOL_DIR/payload/fast-downward.py" . 2>/dev/null || true )
  [ -x "$FT_TOOL_DIR/payload/builds/release/bin/downward" ] || ft::die "downward binary missing after build"
  ft::make_shim 'export PATH="$TOOL_DIR/payload/builds/release/bin:$PATH"
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$TOOL_DIR/payload/fast-downward.py" --build=release "$@"'
}
