# builders/tools/prism.sh — PRISM probabilistic model checker (official linux64 release)
FT_TOOL_ID=prism
FT_TOOL_VERSION=4.11
FT_TOOL_KIND=bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://github.com/prismmodelchecker/prism/releases/download/v4.11/prism-4.11-linux64-x86.tar.gz"
FT_PROBE=(bin/prism --version)

ft_tool_build() {
  local tgz; tgz=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$tgz" /tmp/prismx
  local src; src=$(find /tmp/prismx -maxdepth 1 -type d -name 'prism-*' | head -1)
  [ -n "$src" ] || ft::die "prism dir not found"
  cp -a "$src/." "$FT_TOOL_DIR/"
  [ -f "$FT_TOOL_DIR/bin/prism" ] || ft::die "bin/prism missing"
  if [ ! -d "$FT_TOOL_DIR/jre" ] && [ ! -d "$FT_TOOL_DIR/jdk" ]; then
    ft::log "prism tarball ships no JRE — wrapper will use bundled java21"
  fi
  ft::make_shim 'if [ -x "$TOOL_DIR/jre/bin/java" ]; then export PRISM_JAVA="$TOOL_DIR/jre/bin/java"; fi
if [ -d "$FT_ROOT/runtimes/java21" ]; then export JAVA_HOME="$FT_ROOT/runtimes/java21"; export PATH="$JAVA_HOME/bin:$PATH"; fi
exec "$TOOL_DIR/bin/prism" "$@"'
}
