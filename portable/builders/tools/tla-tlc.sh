# builders/tools/tla-tlc.sh — TLA+ TLC model checker (official tla2tools.jar via Maven Central)
# GitHub repo tlaplus/tla2tools currently 404s on the releases API; Maven Central is the
# upstream-published distribution channel with .sha1 checksums.
FT_TOOL_ID=tla-tlc
FT_TOOL_VERSION=1.8.0
FT_TOOL_KIND=jar
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://repo1.maven.org/maven2/org/lamport/tla2tools/ (resolved at build)"
FT_PROBE=(../../runtimes/java21/bin/java -cp tla2tools.jar tlc2.TLC -version)

ft_tool_build() {
  local meta
  meta=$(curl -fsSL --retry 3 "https://repo1.maven.org/maven2/org/lamport/tla2tools/maven-metadata.xml") \
    || ft::die "cannot fetch maven-metadata.xml for tla2tools"
  local ver
  ver=$(printf '%s' "$meta" | grep -oE '<release>[^<]+</release>' | head -1 | sed 's/<[^>]*>//g')
  [ -n "$ver" ] || ft::die "no release version in maven-metadata.xml"
  FT_TOOL_VERSION="$ver"
  local jar
  jar=$(ft::fetch "https://repo1.maven.org/maven2/org/lamport/tla2tools/$ver/tla2tools-$ver.jar")
  # sibling .sha1 published by Maven Central
  local want
  want=$(curl -fsSL "https://repo1.maven.org/maven2/org/lamport/tla2tools/$ver/tla2tools-$ver.jar.sha1") \
    || ft::die "no upstream sha1 for tla2tools"
  local got; got=$(sha256sum "$jar" | cut -d' ' -f1)
  got=$(sha1sum "$jar" | cut -d' ' -f1)
  [ "$got" = "$(printf '%s' "$want" | tr -d '[:space:]')" ] || ft::die "sha1 mismatch for tla2tools-$ver.jar"
  ft::note sha_verified upstream-maven-sha1
  cp "$jar" "$FT_TOOL_DIR/tla2tools.jar"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$PATH"
exec java -XX:+UseParallelGC -cp "$TOOL_DIR/tla2tools.jar" tlc2.TLC "$@"'
}
