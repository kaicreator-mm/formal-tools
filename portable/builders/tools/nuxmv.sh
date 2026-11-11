# builders/tools/nuxmv.sh — nuXmv symbolic model checker 2.2.0 (FBK official direct download).
# download.html publishes direct links + official .sha256sum siblings (no form gate for 2.2.0).
FT_TOOL_ID=nuxmv
FT_TOOL_VERSION=2.2.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/nuxmv/bin/nuXmv"
FT_UPSTREAM_URL="https://nuxmv.fbk.eu/downloads/2.2.0/nuXmv-2.2.0-linux64.tar.xz"
FT_PROBE=(bin/nuXmv --version)

ft_tool_build() {
  # official .sha256sum sibling: `hash *nuXmv-2.2.0-linux64.tar.xz`
  local shafile want
  shafile=$(ft::fetch "${FT_UPSTREAM_URL}.sha256sum")
  want=$(grep -oE '^[0-9a-f]{64}' "$shafile" | head -1)
  local tarball
  tarball=$(ft::fetch "$FT_UPSTREAM_URL" "$want")
  ft::extract "$tarball" /tmp/nuxmvx
  local src; src=$(find /tmp/nuxmvx -maxdepth 1 -type d -name 'nuXmv-*' | head -1)
  [ -n "$src" ] || ft::die "nuXmv dir not found in tarball"
  # Debian-style layout: usr/local/{bin,lib/…}
  mkdir -p "$FT_TOOL_DIR/bin" "$FT_TOOL_DIR/lib"
  cp -a "$src/usr/local/bin/." "$FT_TOOL_DIR/bin/"
  [ -x "$FT_TOOL_DIR/bin/nuXmv" ] || ft::die "bin/nuXmv missing after extraction"
  # vendored libs live in usr/local/lib/x86_64-linux-gnu/ — flatten into lib/, but drop
  # their bundled glibc core (libc.so.6/libm/ld-linux) to avoid loader conflicts
  cp -a "$src/usr/local/lib/x86_64-linux-gnu/." "$FT_TOOL_DIR/lib/" 2>/dev/null || true
  cp -a "$src/usr/local/lib/." "$FT_TOOL_DIR/lib/" 2>/dev/null || true
  find "$FT_TOOL_DIR/lib" -maxdepth 1 -type f \( -name 'libc.so*' -o -name 'libm.so*' -o -name 'ld-linux*' -o -name 'libpthread*' -o -name 'libdl*' -o -name 'librt*' \) -delete
  ft::copy_libs "$FT_TOOL_DIR/bin/nuXmv" "$FT_TOOL_DIR/lib" || true
  patchelf --set-rpath '$ORIGIN/../lib' "$FT_TOOL_DIR/bin/nuXmv" 2>/dev/null || true
  ( export LD_LIBRARY_PATH="$FT_TOOL_DIR/lib"; "$FT_TOOL_DIR/bin/nuXmv" --version >/dev/null 2>&1 ) \
    || ft::die "nuXmv not runnable after relocation"
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/bin/nuXmv" "$@"'
}
