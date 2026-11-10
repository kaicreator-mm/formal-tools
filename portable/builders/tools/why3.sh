# builders/tools/why3.sh — Why3 verification platform (source build; OCaml native binary).
# Drivers/data dir are located via WHY3DATA env override so the install stays relocatable.
FT_TOOL_ID=why3
FT_TOOL_VERSION=1.8.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/why3/bin/why3"
FT_UPSTREAM_URL="resolved at build (why3 release tarball)"
FT_PROBE=(bin/why3 --version)

ft_tool_build() {
  local ver tgz=""
  for ver in 1.8.0 1.7.2 1.7.1; do
    for u in "https://why3.gitlabpages.inria.fr/releases/why3-$ver.tar.xz" \
             "https://why3.gitlabpages.inria.fr/releases/why3-$ver.tar.gz" \
             "https://gitlab.inria.fr/why3/why3/-/archive/$ver/why3-why3-$ver.tar.gz"; do
      tgz=$(ft::fetch "$u" 2>/dev/null) && break 2
    done
  done
  [ -n "$tgz" ] || ft::unavailable "why3 release tarball unreachable (inria gitlabpages + gitlab.inria.fr, all candidates)"
  FT_TOOL_VERSION="$ver"
  ft::extract "$tgz" /tmp/why3x
  local src; src=$(find /tmp/why3x -maxdepth 1 -type d -name 'why3-*' | head -1)
  ( cd "$src" && ./configure --prefix=/tmp/why3inst --disable-ide >>"$FT_LOG" 2>&1 ) || ft::die "why3 configure failed"
  ( cd "$src" && make -j"$(nproc)" >>"$FT_LOG" 2>&1 ) || ft::die "why3 build failed"
  ( cd "$src" && make install DESTDIR=/tmp/why3stage >>"$FT_LOG" 2>&1 ) || ft::die "why3 install failed"
  mkdir -p "$FT_TOOL_DIR"
  cp -a /tmp/why3stage/tmp/why3inst/. "$FT_TOOL_DIR/"
  [ -x "$FT_TOOL_DIR/bin/why3" ] || ft::die "why3 binary missing after install"
  # locate share dir (drivers) for WHY3DATA
  local share
  share=$(find "$FT_TOOL_DIR" -type d -name drivers | head -1 | xargs dirname)
  [ -n "$share" ] || ft::die "why3 drivers dir not found"
  ft::note why3_share_rel "${share#$FT_TOOL_DIR/}"
  ft::make_shim 'export WHY3DATA="$TOOL_DIR/share/why3"
export PATH="$TOOL_DIR/bin:$FT_ROOT/tools/z3/bin:$PATH"
exec "$TOOL_DIR/bin/why3" "$@"'
}
