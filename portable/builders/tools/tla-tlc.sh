# builders/tools/tla-tlc.sh — TLA+ TLC model checker (official tla2tools.jar).
# tla2tools is now published via the tlaplus/tlaplus GitHub releases (old tla2tools repo
# and its Maven Central coordinates were retired upstream).
FT_TOOL_ID=tla-tlc
FT_TOOL_VERSION=1.8.0
FT_TOOL_KIND=jar
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://github.com/tlaplus/tlaplus/releases (resolved at build)"
FT_PROBE=(../../runtimes/java21/bin/java -cp tla2tools.jar tlc2.TLC -version)

ft_tool_build() {
  local url
  url=$(ft::gh_url tlaplus/tlaplus latest '^tla2tools\.jar$') || url=""
  [ -n "$url" ] || url="https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar"
  local jar
  jar=$(ft::fetch "$url")
  ft::set_version $(printf '%s' "$url" | grep -oE 'download/v[0-9.]+' | tr -d 'v' | grep -oE '[0-9].*') || true
  [ -z "${FT_TOOL_VERSION:-}" ] && ft::set_version "1.8.0"
  cp "$jar" "$FT_TOOL_DIR/tla2tools.jar"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$PATH"
exec java -XX:+UseParallelGC -cp "$TOOL_DIR/tla2tools.jar" tlc2.TLC "$@"'
}
