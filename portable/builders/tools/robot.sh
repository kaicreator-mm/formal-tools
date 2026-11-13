# builders/tools/robot.sh — ROBOT ontology CLI (official fat jar)
FT_TOOL_ID=robot
FT_TOOL_VERSION=1.9.11
FT_TOOL_KIND=jar
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://github.com/ontodev/robot/releases/download/v1.9.11/robot.jar"
FT_PROBE=(../../runtimes/java21/bin/java -jar robot.jar --version)

ft_tool_build() {
  local jar; jar=$(ft::fetch "$FT_UPSTREAM_URL")
  cp "$jar" "$FT_TOOL_DIR/robot.jar"
  # resolve bundled reasoners for the receipt
  local reasoners
  reasoners=$(unzip -l "$FT_TOOL_DIR/robot.jar" | grep -oiE '(elk|hermit|jfact)[a-z-]*' | sort -u | paste -sd, -)
  ft::note bundled_reasoners "${reasoners:-unknown}"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$PATH"
exec java -Xmx2g -jar "$TOOL_DIR/robot.jar" "$@"'
}
