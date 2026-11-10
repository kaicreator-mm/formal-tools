# builders/tools/rdf-shacl.sh — pySHACL validator (shared python313 runtime; CLI via -m pyshacl)
FT_TOOL_ID=rdf-shacl
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:pyshacl"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  FT_TOOL_VERSION=$("$PY" -s -c "import importlib.metadata as m; print(m.version('pyshacl'))" 2>>"$FT_LOG") \
    || ft::die "pyshacl not installed in shared runtime (check py-deps receipts)"
  "$PY" -s -c "import pyshacl, rdflib" >>"$FT_LOG" 2>&1 || ft::die "pyshacl/rdflib import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s -m pyshacl "$@"'
}
