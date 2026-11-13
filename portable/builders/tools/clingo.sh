# builders/tools/clingo.sh — clingo ASP solver (source build; release has no linux binary asset)
FT_TOOL_ID=clingo
FT_TOOL_VERSION=5.8.3
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/clingo/bin/clingo"
FT_UPSTREAM_URL="https://github.com/potassco/clingo/archive/refs/tags/v5.8.3.tar.gz"
FT_PROBE=(bin/clingo --version)

ft_tool_build() {
  local tgz; tgz=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$tgz" /tmp/clingox
  local src; src=$(find /tmp/clingox -maxdepth 1 -type d -name 'clingo-*' | head -1)
  [ -n "$src" ] || ft::die "clingo source dir not found"
  cmake -S "$src" -B /tmp/clingob -DCMAKE_BUILD_TYPE=Release -DCLINGO_BUILD_APPS=ON >>"$FT_LOG" 2>&1 \
    || ft::die "clingo cmake configure failed"
  cmake --build /tmp/clingob -j"$(nproc)" >>"$FT_LOG" 2>&1 || ft::die "clingo build failed"
  cmake --install /tmp/clingob --prefix /tmp/clingoinst >>"$FT_LOG" 2>&1 || ft::die "clingo install failed"
  mkdir -p "$FT_TOOL_DIR/bin" "$FT_TOOL_DIR/lib"
  cp /tmp/clingoinst/bin/clingo "$FT_TOOL_DIR/bin/clingo" || ft::die "clingo binary missing"
  cp -a /tmp/clingoinst/lib/libclingo*.so* /tmp/clingoinst/lib/libgringo*.so* /tmp/clingoinst/lib/libpotassco*.so* \
    "$FT_TOOL_DIR/lib/" 2>/dev/null || true
  ft::copy_libs "$FT_TOOL_DIR/bin/clingo" "$FT_TOOL_DIR/lib" || true
  LD_LIBRARY_PATH="$FT_TOOL_DIR/lib" ft::copy_libs "$FT_TOOL_DIR/bin/clingo" "$FT_TOOL_DIR/lib" || true
  patchelf --set-rpath '$ORIGIN/../lib' "$FT_TOOL_DIR/bin/clingo" 2>/dev/null || true
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/bin/clingo" "$@"'
}
