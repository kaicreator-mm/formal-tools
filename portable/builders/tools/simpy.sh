# builders/tools/simpy.sh — SimPy discrete-event simulation (shared python313 runtime)
FT_TOOL_ID=simpy
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:simpy"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  FT_TOOL_VERSION=$("$PY" -s -c "import importlib.metadata as m; print(m.version('simpy'))" 2>>"$FT_LOG") \
    || ft::die "simpy not installed in shared runtime"
  "$PY" -s -c "import simpy" >>"$FT_LOG" 2>&1 || ft::die "simpy import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@"'
}
