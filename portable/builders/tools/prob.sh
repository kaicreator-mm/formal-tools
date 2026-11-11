# builders/tools/prob.sh — ProB model checker (SICStus full distribution from HHU).
# Channel: stups.hhu-hosting.de/models/Reals/ProB_SICStus4.10_RealFloatSolver/ProB.linux64.tar.gz
# (direct, no form). The full SICStus distribution INCLUDES lib/probcliparser.jar —
# unlike the slim probcli zips which abort without it.
FT_TOOL_ID=prob
FT_TOOL_VERSION=4.10
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://stups.hhu-hosting.de/models/Reals/ProB_SICStus4.10_RealFloatSolver/ProB.linux64.tar.gz"
FT_PROBE=(probcli -version)

ft_tool_build() {
  local f
  f=$(ft::fetch "$FT_UPSTREAM_URL") || ft::unavailable "ProB.linux64.tar.gz unreachable at stups.hhu-hosting.de"
  ft::extract "$f" /tmp/probx
  local src; src=$(find /tmp/probx -maxdepth 1 -type d -name 'ProB' | head -1)
  [ -n "$src" ] || ft::die "ProB dir not found in tarball"
  cp -a "$src/." "$FT_TOOL_DIR/"
  # zips/tarballs may lose exec bits on some payloads
  find "$FT_TOOL_DIR" -maxdepth 2 -type f -name 'probcli' -exec chmod +x {} + 2>/dev/null || true
  [ -f "$FT_TOOL_DIR/lib/probcliparser.jar" ] || ft::die "probcliparser.jar missing (incomplete distribution)"
  local v
  v=$( ( cd "$FT_TOOL_DIR" && ./probcli -version 2>/dev/null | head -1 ) || true)
  [ -n "$v" ] && ft::note prob_version_line "$v"
  ft::set_version $(printf '%s' "$v" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) || ft::set_version "sicstus-4.10"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$TOOL_DIR:$PATH"
export PROB_HOME="$TOOL_DIR"
export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/probcli" "$@"'
}
