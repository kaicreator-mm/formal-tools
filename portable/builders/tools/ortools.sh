# builders/tools/ortools.sh — Google OR-Tools (shared python313 runtime)
FT_TOOL_ID=ortools
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:ortools"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  ft::set_version ("$PY" -s -c "import importlib.metadata as m; print(m.version('ortools'))" 2>>"$FT_LOG") \
    || ft::die "ortools not installed in shared runtime"
  "$PY" -s -c "from ortools.sat.python import cp_model" >>"$FT_LOG" 2>&1 || ft::die "ortools cp_model import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@"'
}
