#!/usr/bin/env bash
# R2 recovery v3: single root container does EVERYTHING (bundle tools rebuild, meta key
# fix, per-tool re-tar, sums). Host only launches the container and prints the log.
set -euo pipefail
docker run --rm \
  -v /home/cc/formal-tools-build/out:/out \
  -v /home/cc/formal-tools-build/src:/src:ro \
  ft-builder:deb13 bash -c '
set -euo pipefail
OUT=/out
B=/out/bundle/formal-tools-portable-debian13-x86_64
PKG=/out/packages

# 1) rebuild bundle/tools COMPLETELY from out/tools (source of truth)
rm -rf /b/tools
mkdir -p /b/tools
for d in /out/tools/*/; do
  t=$(basename "$d")
  mkdir -p "/b/tools/$t"
  cp -a "$d." "/b/tools/$t/"
done

# 2) meta.sh key fix (TOOL_TOOL_* -> TOOL_*)
sed -i "s/^TOOL_TOOL_/TOOL_/" /b/tools/*/meta.sh
chmod -R a+rX /b/tools

# 3) re-tar all 36 tool archives (zstd -22) + integrity check
cd /b
for f in tools/*.tar.zst; do
  t=$(basename "$f" | sed "s/-[0-9][^-]*-linux-x86_64.tar.zst//")
  ar=/pkg/$f
  rm -f "$ar"
  tar -cf - "tools/$t" | zstd --ultra -22 -T16 -q -f -o "$ar"
  zstd -t "$ar"
  a=$(zstd -dc "$ar" | tar -tf - | wc -l)
  s=$(find "tools/$t" | wc -l)
  [ "$a" = "$s" ] || { echo "MISMATCH $t tar=$a src=$s"; exit 1; }
  echo "REPACK $f entries=$a"
done

# 4) regenerate tool lines in SHA256SUMS
cd /pkg
grep -v "tools/" SHA256SUMS > S.tmp
for f in tools/*.tar.zst; do sha256sum "$f"; done >> S.tmp
mv S.tmp SHA256SUMS
echo ALL_REPACK_OK
'
echo HOST_DONE
