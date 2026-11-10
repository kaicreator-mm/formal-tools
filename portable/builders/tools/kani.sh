# builders/tools/kani.sh — Kani Rust verifier (official release bundle, self-contained).
FT_TOOL_ID=kani
FT_TOOL_VERSION=0.68.0
FT_TOOL_KIND=rust-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="https://github.com/model-checking/kani/releases/download/kani-0.68.0/kani-0.68.0-x86_64-unknown-linux-gnu.tar.gz"
FT_PROBE=(bin/cargo-kani --version)

ft_tool_build() {
  local tgz; tgz=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$tgz" /tmp/kanix
  local src; src=$(find /tmp/kanix -maxdepth 2 -type d -name 'kani-*' | head -1)
  [ -n "$src" ] || src=/tmp/kanix
  mkdir -p "$FT_TOOL_DIR"
  cp -a "$src/." "$FT_TOOL_DIR/"
  # kani 0.68 releases ship bin/kani-driver (+ kani-compiler, goto-*, kissat); cargo-kani
  # wrapper is not part of the bundle — kani-driver is the real entry point.
  [ -x "$FT_TOOL_DIR/bin/kani-driver" ] || ft::die "bin/kani-driver missing in release bundle"
  # the bundle locates its toolchain relative to its own dir; give it a writable HOME inside itself
  mkdir -p "$FT_TOOL_DIR/home"
  ( cd "$FT_TOOL_DIR" && HOME="$FT_TOOL_DIR/home" PATH="$FT_TOOL_DIR/bin:$PATH" \
      timeout 1200 ./bin/kani-driver setup >>"$FT_LOG" 2>&1 ) \
    || ft::log "WARN: kani-driver setup returned nonzero (bundle may be fully self-contained; verification will decide)"
  ft::make_shim 'export PATH="$TOOL_DIR/bin:$PATH"
# kani needs a writable HOME + crate dir at verify time: redirect HOME, symlink toolchain state
W="$FT_TMP/kani-home"; mkdir -p "$W/.kani" 2>/dev/null || true
[ -d "$TOOL_DIR/home/.kani" ] && ln -sfn "$TOOL_DIR/home/.kani" "$W/.kani" 2>/dev/null || true
export HOME="$W"
if [ -d "$1" ] && [ -f "$1/Cargo.toml" ]; then
  rm -rf "$FT_TMP/crate"; cp -r "$1" "$FT_TMP/crate" || exit 3
  cd "$FT_TMP/crate" || exit 3; shift
fi
exec "$TOOL_DIR/bin/kani-driver" "$@"'
}
