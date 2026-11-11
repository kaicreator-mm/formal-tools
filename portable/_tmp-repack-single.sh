#!/usr/bin/env bash
# One-off: single-tool repackage (aflpp) — rebuild payload with fixed shim, recompress
# ONLY its archive, update SHA256SUMS line. No full pack.
set -uo pipefail
source /home/cc/formal-tools-build/src/portable/env.sh
cd /home/cc/formal-tools-build
bash src/portable/orchestrate.sh build aflpp || exit 1
B="$FT_BUNDLE/formal-tools-portable-debian13-x86_64"
# refresh bundle copy for this tool only
rm -rf "$B/tools/aflpp" && mkdir -p "$B/tools/aflpp" && cp -a "$FT_OUT/tools/aflpp/." "$B/tools/aflpp/"
# recompress single archive
cd "$B"
tar -cf - tools/aflpp | zstd --ultra -22 -T16 -q -f -o "$FT_PKG_DIR/tools/aflpp-5.03c-linux-x86_64.tar.zst"
zstd -t "$FT_PKG_DIR/tools/aflpp-5.03c-linux-x86_64.tar.zst" || exit 1
a=$(zstd -dc "$FT_PKG_DIR/tools/aflpp-5.03c-linux-x86_64.tar.zst" | tar -tf - | wc -l)
s=$(find tools/aflpp | wc -l)
[ "$a" = "$s" ] || { echo "entry mismatch tar=$a src=$s"; exit 1; }
( cd "$FT_PKG_DIR" && grep -v "aflpp-5.03c" SHA256SUMS > S.tmp && sha256sum tools/aflpp-5.03c-linux-x86_64.tar.zst >> S.tmp && mv S.tmp SHA256SUMS )
echo "SINGLE_TOOL_REPACK_OK entries=$a"
