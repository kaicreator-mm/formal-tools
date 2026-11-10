# builders/tools/storm.sh — Storm probabilistic model checker (official docker image payload).
# The image is extracted host-side by builders/host/storm-prepare.sh (no docker socket in builder);
# staging is at /out/staging/storm/{payload,libs,env}.
FT_TOOL_ID=storm
FT_TOOL_VERSION=1.8.0
FT_TOOL_KIND=bundle
FT_MAIN_BIN="tools/storm/bin/storm"
FT_UPSTREAM_URL="docker://docker.m.daocloud.io/movesrwth/storm:stable"
FT_PROBE=(bin/storm --version)

ft_tool_build() {
  local stage="$FT_OUT/staging/storm"
  [ -f "$stage/env" ] && [ -f "$stage/payload"/* ] || ft::unavailable "storm image payload missing (host prepare failed)"
  # shellcheck disable=SC1091
  . "$stage/env"
  local inner="$stage/payload$STORM_DIR"
  [ -d "$inner" ] || ft::unavailable "staged storm dir missing: $STORM_DIR"
  mkdir -p "$FT_TOOL_DIR/bin" "$FT_TOOL_DIR/lib"
  cp -a "$inner/." "$FT_TOOL_DIR/"
  # normalize: ensure binaries at tools/storm/bin
  if [ ! -x "$FT_TOOL_DIR/bin/storm" ] && [ -x "$FT_TOOL_DIR/inner/bin/storm" ]; then
    cp -a "$FT_TOOL_DIR/inner/." "$FT_TOOL_DIR/" || true
  fi
  [ -x "$FT_TOOL_DIR/bin/storm" ] || ft::unavailable "storm binary not at expected path after staging copy"
  cp -a "$stage/libs/." "$FT_TOOL_DIR/lib/" 2>/dev/null || true
  # version from the binary itself
  local v; v=$("$FT_TOOL_DIR/bin/storm" --version 2>/dev/null | head -1) || v=""
  [ -n "$v" ] && FT_TOOL_VERSION=$(printf '%s' "$v" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  # ldd closure taken from the image already; keep rpath for private libs
  for b in "$FT_TOOL_DIR"/bin/storm "$FT_TOOL_DIR"/bin/storm-*; do
    [ -x "$b" ] && patchelf --set-rpath '$ORIGIN/../lib' "$b" 2>/dev/null || true
  done
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$TOOL_DIR/bin:$PATH"
exec "$TOOL_DIR/bin/storm" "$@"'
}
