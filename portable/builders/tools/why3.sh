# builders/tools/why3.sh — Why3 verification platform via the OFFICIAL Debian trixie
# package (why3 1.8.0-2), pulled from the USTC Debian mirror with its dependency closure.
# glibc baseline is Debian 13 by construction.
FT_TOOL_ID=why3
FT_TOOL_VERSION=1.8.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/why3/usr/bin/why3"
FT_UPSTREAM_URL="deb:mirrors.ustc.edu.cn/debian trixie main (why3 1.8.0-2 + dep closure)"
FT_PROBE=(usr/bin/why3 --version)

ft_tool_build() {
  mkdir -p /tmp/why3debs
  apt-get update -qq >>"$FT_LOG" 2>&1
  apt-get install -y --no-install-recommends --download-only -o Dir::Cache::archives=/tmp/why3debs \
      why3 >>"$FT_LOG" 2>&1 || ft::die "why3 deb download failed"
  local n=$(ls /tmp/why3debs/*.deb 2>/dev/null | wc -l)
  [ "$n" -gt 0 ] || ft::die "no debs downloaded"
  ft::note deb_closure "$n packages"
  mkdir -p /tmp/why3root
  local d
  for d in /tmp/why3debs/*.deb; do dpkg-deb -x "$d" /tmp/why3root; done
  cp -a /tmp/why3root/. "$FT_TOOL_DIR/"
  [ -x "$FT_TOOL_DIR/usr/bin/why3" ] || ft::die "why3 binary missing after extraction"
  local share
  share=$(find "$FT_TOOL_DIR" -type d -name drivers | head -1 | xargs dirname)
  [ -n "$share" ] || ft::die "why3 drivers dir not found"
  ft::note why3_share_rel "${share#$FT_TOOL_DIR/}"
  # probe relocated
  ( export LD_LIBRARY_PATH="$FT_TOOL_DIR/usr/lib/x86_64-linux-gnu:$FT_TOOL_DIR/lib" \
      OCAMLLIB="$FT_TOOL_DIR/usr/lib/x86_64-linux-gnu/ocaml/5.3.0" \
      WHY3DATA="$FT_TOOL_DIR/share/why3"; "$FT_TOOL_DIR/usr/bin/why3" --version >/dev/null 2>&1 ) \
    || ft::die "why3 not runnable after relocation"
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/usr/lib/x86_64-linux-gnu:$TOOL_DIR/lib:${LD_LIBRARY_PATH:-}"
export WHY3DATA="$TOOL_DIR/usr/share/why3"
# Debian trixie ocaml stdlib lives in the multiarch dir; why3 resolves why3/commands under it
export OCAMLLIB="$TOOL_DIR/usr/lib/x86_64-linux-gnu/ocaml/5.3.0:${OCAMLLIB:-}"
export PATH="$TOOL_DIR/usr/bin:$FT_ROOT/tools/z3/bin:$PATH"
# why3 prove spawns sub-command binaries from its compiled-in libdir (absolute Debian
# path). Link the shipped tree there when the filesystem allows (root containers);
# degraded mode (WHY3DATA only) otherwise — recorded as a known limitation.
rm -rf /usr/lib/x86_64-linux-gnu/ocaml 2>/dev/null || true
if mkdir -p /usr/lib/x86_64-linux-gnu/ocaml 2>/dev/null; then
  ln -sfn "$TOOL_DIR/usr/lib/x86_64-linux-gnu/ocaml/5.3.0" /usr/lib/x86_64-linux-gnu/ocaml/5.3.0 2>/dev/null || true
fi
exec "$TOOL_DIR/usr/bin/why3" "$@"'
}
