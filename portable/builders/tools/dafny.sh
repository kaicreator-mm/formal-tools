# builders/tools/dafny.sh — Dafny program verifier (official ubuntu-22.04 release zip)
# Dafny bundles its own z3; if the release is framework-dependent we add a dotnet8 runtime.
FT_TOOL_ID=dafny
FT_TOOL_VERSION=4.11.0
FT_TOOL_KIND=bundle
FT_MAIN_BIN="tools/dafny/dafny/dafny"
FT_UPSTREAM_URL="https://github.com/dafny-lang/dafny/releases/download/v4.11.0/dafny-4.11.0-x64-ubuntu-22.04.zip"
FT_PROBE=(dafny/dafny --version)

ft_tool_build() {
  local zip; zip=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$zip" /tmp/dafnyx
  local src; src=$(find /tmp/dafnyx -maxdepth 1 -type d -name 'dafny' | head -1)
  [ -n "$src" ] || src=$(dirname "$(find /tmp/dafnyx -type f -name dafny | head -1)")
  [ -n "$src" ] || ft::die "dafny dir not found in zip"
  mkdir -p "$FT_TOOL_DIR/dafny"
  cp -a "$src/." "$FT_TOOL_DIR/dafny/"
  if ! ( cd "$FT_TOOL_DIR/dafny" && ./dafny --version >/dev/null 2>&1 ); then
    ft::log "dafny needs a .NET runtime — shipping dotnet8 runtime"
    local dtgz
    dtgz=$(ft::fetch "https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.21/dotnet-runtime-8.0.21-linux-x64.tar.gz" 2>/dev/null) \
      || dtgz=$(ft::fetch "https://download.visualstudio.microsoft.com/download/pr/1a1a5df8-2a1e-4b6e-9b8f-3b0e0a5a1a1a/dotnet-runtime-8.0.21-linux-x64.tar.gz" 2>/dev/null) \
      || ft::die "cannot download dotnet8 runtime"
    mkdir -p "$FT_OUT/runtimes/dotnet8"
    tar -xzf "$dtgz" -C "$FT_OUT/runtimes/dotnet8"
    "$FT_OUT/runtimes/dotnet8/dotnet" --version >/dev/null || ft::die "dotnet8 runtime broken"
  fi
  ( cd "$FT_TOOL_DIR/dafny" && ./dafny --version >/dev/null 2>&1 ) || ft::die "dafny still not runnable"
  ft::make_shim 'export DOTNET_ROOT="${FT_ROOT}/runtimes/dotnet8"
[ -d "$DOTNET_ROOT" ] || unset DOTNET_ROOT
export PATH="$TOOL_DIR/dafny:$PATH"
exec "$TOOL_DIR/dafny/dafny" "$@"'
}
