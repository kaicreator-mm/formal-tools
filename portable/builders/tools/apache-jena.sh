# builders/tools/apache-jena.sh — Apache Jena RDF/SPARQL CLI (official binary distribution)
FT_TOOL_ID=apache-jena
FT_TOOL_VERSION=5.5.0
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://dlcdn.apache.org/jena/binaries/apache-jena-5.5.0.tar.gz"
FT_PROBE=(bin/riot --version)

ft_tool_build() {
  # version resolved by candidate list; USTC/dlcdn publish sibling .sha512 (ft::fetch verifies)
  local ver tgz
  for ver in 5.5.0 5.4.0 5.3.0 5.2.0; do
    for host in mirrors.ustc.edu.cn dlcdn.apache.org; do
      FT_TOOL_VERSION="$ver"
      FT_UPSTREAM_URL="https://$host/jena/binaries/apache-jena-$ver.tar.gz"
      if tgz=$(ft::fetch "$FT_UPSTREAM_URL" 2>/dev/null); then break 2; fi
    done
  done
  [ -n "${tgz:-}" ] || ft::die "no apache-jena tarball found on mirrors (ustc/dlcdn)"
  ft::extract "$tgz" /tmp/jenax
  local src; src=$(find /tmp/jenax -maxdepth 1 -type d -name 'apache-jena-*' | head -1)
  [ -n "$src" ] || ft::die "jena dir not found"
  cp -a "$src/." "$FT_TOOL_DIR/"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$PATH"
export JENA_HOME="$TOOL_DIR"
exec "$TOOL_DIR/bin/riot" "$@"'
}
