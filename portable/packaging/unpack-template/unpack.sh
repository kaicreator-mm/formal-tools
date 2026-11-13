#!/bin/sh
# unpack.sh — verify + extract the per-tool archives into a complete bundle tree.
# Distribution layout: one .tar.zst per tool + one per shared runtime + one core archive
# (bin/tool-runner, tests/, registry/, manifest.json, evidence/). All zstd -22.
# Usage:  sh unpack.sh [--src DIR] [--dest DIR]
# Requires: sha256sum, zstd, tar (Debian: apt install zstd).
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SRC=""
DEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
SRC="${SRC:-$HERE}"
BASE="formal-tools-portable-debian13-x86_64"
DEST="${DEST:-./$BASE}"

cd "$SRC"
echo "== verify SHA256SUMS =="
sha256sum -c SHA256SUMS

echo "== extract core + runtimes + tools into $DEST =="
mkdir -p "$DEST"
for ar in formal-tools-portable-core-linux-x86_64.tar.zst runtimes/*.tar.zst tools/*.tar.zst; do
  [ -f "$ar" ] || continue
  tar --zstd -xf "$ar" -C "$DEST"
done

echo "== done =="
echo "Next steps:"
echo "  $DEST/bin/tool-runner list"
echo "  $DEST/bin/tool-runner doctor all"
echo "  $DEST/bin/tool-runner verify all   # FT_EVIDENCE_DIR=<writable dir> recommended"
