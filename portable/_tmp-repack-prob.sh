#!/usr/bin/env bash
# One-off: single-tool repackage for prob — full 1.16.1 distribution (tcltk releases).
# Channel: stups.hhu-hosting.de/downloads/prob/tcltk/releases/1.16.1/ProB.linux64.tar.gz
# (contains probcliparser.jar + non-expired SICStus runtime; slim cli zips lack the jar).
set -uo pipefail
source /home/cc/formal-tools-build/src/portable/env.sh
cd /home/cc/formal-tools-build
bash src/portable/orchestrate.sh build prob || exit 1
docker run --rm \
  -v "$FT_OUT/tools/prob:/src-tool" \
  -v "$FT_SRC/verification/cases/prob:/src-cases" \
  -v "$FT_BUNDLE:/b" \
  -v "$FT_PKG_DIR:/pkg" \
  ft-builder:deb13 bash -c '
set -euo pipefail
rm -rf /b/tools/prob && mkdir -p /b/tools/prob
cp -a /src-tool/. /b/tools/prob/
chmod -R a+rX /b/tools/prob
[ -f /b/tools/prob/lib/probcliparser.jar ] || { echo "MISSING PARSER JAR"; exit 3; }
rm -rf /b/tests/prob && mkdir -p /b/tests/prob && cp -a /src-cases/. /b/tests/prob/
cd /b
tar -cf - tools/prob | zstd --ultra -22 -T16 -q -f -o /pkg/tools/prob-1.16.1-linux-x86_64.tar.zst
zstd -t /pkg/tools/prob-1.16.1-linux-x86_64.tar.zst
a=$(zstd -dc /pkg/tools/prob-1.16.1-linux-x86_64.tar.zst | tar -tf - | wc -l)
s=$(find tools/prob | wc -l)
[ "$a" = "$s" ] || { echo "entry mismatch tar=$a src=$s"; exit 1; }
echo "SINGLE_REPACK_OK entries=$a"
'
cd "$FT_PKG_DIR"
grep -v "prob-1.16.1" SHA256SUMS > S.tmp && sha256sum tools/prob-1.16.1-linux-x86_64.tar.zst >> S.tmp && mv S.tmp SHA256SUMS
echo "SUMS_UPDATED"
cd /home/cc/formal-tools-build
bash src/portable/orchestrate.sh verify prob 2>&1 | tail -4
