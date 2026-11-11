#!/usr/bin/env bash
# portable/packaging/pack.sh — assemble the portable bundle on the build server (host side).
# Produces:
#   $FT_BUNDLE/                          assembled bundle tree (also the verify input)
#   $FT_PKG_DIR/formal-tools-portable-debian13-x86_64.tar.zst.split-*  (<=190MiB parts, zstd -22)
#   $FT_PKG_DIR/tools/<id>-<version>-linux-x86_64.tar.zst        per-tool packages (zstd -22)
#   $FT_PKG_DIR/runtimes/<rt>-<version>-linux-x86_64.tar.zst     shared runtime packages
#   $FT_PKG_DIR/manifest.json, SHA256SUMS, unpack.sh
# Every archive is integrity-verified after compression: zstd -t + tar entry count
# vs source file count (mismatch = hard fail).
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

# ---- compression: zstd ultra -22 (smallest), multithreaded, long window -------------
ZSTD_FLAGS=(--ultra -22 -T16 --long=31 -q)
PKG_FAILS=0

verify_pkg() { # src_dir archive -> hard integrity check after compression
  local src="$1" ar="$2"
  zstd -t "$ar" || { echo "VERIFY FAIL(zstd -t): $ar"; PKG_FAILS=$((PKG_FAILS+1)); return 1; }
  local a s
  a=$(zstd -dc "$ar" 2>/dev/null | tar -tf - 2>/dev/null | wc -l)
  s=$(find "$src" | wc -l)
  if [ "$a" != "$s" ]; then
    echo "VERIFY FAIL(entries): $ar tar=$a source=$s"
    PKG_FAILS=$((PKG_FAILS+1)); return 1
  fi
  echo "verify OK: $(basename "$ar") ($a entries)"
}

echo "== per-tool packages (zstd -22, versioned names) =="
mkdir -p "$FT_PKG_DIR/tools" "$FT_PKG_DIR/runtimes"
rm -f "$FT_PKG_DIR"/tools/*.tar.gz "$FT_PKG_DIR"/tools/*.tar.zst
( cd "$B" || exit 1
  for d in tools/*/; do
    id=${d#tools/}; id=${id%/}
    ver=""
    # shellcheck disable=SC1091
    . "$B/tools/$id/meta.sh" 2>/dev/null && ver="${TOOL_VERSION:-}"
    out="$FT_PKG_DIR/tools/${id}-${ver}-linux-x86_64.tar.zst"
    tar -cf - "tools/$id" | zstd "${ZSTD_FLAGS[@]}" -o "$out"
    verify_pkg "$B/tools/$id" "$out"
  done )

echo "== runtime packages (zstd -22, versioned names) =="
rm -f "$FT_PKG_DIR"/runtimes/*.tar.gz "$FT_PKG_DIR"/runtimes/*.tar.zst
( cd "$B" || exit 1
  for d in runtimes/*/; do
    rt=${d#runtimes/}; rt=${rt%/}
    case "$rt" in
      python313) ver=3.13.5 ;;
      node22)    ver=22.16.0 ;;
      java21)    ver=21.0.13.9 ;;
      dotnet8)   ver=8.0 ;;
      py-cache)  ver=1.25.0 ;;
      *)         ver="" ;;
    esac
    out="$FT_PKG_DIR/runtimes/${rt}-${ver}-linux-x86_64.tar.zst"
    tar -cf - "runtimes/$rt" | zstd "${ZSTD_FLAGS[@]}" -o "$out"
    verify_pkg "$B/runtimes/$rt" "$out"
  done )

echo "== whole-bundle split archive (zstd -22, <=190MiB parts) =="
rm -f "$FT_PKG_DIR"/formal-tools-portable-debian13-x86_64.tar.gz* \
      "$FT_PKG_DIR"/formal-tools-portable-debian13-x86_64.tar.zst*
BZ="$FT_PKG_DIR/formal-tools-portable-debian13-x86_64.tar.zst"
( cd "$FT_OUT/bundle" && tar -cf - "$(basename "$B")" | zstd "${ZSTD_FLAGS[@]}" -o "$BZ" )
verify_pkg "$FT_OUT/bundle" "$BZ"
split -b 190m -d -a 3 "$BZ" "$BZ.split-"
rm -f "$BZ"

echo "== SHA256SUMS + unpack script =="
( cd "$FT_PKG_DIR" && find . -type f \( -name '*.tar.zst.split-*' -o -name 'tools/*.tar.zst' -o -name 'runtimes/*.tar.zst' \) -printf '%P\n' | sort | xargs sha256sum > SHA256SUMS )
cp "$HERE/unpack-template/unpack.sh" "$FT_PKG_DIR/unpack.sh" && chmod +x "$FT_PKG_DIR/unpack.sh"

echo "bundle: $B"
du -sh "$B" "$FT_PKG_DIR" 2>/dev/null || true
if [ "$PKG_FAILS" -gt 0 ]; then
  echo "pack FAILED: $PKG_FAILS archive(s) failed post-compression verification"
  exit 1
fi
echo "pack OK (all archives verified)"
