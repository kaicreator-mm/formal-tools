# builders/tools/elk.sh — ELK OWL reasoner (official CLI distribution zip, liveontologies)
FT_TOOL_ID=elk
FT_TOOL_VERSION=0.6.0
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://github.com/liveontologies/elk-reasoner/releases/download/v0.6.0/elk-distribution-cli-0.6.0.zip"
FT_PROBE=()

ft_tool_build() {
  local zip; zip=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$zip" /tmp/elkx
  local src; src=$(find /tmp/elkx -maxdepth 1 -type d | grep -v '/tmp/elkx$' | head -1)
  [ -n "$src" ] || src=/tmp/elkx
  cp -a "$src/." "$FT_TOOL_DIR/"
  # locate the CLI main jar + Main-Class
  local clijar maincls
  clijar=$(find "$FT_TOOL_DIR" -name '*cli*.jar' ! -name '*javadoc*' ! -name '*sources*' | head -1)
  [ -n "$clijar" ] || clijar=$(find "$FT_TOOL_DIR" -name '*.jar' ! -name '*javadoc*' ! -name '*sources*' | head -1)
  [ -n "$clijar" ] || ft::die "no cli jar in elk distribution"
  maincls=$(unzip -p "$clijar" META-INF/MANIFEST.MF 2>/dev/null | tr -d '\r' | grep -i '^Main-Class:' | sed 's/^Main-Class:[[:space:]]*//')
  ft::note elk_cli_jar "$(basename "$clijar")"
  ft::note elk_main_class "${maincls:-unknown}"
  cp "$clijar" "$FT_TOOL_DIR/elk-cli.jar"
  [ -n "$maincls" ] || ft::die "no Main-Class in elk cli jar"
  MAINCLS="$maincls" ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$PATH"
exec java -cp "$TOOL_DIR/elk-cli.jar:$TOOL_DIR/lib/*" '"$maincls"' "$@"'
}
