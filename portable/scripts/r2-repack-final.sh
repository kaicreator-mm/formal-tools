#!/usr/bin/env bash
# R2 recovery FINAL: single root container. Rebuild bundle/tools from out/tools,
# fix meta.sh keys, re-tar all tool archives into out/packages (zstd -22),
# integrity check each, regenerate tool lines in SHA256SUMS.
set -euo pipefail
docker run --rm \
  -v /home/cc/formal-tools-build/out:/out \
  ft-builder:deb13 bash -s <<'INNER'
set -euo pipefail
OUT=/out
B=/out/bundle/formal-tools-portable-debian13-x86_64
PKG=/out/packages

# 1) rebuild bundle/tools completely from out/tools
rm -rf "$B/tools"
mkdir -p "$B/tools"
for d in "$OUT"/tools/*/; do
  t=$(basename "$d")
  mkdir -p "$B/tools/$t"
  cp -a "$d." "$B/tools/$t/"
done

# 2) meta.sh key fix (TOOL_TOOL_* -> TOOL_*)
sed -i 's/^TOOL_TOOL_/TOOL_/' "$B"/tools/*/meta.sh
chmod -R a+rX "$B/tools"

# 3) re-tar all tool archives, iterating the archives in PKG
cd "$B"
for ar in "$PKG"/tools/*.tar.zst; do
  t=$(basename "$ar" | sed 's/-[0-9][^-]*-linux-x86_64\.tar\.zst$//')
  rm -f "$ar"
  tar -cf - "tools/$t" | zstd --ultra -22 -T16 -q -f -o "$ar"
  zstd -t "$ar"
  a=$(zstd -dc "$ar" | tar -tf - | wc -l)
  s=$(find "tools/$t" | wc -l)
  [ "$a" = "$s" ] || { echo "MISMATCH $t tar=$a src=$s"; exit 1; }
  echo "REPACK $(basename "$ar") entries=$a"
done

# 4) regenerate tool lines in SHA256SUMS
cd "$PKG"
grep -v 'tools/' SHA256SUMS > S.tmp
for f in tools/*.tar.zst; do sha256sum "$f"; done >> S.tmp
mv S.tmp SHA256SUMS
echo ALL_REPACK_OK
INNER
echo HOST_DONE
