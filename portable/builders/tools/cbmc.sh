# builders/tools/cbmc.sh — CBMC bounded model checker (official ubuntu-24.04 deb, unpacked)
FT_TOOL_ID=cbmc
FT_TOOL_VERSION=6.11.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/cbmc/bin/cbmc"
FT_UPSTREAM_URL="https://github.com/diffblue/cbmc/releases/download/cbmc-6.11.0/ubuntu-24.04-cbmc-6.11.0-Linux.deb"
FT_PROBE=(bin/cbmc --version)

ft_tool_build() {
  local deb; deb=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::deb_extract "$deb" /tmp/cbmcx
  local binp; binp=$(find /tmp/cbmcx -type f -name cbmc | head -1)
  [ -n "$binp" ] || ft::die "cbmc binary not found in deb"
  local gccp; gccp=$(find /tmp/cbmcx -type f -name goto-cc | head -1)
  [ -n "$gccp" ] || ft::die "goto-cc not found in deb (needed as offline C front end)"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp "$binp" "$FT_TOOL_DIR/bin/cbmc"
  cp "$gccp" "$FT_TOOL_DIR/bin/goto-cc"
  ln -sf goto-cc "$FT_TOOL_DIR/bin/goto-gcc" 2>/dev/null || true
  ft::copy_libs "$FT_TOOL_DIR/bin/cbmc" "$FT_TOOL_DIR/lib" || true
  patchelf --set-rpath '$ORIGIN/../lib' "$FT_TOOL_DIR/bin/cbmc" "$FT_TOOL_DIR/bin/goto-cc" 2>/dev/null || true
  # goto-cc preprocesses .c by execvp'ing `gcc` — ship the gcc driver + cc1 (relative layout)
  gccver=$(gcc -dumpfullversion 2>/dev/null || gcc -dumpversion)
  mkdir -p "$FT_TOOL_DIR/gccroot/bin" "$FT_TOOL_DIR/gccroot/lib/gcc/x86_64-linux-gnu/$gccver"
  cp /usr/bin/gcc-$gccver "$FT_TOOL_DIR/gccroot/bin/gcc-14" 2>/dev/null || cp "$(readlink -f /usr/bin/gcc)" "$FT_TOOL_DIR/gccroot/bin/gcc-14"
  ln -sf gcc-14 "$FT_TOOL_DIR/gccroot/bin/gcc"
  cp "/usr/lib/gcc/x86_64-linux-gnu/$gccver/cc1" "$FT_TOOL_DIR/gccroot/lib/gcc/x86_64-linux-gnu/$gccver/cc1" \
    || ft::die "cc1 not found for gcc $gccver"
  ft::copy_libs "$FT_TOOL_DIR/gccroot/bin/gcc-14" "$FT_TOOL_DIR/lib" || true
  ft::copy_libs "$FT_TOOL_DIR/gccroot/lib/gcc/x86_64-linux-gnu/$gccver/cc1" "$FT_TOOL_DIR/lib" || true
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$TOOL_DIR/gccroot/bin:$PATH"
case "$1" in
  *.c)
    src="$1"; shift
    "$TOOL_DIR/bin/goto-cc" "$src" -o "$FT_TMP/prog.gb" || exit 3
    exec "$TOOL_DIR/bin/cbmc" "$FT_TMP/prog.gb" "$@" ;;
  *) exec "$TOOL_DIR/bin/cbmc" "$@" ;;
esac'
}
