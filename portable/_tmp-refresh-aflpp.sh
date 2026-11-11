#!/usr/bin/env bash
# One-off: refresh bundle/tools/aflpp from out/tools (root container for perms),
# recompress ONLY the aflpp archive, update SHA256SUMS, assert shim freshness.
set -uo pipefail
source /home/cc/formal-tools-build/src/portable/env.sh
docker run --rm -v "$FT_OUT/tools/aflpp:/src-tool" -v "$FT_BUNDLE:/b" ft-builder:deb13 bash -c '
  rm -rf /b/tools/aflpp && mkdir -p /b/tools/aflpp
  cp -a /src-tool/. /b/tools/aflpp/
  chmod -R a+rX /b/tools/aflpp
  grep -q plot_data /b/tools/aflpp/run || { echo "STALE SHIM"; exit 3; }
  echo BUNDLE_REFRESH_OK'
cd "$FT_BUNDLE"
tar -cf - tools/aflpp | zstd --ultra -22 -T16 -q -f -o "$FT_PKG_DIR/tools/aflpp-5.03c-linux-x86_64.tar.zst"
zstd -t "$FT_PKG_DIR/tools/aflpp-5.03c-linux-x86_64.tar.zst" || exit 1
a=$(zstd -dc "$FT_PKG_DIR/tools/aflpp-5.03c-linux-x86_64.tar.zst" | tar -tf - | wc -l)
s=$(find tools/aflpp | wc -l)
[ "$a" = "$s" ] || { echo "entry mismatch tar=$a src=$s"; exit 1; }
( cd "$FT_PKG_DIR" && grep -v "aflpp-5.03c" SHA256SUMS > S.tmp && sha256sum tools/aflpp-5.03c-linux-x86_64.tar.zst >> S.tmp && mv S.tmp SHA256SUMS )
echo "SINGLE_REPACK_OK entries=$a"
