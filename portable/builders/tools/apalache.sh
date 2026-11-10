# builders/tools/apalache.sh — Apalache TLA+ model checker (official release zip)
FT_TOOL_ID=apalache
FT_TOOL_VERSION=0.63.0
FT_TOOL_KIND=java-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://github.com/apalache-mc/apalache/releases/download/v0.63.0/apalache-0.63.0.zip"
FT_PROBE=(bin/apalache-mc --version)

ft_tool_build() {
  local zip; zip=$(ft::fetch "$FT_UPSTREAM_URL")
  # upstream publishes sha256sum.txt (not a sibling URL) — verify explicitly
  local sums
  sums=$(curl -fsSL --retry 3 "https://github.com/apalache-mc/apalache/releases/download/v0.63.0/sha256sum.txt") \
    || ft::die "cannot fetch upstream sha256sum.txt"
  local got; got=$(sha256sum "$zip" | cut -d' ' -f1)
  printf '%s\n' "$sums" | grep -q "$got" || ft::die "sha256 not in upstream sha256sum.txt"
  ft::note sha_verified upstream-sha256sum.txt
  ft::extract "$zip" /tmp/apalx
  local src; src=$(find /tmp/apalx -maxdepth 2 -type d -name 'apalache*' | head -1)
  [ -n "$src" ] || src=/tmp/apalx
  cp -a "$src/." "$FT_TOOL_DIR/"
  [ -f "$FT_TOOL_DIR/bin/apalache-mc" ] || ft::die "bin/apalache-mc missing after extract"
  ft::make_shim 'export JAVA_HOME="$FT_ROOT/runtimes/java21"
export PATH="$JAVA_HOME/bin:$PATH"
exec "$TOOL_DIR/bin/apalache-mc" "$@"'
}
