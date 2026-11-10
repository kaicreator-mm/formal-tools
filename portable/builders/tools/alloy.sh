# builders/tools/alloy.sh — Alloy 6 relational model finder (official dist jar + headless runner)
# The dist jar's default main opens a GUI; we ship a tiny headless runner (java-src/AlloyRunner.java,
# compiled here against the jar) that parses + solves commands via the official translator API.
FT_TOOL_ID=alloy
FT_TOOL_VERSION=6.2.0
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://github.com/AlloyTools/org.alloytools.alloy/releases/download/v6.2.0/org.alloytools.alloy.dist.jar"
FT_PROBE=(../../runtimes/java21/bin/java -cp org.alloytools.alloy.dist.jar:. AlloyRunner)

ft_tool_build() {
  local jar; jar=$(ft::fetch "$FT_UPSTREAM_URL")
  cp "$jar" "$FT_TOOL_DIR/org.alloytools.alloy.dist.jar"
  local javasrc="$FT_SRC/builders/java-src/AlloyRunner.java"
  [ -f "$javasrc" ] || ft::die "AlloyRunner.java missing"
  javac -cp "$FT_TOOL_DIR/org.alloytools.alloy.dist.jar" -d "$FT_TOOL_DIR" "$javasrc" \
    || ft::die "AlloyRunner compile failed (check Alloy API surface)"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$PATH"
exec java -cp "$TOOL_DIR/org.alloytools.alloy.dist.jar:$TOOL_DIR" AlloyRunner "$@"'
}
