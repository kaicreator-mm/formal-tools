# builders/tools/apache-jena.sh — Apache Jena 5.5.0 (Java RDF tools)
FT_TOOL_ID=apache-jena
FT_TOOL_VERSION=5.5.0
FT_TOOL_KIND=java
FT_UPSTREAM_URL="https://archive.apache.org/dist/jena/binaries/apache-jena-5.5.0.tar.gz"
FT_UPSTREAM_SHA512="f9ae68a748e642c6a8175ee25afdfa37ce057ed37e7caf279a8a46ad93284bea808cf14d96bf30b6e4e6a4ddaf30cf5ee9d441f48a9a3d3c9e647a9b71645e0c"
FT_PROBE=(bin/riot --version)

ft_tool_build() {
  local tgz; tgz=$(ft::fetch "$FT_UPSTREAM_URL") || ft::die "Apache Jena 5.5.0 upstream archive fetch failed"
  local actual_sha512
  actual_sha512=$(sha512sum "$tgz" | awk '{print $1}') || ft::die "Apache Jena 5.5.0 upstream archive SHA512 could not be computed"
  [ "$actual_sha512" = "$FT_UPSTREAM_SHA512" ] || ft::die "Apache Jena 5.5.0 upstream archive SHA512 mismatch: expected $FT_UPSTREAM_SHA512, got $actual_sha512"
  ft::extract "$tgz" /tmp/jena
  local src; src=$(find /tmp/jena -maxdepth 1 -type d -name 'apache-jena-*' | head -1)
  [ -n "$src" ] || ft::die "apache-jena dir not found"
  cp -a "$src/." "$FT_TOOL_DIR/"
  [ -x "$FT_TOOL_DIR/bin/riot" ] || ft::die "bin/riot missing"
  ft::make_shim 'export PATH="$TOOL_DIR/bin:$PATH"
export JENA_HOME="$TOOL_DIR"
exec "$TOOL_DIR/bin/riot" "$@"'
}
