# builders/tools/dafny.sh — Dafny program verifier (official ubuntu-22.04 release zip)
# Dafny bundles its own z3; if the release is framework-dependent we add a dotnet8 runtime.
FT_TOOL_ID=dafny
FT_TOOL_VERSION=4.11.0
FT_TOOL_KIND=bundle
FT_MAIN_BIN="tools/dafny/dafny/dafny"
FT_UPSTREAM_URL="https://github.com/dafny-lang/dafny/releases/download/v4.11.0/dafny-4.11.0-x64-ubuntu-22.04.zip"
FT_PROBE=(dafny/dafny --version)
# dafny release is a self-contained .NET publish; only ICU is required, avoided via
# DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 (set in the shim) — culture-aware APIs degrade.

ft_tool_build() {
  local zip; zip=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$zip" /tmp/dafnyx
  local src; src=$(find /tmp/dafnyx -maxdepth 1 -type d -name 'dafny' | head -1)
  [ -n "$src" ] || src=$(dirname "$(find /tmp/dafnyx -type f -name dafny | head -1)")
  [ -n "$src" ] || ft::die "dafny dir not found in zip"
  mkdir -p "$FT_TOOL_DIR/dafny"
  cp -a "$src/." "$FT_TOOL_DIR/dafny/"
  if ! ( cd "$FT_TOOL_DIR/dafny" && DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 ./dafny --version >/dev/null 2>&1 ); then
    ft::die "dafny not runnable even with invariant globalization (missing system deps?)"
  fi
  ft::make_shim 'export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
export PATH="$TOOL_DIR/dafny:$PATH"
exec "$TOOL_DIR/dafny/dafny" "$@"'
}
