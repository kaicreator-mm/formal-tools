# builders/tools/prob.sh — ProB model checker 1.16.1 (SICStus full distribution from HHU).
# Channel: stups.hhu-hosting.de/downloads/prob/tcltk/releases/1.16.1/ProB.linux64.tar.gz
# (direct, no form). The tcltk full distribution INCLUDES lib/probcliparser.jar and a
# valid SICStus runtime — unlike the slim cli zips (no parser jar) and the old
# models/Reals/ProB_SICStus4.10_RealFloatSolver tar (expired time-limited SICStus).
FT_TOOL_ID=prob
FT_TOOL_VERSION=1.16.1
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://stups.hhu-hosting.de/downloads/prob/tcltk/releases/1.16.1/ProB.linux64.tar.gz"
FT_PROBE=(probcli -version)

ft_tool_build() {
  local f
  f=$(ft::fetch "$FT_UPSTREAM_URL") || ft::unavailable "ProB.linux64.tar.gz unreachable at stups.hhu-hosting.de"
  ft::extract "$f" /tmp/probx
  local src; src=$(find /tmp/probx -maxdepth 1 -type d -name 'ProB' | head -1)
  [ -n "$src" ] || ft::die "ProB dir not found in tarball"
  cp -a "$src/." "$FT_TOOL_DIR/"
  find "$FT_TOOL_DIR" -maxdepth 2 -type f -name 'probcli' -exec chmod +x {} + 2>/dev/null || true
  [ -f "$FT_TOOL_DIR/lib/probcliparser.jar" ] || ft::die "probcliparser.jar missing (incomplete distribution)"
  local v
  v=$( ( cd "$FT_TOOL_DIR" && ./probcli -version 2>/dev/null | head -1 ) || true)
  [ -n "$v" ] && ft::note prob_version_line "$v"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$TOOL_DIR:$PATH"
export PROB_HOME="$TOOL_DIR"
export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/probcli" "$@"'
}
