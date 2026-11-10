#!/usr/bin/env bash
# portable/packaging/pack.sh — assemble the portable bundle on the build server (host side).
# Produces:
#   $FT_BUNDLE/                          assembled bundle tree (also the verify input)
#   $FT_PKG_DIR/formal-tools-portable-debian13-x86_64.tar.gz.split-*  (<=190MiB parts)
#   $FT_PKG_DIR/tools/<id>.tar.gz        per-tool incremental packages
#   $FT_PKG_DIR/runtimes/*.tar.gz        shared runtime packages
#   $FT_PKG_DIR/manifest.json, SHA256SUMS, unpack.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../env.sh
source "$HERE/../env.sh"

B="$FT_BUNDLE"
[ -d "$FT_OUT/runtimes" ] || { echo "no runtimes built; run 'runtimes' phase first" >&2; exit 1; }
# clean re-assemble: container-written files are root-owned; stale copies would silently win
rm -rf "$B"
mkdir -p "$B"/{bin,tools,runtimes,tests,registry,evidence,licenses,docs}

echo "== assemble bundle tree =="
rm -rf "$B/tools"; mkdir -p "$B/tools"
cp -a "$FT_OUT/runtimes/." "$B/runtimes/"
for d in "$FT_OUT"/tools/*/; do
  id=$(basename "$d")
  [ -f "$d/meta.json" ] || { echo "skip $id (no meta — build failed?)"; continue; }
  mkdir -p "$B/tools/$id"
  cp -a "$d/." "$B/tools/$id/"
done
# runner + docs from template
cp "$HERE/bundle-template/bin/tool-runner" "$B/bin/tool-runner" && chmod +x "$B/bin/tool-runner"
cp "$HERE/bundle-template/docs/PORTABLE_README.md" "$B/docs/" 2>/dev/null || true
# tests (expect.sh + case inputs)
rm -rf "$B/tests"; mkdir -p "$B/tests"
if [ -d "$HERE/../verification/cases" ]; then cp -a "$HERE/../verification/cases/." "$B/tests/"; fi
# fast-check cases import the library: make node_modules resolvable from tests/fast-check/
[ -d "$B/tests/fast-check" ] && ln -sfn "../../tools/fast-check/node_modules" "$B/tests/fast-check/node_modules"
# registry cross-reference
for f in PROBLEM_CAPABILITIES.json; do
  [ -f "$FT_REPO_ROOT/registry/$f" ] && cp "$FT_REPO_ROOT/registry/$f" "$B/registry/"
done
[ -f "$HERE/../status/PORTABLE_RUNTIME.json" ] && cp "$HERE/../status/PORTABLE_RUNTIME.json" "$B/registry/"
# build receipts into bundle evidence
cp -a "$FT_OUT/receipts/." "$B/evidence/" 2>/dev/null || true

echo "== manifest + hashes =="
PY=$(command -v python3 || true)
if [ -z "$PY" ]; then
  docker run --rm -v "$FT_BUNDLE:/b" -v "$FT_SRC:/src:ro" "$FT_IMG" python3 /src/packaging/make-manifest.py /b
else
  "$PY" "$HERE/make-manifest.py" "$B"
fi

echo "== per-tool + runtime packages =="
mkdir -p "$FT_PKG_DIR/tools" "$FT_PKG_DIR/runtimes"
( cd "$B" && for id in tools/*/; do
    id=${id#tools/}; id=${id%/}
    tar -czf "$FT_PKG_DIR/tools/$id.tar.gz" "tools/$id"
  done )
( cd "$B" && for rt in runtimes/*/; do
    rt=${rt#runtimes/}; rt=${rt%/}
    tar -czf "$FT_PKG_DIR/runtimes/$rt.tar.gz" "runtimes/$rt"
  done )

echo "== whole-bundle split archive (<=190MiB parts) =="
TARBALL="$FT_PKG_DIR/formal-tools-portable-debian13-x86_64.tar.gz"
( cd "$FT_OUT/bundle" && tar -czf "$TARBALL" "$(basename "$B")" )
rm -f "$TARBALL".split-*
split -b 190m -d -a 3 "$TARBALL" "$TARBALL.split-"
rm -f "$TARBALL"   # keep only parts; unpack.sh reassembles

echo "== SHA256SUMS + unpack script =="
( cd "$FT_PKG_DIR" && find . -type f \( -name '*.tar.gz.split-*' -o -name 'tools/*.tar.gz' -o -name 'runtimes/*.tar.gz' \) -printf '%P\n' | sort | xargs sha256sum > SHA256SUMS )
cp "$HERE/unpack-template/unpack.sh" "$FT_PKG_DIR/unpack.sh" && chmod +x "$FT_PKG_DIR/unpack.sh"

echo "bundle: $B"
du -sh "$B" "$FT_PKG_DIR" 2>/dev/null || true
echo "pack OK"
