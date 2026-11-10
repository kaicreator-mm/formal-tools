# builders/tools/hypothesis.sh — Hypothesis property testing (shared python313 runtime)
FT_TOOL_ID=hypothesis
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:hypothesis"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  FT_TOOL_VERSION=$("$PY" -s -c "import importlib.metadata as m; print(m.version('hypothesis'))" 2>>"$FT_LOG") \
    || ft::die "hypothesis not installed in shared runtime"
  "$PY" -s -c "import hypothesis" >>"$FT_LOG" 2>&1 || ft::die "hypothesis import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@"'
}
