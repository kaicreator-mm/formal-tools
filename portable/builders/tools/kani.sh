# builders/tools/kani.sh — Kani Rust verifier via the official kani-verifier crate.
# The release tarball does NOT ship the pinned rust toolchain; `cargo kani setup`
# materializes it into HOME/.kani, which we ship inside the tool directory.
FT_TOOL_ID=kani
FT_TOOL_VERSION=0.68.0
FT_TOOL_KIND=rust-bundle
FT_MAIN_BIN=""
FT_UPSTREAM_URL="crates.io:kani-verifier (resolved at build; setup downloads pinned toolchain)"
FT_PROBE=(bin/cargo-kani --version)

ft_tool_build() {
  export HOME=/root
  # static.rust-lang.org is unreachable from the build network; route ONLY the rustup
  # phase through the operator's LAN proxy (crates.io/GitHub are reachable directly —
  # verified by earlier cargo install success in build logs).
  export http_proxy="http://192.168.100.245:10808" https_proxy="http://192.168.100.245:10808"
  curl -fsSL --retry 3 --http1.1 https://sh.rustup.rs -o /tmp/rustup-init.sh \
    || ft::die "rustup-init fetch failed"
  sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain stable >>"$FT_LOG" 2>&1 \
    || ft::die "rustup install failed"
  rustup default stable >>"$FT_LOG" 2>&1 || true
  unset http_proxy https_proxy
  export PATH="/root/.cargo/bin:$PATH"
  cargo install --locked kani-verifier >>"$FT_LOG" 2>&1 || ft::die "cargo install kani-verifier failed"
  mkdir -p "$FT_TOOL_DIR/home" "$FT_TOOL_DIR/bin"
  # HOME moves to the tool dir for setup; pin rustup/cargo homes so the shim still resolves.
  # Pre-seed the release bundle from the build cache (GitHub resets connections intermittently;
  # setup skips the download when the file is already present and checksum-valid), retry 3x.
  mkdir -p "$FT_TOOL_DIR/home/.kani"
  for c in "$FT_CACHE"/*kani-$FT_TOOL_VERSION-x86_64-unknown-linux-gnu.tar.gz; do
    [ -f "$c" ] && cp "$c" "$FT_TOOL_DIR/home/.kani/kani-$FT_TOOL_VERSION-x86_64-unknown-linux-gnu.tar.gz" \
      && ft::note setup_bundle_preseeded "from $(basename "$c")"
  done
  local ok=0 attempt
  for attempt in 1 2 3; do
    if HOME="$FT_TOOL_DIR/home" RUSTUP_HOME=/root/.rustup CARGO_HOME=/root/.cargo \
        timeout 3000 cargo kani setup >>"$FT_LOG" 2>&1; then ok=1; break; fi
    ft::log "cargo kani setup attempt $attempt failed; retrying"
    sleep 10
  done
  [ "$ok" = 1 ] || ft::die "cargo kani setup failed (3 attempts)"
  # setup may symlink the toolchain to the builder's rustup store (/root/.rustup) — a
  # dangling link inside the bundle. Materialize it into the tree.
  tc="$FT_TOOL_DIR/home/.kani/kani-$FT_TOOL_VERSION/toolchain"
  tc_target=$(readlink -f "$tc" 2>/dev/null || true)
  if [ -L "$tc" ] && [ -n "$tc_target" ] && [ -d "$tc_target" ]; then
    rm "$tc"
    cp -a "$tc_target" "$tc"
    ft::note toolchain_materialized "from $tc_target"
  fi
  # setup ran as root in the builder container -> toolchain dirs may be 0700; the offline
  # verify containers run as a non-root uid and need read+traverse access
  chmod -R a+rX "$FT_TOOL_DIR/home"
  [ -d "$FT_TOOL_DIR/home/.kani" ] || ft::die "no .kani after setup"
  cp /root/.cargo/bin/cargo-kani "$FT_TOOL_DIR/bin/"
  local v
  v=$("$FT_TOOL_DIR/bin/cargo-kani" --version 2>/dev/null | head -1)
  [ -n "$v" ] && FT_TOOL_VERSION=$(printf '%s' "$v" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  ft::note upstream_note "kani-verifier crate via crates.io; cargo kani setup materialized toolchain into home/.kani (shipped)"
  ft::make_shim 'export PATH="$TOOL_DIR/bin:$PATH"
# cargo metadata spawns bare `rustc` before kani sets up its env — put the shipped
# toolchain bin on PATH first
KB=$(echo "$TOOL_DIR"/home/.kani/kani-*/toolchain)
[ -d "$KB/bin" ] && export PATH="$KB/bin:$PATH"
export RUSTC="${KB}/bin/rustc"
# cargo-kani needs a writable HOME + crate dir at verify time: redirect HOME, symlink toolchain state
W="$FT_TMP/kani-home"; mkdir -p "$W" 2>/dev/null || true
[ -d "$TOOL_DIR/home/.kani" ] && ln -sfn "$TOOL_DIR/home/.kani" "$W/.kani" 2>/dev/null || true
export HOME="$W"
if [ -d "$1" ] && [ -f "$1/Cargo.toml" ]; then
  rm -rf "$FT_TMP/crate"; cp -r "$1" "$FT_TMP/crate" || exit 3
  cd "$FT_TMP/crate" || exit 3; shift
fi
exec "$TOOL_DIR/bin/cargo-kani" "$@"'
}
