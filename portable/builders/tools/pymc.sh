# builders/tools/pymc.sh — PyMC Bayesian modeling (shared python313 runtime; pytensor pure-python mode offline)
FT_TOOL_ID=pymc
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:pymc"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  ft::set_version "$("$PY" -s -c "import importlib.metadata as m; print(m.version('pymc'))" 2>>"$FT_LOG")" \
    || ft::die "pymc not installed in shared runtime"
  "$PY" -s -c "import pymc" >>"$FT_LOG" 2>&1 || ft::die "pymc import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
export PYTENSOR_FLAGS="${PYTENSOR_FLAGS:-cxx=}"
export MPLCONFIGDIR="${MPLCONFIGDIR:-/tmp/mpl}"
mkdir -p "$MPLCONFIGDIR" 2>/dev/null || true
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s "$@"'
}
