# builders/tools/prob.sh — ProB model checker (prob-cli Linux bundle).
# Upstream distribution is the prob.hhu.de / www3.hhu.de CLI bundle; GitHub release listing
# for hhu-stups/prob is not exposed via API. Try the known channels; record honestly if blocked.
FT_TOOL_ID=prob
FT_TOOL_VERSION=1.14.0
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="resolved at build (prob-cli linux64)"
FT_PROBE=(bin/probcli -version)

ft_tool_build() {
  local f=""
  # candidate 1: hhu-stups GitHub release assets (prob-cli)
  for u in \
    "$(ft::gh_url hhu-stups/prob latest 'prob-cli.*linux.*64.*\.(tar\.gz|tgz|zip)' 2>/dev/null)" \
    "$(ft::gh_url hhu-stups/prob_cli latest 'linux64.*\.(tar\.gz|tgz)' 2>/dev/null)"; do
    [ -n "$u" ] && f=$(ft::fetch "$u" 2>/dev/null) && break
  done
  # candidate 2: www3.hhu.de stable CLI links
  if [ -z "$f" ]; then
    for v in 1.14.0 1.13.1; do
      for u in "https://www3.hhu.de/stups/downloads/prob/cli/prob-cli-linux64-$v.tar.gz" \
               "https://www3.hhu.de/stups/downloads/prob/cli/prob-cli-$v-linux64.tar.gz"; do
        if f=$(ft::fetch "$u" 2>/dev/null); then FT_TOOL_VERSION="$v"; break 2; fi
      done
    done
  fi
  [ -n "$f" ] || ft::unavailable "no reachable official prob-cli linux64 download channel (GitHub release API empty; www3 patterns 404) — needs manual license/download page interaction"
  case "$f" in
    *.zip) ft::extract "$f" /tmp/probx ;;
    *) ft::extract "$f" /tmp/probx ;;
  esac
  local src; src=$(find /tmp/probx -maxdepth 2 -type f -name probcli | head -1)
  [ -n "$src" ] || ft::unavailable "probcli binary not found in downloaded bundle"
  local bindir; bindir=$(dirname "$src")
  mkdir -p "$FT_TOOL_DIR/bin" "$FT_TOOL_DIR/lib"
  cp -a "$bindir/." "$FT_TOOL_DIR/bin/"
  cp -a "$(dirname "$bindir")/lib/." "$FT_TOOL_DIR/lib/" 2>/dev/null || true
  # version probe
  local v; v=$( (cd "$FT_TOOL_DIR/bin" && ./probcli -version 2>/dev/null | head -1) || true)
  [ -n "$v" ] && ft::note prob_version_line "$v"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$TOOL_DIR/bin:$PATH"
export PROB_HOME="$TOOL_DIR"
exec "$TOOL_DIR/bin/probcli" "$@"'
}
