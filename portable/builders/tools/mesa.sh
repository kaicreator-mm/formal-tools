# builders/tools/mesa.sh — Mesa agent-based modeling (shared python313 runtime)
FT_TOOL_ID=mesa
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:mesa"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  ft::set_version "$("$PY" -s -c "import importlib.metadata as m; print(m.version('mesa'))" 2>>"$FT_LOG")" \
    || ft::die "mesa not installed in shared runtime"
  "$PY" -s -c "import mesa" >>"$FT_LOG" 2>&1 || ft::die "mesa import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
export MPLCONFIGDIR="${MPLCONFIGDIR:-/tmp/mpl}"
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@"'
}
