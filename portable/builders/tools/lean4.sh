# builders/tools/lean4.sh — Lean 4 theorem prover (official self-contained toolchain release)
FT_TOOL_ID=lean4
FT_TOOL_VERSION=4.35.0
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/lean4/bin/lean"
FT_UPSTREAM_URL="https://github.com/leanprover/lean4/releases/download/v4.35.0/lean-4.35.0-linux.tar.zst"
FT_PROBE=(bin/lean --version)

ft_tool_build() {
  local ar; ar=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$ar" /tmp/leanx
  local src; src=$(find /tmp/leanx -maxdepth 1 -type d -name 'lean-*' | head -1)
  [ -n "$src" ] || ft::die "lean toolchain dir not found"
  cp -a "$src/." "$FT_TOOL_DIR/"
  # lean resolves its own lib dir relative to the binary; verify it works relocated already here
  "$FT_TOOL_DIR/bin/lean" --version >/dev/null 2>&1 || ft::die "lean not runnable after relocation"
  ft::make_shim 'export PATH="$TOOL_DIR/bin:$PATH"
exec "$TOOL_DIR/bin/lean" "$@"'
}
