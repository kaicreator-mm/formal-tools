#!/usr/bin/env bash
# One-off: nuxmv single-tool repackage — rebuild (probe/shim fixes), refresh bundle
# tool dir + tests, recompress ONLY its archive, update SHA256SUMS, verify.
set -uo pipefail
source /home/cc/formal-tools-build/src/portable/env.sh
cd /home/cc/formal-tools-build
bash src/portable/orchestrate.sh build nuxmv || exit 1
docker run --rm \
  -v "$FT_OUT/tools/nuxmv:/src-tool" \
  -v "$FT_SRC/verification/cases/nuxmv:/src-cases" \
  -v "$FT_BUNDLE:/b" \
  -v "$FT_PKG_DIR:/pkg" \
  ft-builder:deb13 bash -c '
set -euo pipefail
rm -rf /b/tools/nuxmv && mkdir -p /b/tools/nuxmv
cp -a /src-tool/. /b/tools/nuxmv/
chmod -R a+rX /b/tools/nuxmv
[ -x /b/tools/nuxmv/bin/nuXmv ] || { echo "BIN MISSING"; exit 3; }
rm -rf /b/tests/nuxmv && mkdir -p /b/tests/nuxmv && cp -a /src-cases/. /b/tests/nuxmv/
cd /b
tar -cf - tools/nuxmv | zstd --ultra -22 -T16 -q -f -o /pkg/tools/nuxmv-2.2.0-linux-x86_64.tar.zst
zstd -t /pkg/tools/nuxmv-2.2.0-linux-x86_64.tar.zst
a=$(zstd -dc /pkg/tools/nuxmv-2.2.0-linux-x86_64.tar.zst | tar -tf - | wc -l)
s=$(find tools/nuxmv | wc -l)
[ "$a" = "$s" ] || { echo "entry mismatch tar=$a src=$s"; exit 1; }
echo "SINGLE_REPACK_OK entries=$a"
'
cd "$FT_PKG_DIR"
grep -v "nuxmv-2.2.0" SHA256SUMS > S.tmp && sha256sum tools/nuxmv-2.2.0-linux-x86_64.tar.zst >> S.tmp && mv S.tmp SHA256SUMS
echo "SUMS_UPDATED"
cd /home/cc/formal-tools-build
bash src/portable/orchestrate.sh verify nuxmv 2>&1 | tail -4
