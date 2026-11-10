# builders/tools/causal-learn.sh — causal-learn causal discovery (shared python313 runtime; module: causallearn)
FT_TOOL_ID=causal-learn
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:causal-learn"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  FT_TOOL_VERSION=$("$PY" -s -c "import importlib.metadata as m; print(m.version('causal-learn'))" 2>>"$FT_LOG") \
    || ft::die "causal-learn not installed in shared runtime"
  "$PY" -s -c "import causallearn" >>"$FT_LOG" 2>&1 || ft::die "causallearn import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@"'
}
