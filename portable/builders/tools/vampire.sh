# builders/tools/vampire.sh — Vampire first-order theorem prover (official release binary)
FT_TOOL_ID=vampire
FT_TOOL_VERSION=5.1.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/vampire/bin/vampire"
FT_UPSTREAM_URL="https://github.com/vprover/vampire/releases/download/v5.1.0/vampire-Linux-X64.zip"
FT_UPSTREAM_SHA256="495828dc76cb17a27080d62dedce755e46de96f47f06f5f0ad4be9cdaf6f968f"
FT_UPSTREAM_SIZE_BYTES=21664799
FT_UPSTREAM_NOTE="GitHub release v5.1.0 vampire-Linux-X64.zip; GitHub Releases API digest sha256:495828dc76cb17a27080d62dedce755e46de96f47f06f5f0ad4be9cdaf6f968f; size=21664799; prebuilt official binary (not a source build)"
FT_PROBE=(bin/vampire --version)

ft_tool_build() {
  local zip got size
  zip=$(ft::fetch "$FT_UPSTREAM_URL" "$FT_UPSTREAM_SHA256")
  # ft::fetch may return a previously cached .ok file before evaluating a newly
  # supplied expected digest. Re-check here so the tool-specific pin also
  # protects cache hits, and record the verified source bytes in the receipt.
  got=$(sha256sum "$zip" | cut -d' ' -f1)
  [ "$got" = "$FT_UPSTREAM_SHA256" ] || ft::die "Vampire upstream SHA256 mismatch: got=$got expected=$FT_UPSTREAM_SHA256"
  size=$(wc -c < "$zip" | tr -d '[:space:]')
  [ "$size" = "$FT_UPSTREAM_SIZE_BYTES" ] || ft::die "Vampire upstream size mismatch: got=$size expected=$FT_UPSTREAM_SIZE_BYTES"
  ft::note upstream_sha256_expected "$FT_UPSTREAM_SHA256"
  ft::note upstream_sha256_observed "$got"
  ft::note upstream_size_bytes "$size"
  ft::note upstream_sha_verified "github-release-api-digest"

  ft::extract "$zip" /tmp/vampx
  local binp; binp=$(find /tmp/vampx -type f -name vampire | head -1)
  [ -n "$binp" ] || ft::die "vampire binary not found in release zip"
  mkdir -p "$FT_TOOL_DIR/bin"
  cp "$binp" "$FT_TOOL_DIR/bin/vampire"
  chmod +x "$FT_TOOL_DIR/bin/vampire"
  ft::copy_libs "$FT_TOOL_DIR/bin/vampire" "$FT_TOOL_DIR/lib" || true
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$TOOL_DIR/bin/vampire" "$@"'
}
