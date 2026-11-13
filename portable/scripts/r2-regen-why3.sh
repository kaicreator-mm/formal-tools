#!/usr/bin/env bash
# One-off: regenerate why3 shim from CURRENT spec, re-tar why3 archive (so stage B
# unpack restores the fixed shim), then run the full R2 verify loop.
set -euo pipefail
# regen shim into out/tools (root container, python reads synced spec)
docker run --rm \
  -v /home/cc/formal-tools-build/src:/src:ro \
  -v /home/cc/formal-tools-build/out:/out \
  -v /home/cc/formal-tools-build/src/portable/scripts/r2-why3-final.py:/regen.py \
  ft-builder:deb13 python3 /regen.py
docker run --rm -v /home/cc/formal-tools-build/out:/out ft-builder:deb13 \
  chmod +x /out/tools/why3/run

# re-tar the why3 ARCHIVE so stage B unpack restores the fixed shim
docker run --rm -v /home/cc/formal-tools-build/out:/out ft-builder:deb13 bash -c '
set -euo pipefail
rm -f /out/packages/tools/why3-1.8.0-linux-x86_64.tar.zst
cd /out/bundle/formal-tools-portable-debian13-x86_64
tar -cf - tools/why3 | zstd --ultra -22 -T16 -q -f -o /out/packages/tools/why3-1.8.0-linux-x86_64.tar.zst
zstd -t /out/packages/tools/why3-1.8.0-linux-x86_64.tar.zst
echo ARCHIVE_RETAR_OK'

cd /home/cc/formal-tools-build
bash src/portable/scripts/r2-verify-loop.sh
