# builders/tools/networkx.sh — NetworkX graph algorithms (shared python313 runtime)
FT_TOOL_ID=networkx
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:networkx"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  ft::set_version ("$PY" -s -c "import importlib.metadata as m; print(m.version('networkx'))" 2>>"$FT_LOG") \
    || ft::die "networkx not installed in shared runtime"
  "$PY" -s -c "import networkx; networkx.Graph()" >>"$FT_LOG" 2>&1 || ft::die "networkx import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@"'
}
