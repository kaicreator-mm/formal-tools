# builders/tools/dowhy.sh — DoWhy causal inference (shared python313 runtime)
FT_TOOL_ID=dowhy
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:dowhy"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  FT_TOOL_VERSION=$("$PY" -s -c "import importlib.metadata as m; print(m.version('dowhy'))" 2>>"$FT_LOG") \
    || ft::die "dowhy not installed in shared runtime"
  "$PY" -s -c "import dowhy" >>"$FT_LOG" 2>&1 || ft::die "dowhy import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@"'
}
