# builders/tools/tla-tlc.sh — TLA+ TLC model checker (official tla2tools.jar).
FT_TOOL_ID=tla-tlc
FT_TOOL_VERSION=1.8.0
FT_TOOL_KIND=jar
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar"
FT_UPSTREAM_SHA256="7e53aa636dac8a3cb0533f343115c0548e03fc0ce5edc7739becf58d3d0fb84f"
FT_UPSTREAM_SIZE_BYTES=4510884
FT_UPSTREAM_NOTE="GitHub release v1.8.0 tla2tools.jar; GitHub Releases API digest sha256:7e53aa636dac8a3cb0533f343115c0548e03fc0ce5edc7739becf58d3d0fb84f; size=4510884; prebuilt official Java jar (not a source build)"
FT_PROBE=(../../runtimes/java21/bin/java -cp tla2tools.jar tlc2.TLC -help)

ft_tool_build() {
  local jar got size
  jar=$(ft::fetch "$FT_UPSTREAM_URL" "$FT_UPSTREAM_SHA256")
  # Re-check after fetch because the shared cache helper can return a cached
  # .ok file before evaluating a newly supplied expected digest.
  got=$(sha256sum "$jar" | cut -d' ' -f1)
  [ "$got" = "$FT_UPSTREAM_SHA256" ] || ft::die "TLA2Tools upstream SHA256 mismatch: got=$got expected=$FT_UPSTREAM_SHA256"
  size=$(wc -c < "$jar" | tr -d '[:space:]')
  [ "$size" = "$FT_UPSTREAM_SIZE_BYTES" ] || ft::die "TLA2Tools upstream size mismatch: got=$size expected=$FT_UPSTREAM_SIZE_BYTES"
  ft::note upstream_sha256_expected "$FT_UPSTREAM_SHA256"
  ft::note upstream_sha256_observed "$got"
  ft::note upstream_size_bytes "$size"
  ft::note upstream_sha_verified "github-release-api-digest"
  ft::set_version "1.8.0"

  cp "$jar" "$FT_TOOL_DIR/tla2tools.jar"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$PATH"
exec java -XX:+UseParallelGC -cp "$TOOL_DIR/tla2tools.jar" tlc2.TLC "$@"'
}
