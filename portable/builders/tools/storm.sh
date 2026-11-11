# builders/tools/storm.sh — Storm probabilistic model checker (official docker image payload).
# The image is extracted host-side by builders/host/storm-prepare.sh (no docker socket in
# builder); staging lands at /out/staging/storm/{payload/{bin,lib},libs,env}.
FT_TOOL_ID=storm
FT_TOOL_VERSION=2.0.0
FT_TOOL_KIND=bundle
FT_MAIN_BIN="tools/storm/bin/storm"
FT_UPSTREAM_URL="docker://docker.m.daocloud.io/movesrwth/storm:stable"
FT_PROBE=(bin/storm --version)

ft_tool_build() {
  local stage="$FT_OUT/staging/storm"
  [ -f "$stage/env" ] && [ -d "$stage/payload/bin" ] || ft::unavailable "storm image payload missing (host prepare failed)"
  mkdir -p "$FT_TOOL_DIR/bin" "$FT_TOOL_DIR/lib"
  cp -a "$stage/payload/bin/." "$FT_TOOL_DIR/bin/"
  cp -a "$stage/payload/lib/." "$FT_TOOL_DIR/lib/" 2>/dev/null || true
  cp -a "$stage/libs/." "$FT_TOOL_DIR/lib/" 2>/dev/null || true
  [ -x "$FT_TOOL_DIR/bin/storm" ] || ft::unavailable "storm binary missing after staging copy"
  # version from staging env (probed host-side against the image)
  # shellcheck disable=SC1091
  [ -f "$stage/env" ] && . "$stage/env" && [ -n "${STORM_VERSION:-}" ] && FT_TOOL_VERSION="$STORM_VERSION"
  for b in "$FT_TOOL_DIR"/bin/storm*; do
    [ -x "$b" ] && patchelf --set-rpath '$ORIGIN/../lib' "$b" 2>/dev/null || true
  done
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$TOOL_DIR/bin:$PATH"
exec "$TOOL_DIR/bin/storm" "$@"'
}
