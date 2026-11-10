# builders/tools/minizinc.sh — MiniZinc constraint modelling bundle (official IDE bundle tarball)
FT_TOOL_ID=minizinc
FT_TOOL_VERSION=2.10.1
FT_TOOL_KIND=bundle
FT_MAIN_BIN="tools/minizinc/bin/minizinc"
FT_UPSTREAM_URL="https://github.com/MiniZinc/MiniZincIDE/releases/download/2.10.1/MiniZincIDE-2.10.1-x86_64-linux-gnu.tgz"
FT_PROBE=(bin/minizinc --version)

ft_tool_build() {
  local tgz; tgz=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$tgz" /tmp/mznx
  local src; src=$(find /tmp/mznx -maxdepth 1 -type d -name 'MiniZincIDE*' | head -1)
  [ -n "$src" ] || ft::die "MiniZincIDE dir not found"
  cp -a "$src/." "$FT_TOOL_DIR/"
  [ -x "$FT_TOOL_DIR/bin/minizinc" ] || ft::die "bin/minizinc missing"
  # bundle resolves share/solvers relative to binary; smoke it relocated
  "$FT_TOOL_DIR/bin/minizinc" --solvers >/dev/null 2>&1 || ft::die "minizinc cannot see solvers after relocation"
  # some bundled solver backends (fzn-gecode) link GUI-era libs (libGL...) — install then ship closure
  apt-get update -qq >>"$FT_LOG" 2>&1 || true
  apt-get install -y -qq --no-install-recommends libgl1 libegl1 libopengl0 >>"$FT_LOG" 2>&1 || true
  for b in "$FT_TOOL_DIR"/bin/*; do
    [ -x "$b" ] && [ -f "$b" ] && file -b "$b" | grep -qi ELF || continue
    ft::copy_libs "$b" "$FT_TOOL_DIR/extralib" || true
  done
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/extralib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$TOOL_DIR/bin:$PATH"
exec "$TOOL_DIR/bin/minizinc" "$@"'
}
