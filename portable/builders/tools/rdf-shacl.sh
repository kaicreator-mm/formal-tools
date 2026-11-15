# builders/tools/rdf-shacl.sh — pySHACL validator (shared python313 runtime; CLI via -m pyshacl)
FT_TOOL_ID=rdf-shacl
FT_TOOL_VERSION=0.40.2
FT_TOOL_KIND=python-lib
FT_MAIN_BIN=""
FT_UPSTREAM_URL="pypi:pyshacl"
FT_PROBE=()

ft_tool_build() {
  local PY="$FT_OUT/runtimes/python313/bin/python3.13"
  export PYTHONHOME="$FT_OUT/runtimes/python313" PYTHONNOUSERSITE=1
  local pins="$FT_SRC/builders/tools/rdf-shacl.requirements.txt"
  [ -f "$pins" ] || ft::die "missing exact dependency pins: $pins"
  "$PY" -s - "$pins" >>"$FT_LOG" 2>&1 <<'PY' || ft::die "pyshacl dependency closure does not match exact pins"
import importlib.metadata as metadata
import pathlib
import sys

pin_path = pathlib.Path(sys.argv[1])
pins = {}
for raw in pin_path.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    name, separator, expected = line.partition("==")
    if not separator or not name or not expected:
        raise SystemExit(f"malformed dependency pin: {raw!r}")
    pins[name] = expected
for name, expected in pins.items():
    actual = metadata.version(name)
    print(f"dependency pin: {name}=={actual}")
    if actual != expected:
        raise SystemExit(f"dependency mismatch: {name}: got={actual} expected={expected}")
PY
  ft::set_version "$("$PY" -s -c "import importlib.metadata as m; print(m.version('pyshacl'))" 2>>"$FT_LOG")" \
    || ft::die "pyshacl not installed in shared runtime (check py-deps receipts)"
  "$PY" -s -c "import pyshacl, rdflib" >>"$FT_LOG" 2>&1 || ft::die "pyshacl/rdflib import failed"
  ft::make_shim 'export PYTHONHOME="$FT_ROOT/runtimes/python313" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
exec "$FT_ROOT/runtimes/python313/bin/python3.13" -s -m pyshacl "$@"'
}
