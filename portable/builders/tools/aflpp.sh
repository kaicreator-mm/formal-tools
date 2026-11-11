# builders/tools/aflpp.sh — AFL++ fuzzer (source build) + smoke-test wrapper.
FT_TOOL_ID=aflpp
FT_TOOL_VERSION=5.03c
FT_TOOL_KIND=binary
FT_MAIN_BIN="tools/aflpp/bin/afl-fuzz"
FT_UPSTREAM_URL="https://github.com/AFLplusplus/AFLplusplus/archive/refs/tags/v5.03c.tar.gz"
FT_PROBE=(bin/afl-fuzz --version)

ft_tool_build() {
  local tgz; tgz=$(ft::fetch "$FT_UPSTREAM_URL")
  ft::extract "$tgz" /tmp/aflx
  local src; src=$(find /tmp/aflx -maxdepth 1 -type d -name 'AFLplusplus*' | head -1)
  ( cd "$src" && make -j"$(nproc)" afl-fuzz >>"$FT_LOG" 2>&1 ) \
    || ft::die "AFL++ afl-fuzz build failed"
  mkdir -p "$FT_TOOL_DIR/bin" "$FT_TOOL_DIR/lib" "$FT_TOOL_DIR/testcases"
  cp "$src/afl-fuzz" "$FT_TOOL_DIR/bin/"
  # 5.x links afl-fuzz against libpython3.13 (USE_PYTHON) — ship the shared lib
  cp -L /usr/lib/x86_64-linux-gnu/libpython3.13.so.1.0 "$FT_TOOL_DIR/lib/" 2>/dev/null \
    || ft::die "libpython3.13.so.1.0 not found in builder (python3-dev)"
  cp -a "$src/include" "$FT_TOOL_DIR/" 2>/dev/null || true
  # plain-compiled smoke target; fuzzed in non-instrumented mode (-n), so no compiler plugin needed
  cat > /tmp/smoke.c <<'EOF'
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
  char buf[64];
  if (argc < 2) return 1;
  FILE *f = fopen(argv[1], "rb");
  if (!f) return 1;
  size_t n = fread(buf, 1, sizeof(buf) - 1, f);
  buf[n] = 0;
  if (buf[0] == 'A' && buf[1] == 'F' && buf[2] == 'L') { printf("hit\n"); }
  return 0;
}
EOF
  gcc -O1 -o "$FT_TOOL_DIR/test-target" /tmp/smoke.c >>"$FT_LOG" 2>&1 || ft::die "smoke target compile failed"
  printf 'AAAA' > "$FT_TOOL_DIR/testcases/seed"
  ft::make_shim 'export LD_LIBRARY_PATH="$TOOL_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export AFL_SKIP_CPUFREQ=1 AFL_I_DONT_CARE_ABOUT_MISSING_CRASHES=1 AFL_NO_AFFINITY=1 AFL_NO_UI=1 AFL_DISABLE_TRIM=1
if [ "$1" = "--fuzz-smoke" ]; then
  out="$FT_TMP/afl-out"; rm -rf "$out"; mkdir -p "$out"
  timeout 40 "$TOOL_DIR/bin/afl-fuzz" -n -V 3 -t 200 -i "$TOOL_DIR/testcases" -o "$out" "$TOOL_DIR/test-target" "$TOOL_DIR/testcases/seed" >/dev/null 2>&1
  st=$?
  n=$(grep -oE "execs_done *: *[0-9]+" "$out/default/fuzzer_stats" 2>/dev/null | grep -oE "[0-9]+" | head -1)
  n="${n:-0}"
  echo "AFL_RESULT: EXECS_DONE=$n fuzzer_exit=$st"
  [ "$n" -gt 0 ] || exit 4
  exit 0
fi
exec "$TOOL_DIR/bin/afl-fuzz" "$@"'
}
