# builders/tools/prob.sh — ProB model checker (prob-cli Linux bundle).
# Official distribution channel: stups.hhu-hosting.de (HHU Stups), directory-indexed
# release area — no form gating. GitHub repo hhu-stups/prob does not publish release assets.
FT_TOOL_ID=prob
FT_TOOL_VERSION=1.16.1
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://stups.hhu-hosting.de/downloads/prob/cli/releases/1.16.1/probcli_linux64.zip"
FT_PROBE=(bin/probcli -version)

ft_tool_build() {
  local f
  f=$(ft::fetch "$FT_UPSTREAM_URL") || ft::unavailable "probcli_linux64.zip unreachable at stups.hhu-hosting.de"
  ft::extract "$f" /tmp/probx
  local src
  src=$(dirname "$(find /tmp/probx -type f -name probcli | head -1)")
  [ -n "$src" ] || ft::unavailable "probcli binary not found in bundle"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp -a "$src/." "$FT_TOOL_DIR/bin/"
  # zip payloads do not preserve the exec bit
  find "$FT_TOOL_DIR/bin" -maxdepth 1 -type f -exec chmod +x {} +
  # version probe (records actual; expects the fetched series)
  local v
  v=$( ( cd "$FT_TOOL_DIR/bin" && ./probcli -version 2>/dev/null | head -1 ) || true)
  [ -n "$v" ] && ft::note prob_version_line "$v"
  FT_TOOL_VERSION=$(printf '%s' "$v" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "$FT_TOOL_VERSION")
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$TOOL_DIR/bin:$PATH"
export PROB_HOME="$TOOL_DIR"
exec "$TOOL_DIR/bin/probcli" "$@"'
}
