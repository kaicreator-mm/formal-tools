#!/usr/bin/env bash
# One-off finalize: core archive + SHA256SUMS + unpack.sh (whole-bundle split was dropped
# per delivery decision: one archive per tool; runtimes per runtime; core = runner/tests/
# registry/manifest/docs/evidence).
set -uo pipefail
source /home/cc/formal-tools-build/src/portable/env.sh
B="$FT_BUNDLE"
PKG="$FT_PKG_DIR"
HERE="$FT_SRC/packaging"
rm -f "$PKG"/formal-tools-portable-debian13-x86_64.tar.zst*

echo "== core archive (zstd -22) =="
CORE="$PKG/formal-tools-portable-core-linux-x86_64.tar.zst"
rm -f "$CORE"
( cd "$B" && tar -cf - bin tests registry licenses docs manifest.json evidence | \
    zstd --ultra -22 -T16 -q -o "$CORE" )
zstd -t "$CORE" || { echo "VERIFY FAIL: core"; exit 1; }
a=$(zstd -dc "$CORE" 2>/dev/null | tar -tf - 2>/dev/null | wc -l)
s=$(cd "$B" && find bin tests registry licenses docs manifest.json evidence | wc -l)
[ "$a" = "$s" ] || { echo "VERIFY FAIL(entries): core tar=$a src=$s"; exit 1; }
echo "verify OK: core ($a entries)"

echo "== SHA256SUMS + unpack =="
( cd "$PKG" && find . -type f \( -name '*.tar.zst' -o -name 'tools/*.tar.zst' -o -name 'runtimes/*.tar.zst' \) -printf '%P\n' \
    | grep -v '^SHA256SUMS$' | sort | xargs sha256sum > SHA256SUMS )
cp "$HERE/unpack-template/unpack.sh" "$PKG/unpack.sh" && chmod +x "$PKG/unpack.sh"
wc -l "$PKG/SHA256SUMS"
du -sh "$PKG"
echo "FINALIZE OK"
