#!/bin/sh
# unpack.sh — reassemble + verify + extract the split portable package (zstd format).
# Usage:  sh unpack.sh [--parts-dir DIR] [--dest DIR]
#   --parts-dir  directory containing the split parts + SHA256SUMS (default: this script's dir)
#   --dest       extraction target (default: ./formal-tools-portable-debian13-x86_64)
# Requires: sha256sum, zstd, tar (Debian: apt install zstd).
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PARTS_DIR=""
DEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --parts-dir) PARTS_DIR="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
PARTS_DIR="${PARTS_DIR:-$HERE}"
BASE="formal-tools-portable-debian13-x86_64"
DEST="${DEST:-./$BASE}"

cd "$PARTS_DIR"
echo "== verify SHA256SUMS =="
sha256sum -c SHA256SUMS

echo "== reassemble =="
cat "$BASE.tar.zst.split-"* > "/tmp/$BASE.tar.zst"
echo "== integrity =="
zstd -t "/tmp/$BASE.tar.zst"
echo "== extract to $DEST =="
mkdir -p "$DEST"
tar --zstd -xf "/tmp/$BASE.tar.zst" -C "$DEST"
rm -f "/tmp/$BASE.tar.zst"
echo "== done =="
echo "Next steps:"
echo "  $DEST/$BASE/bin/tool-runner list"
echo "  $DEST/$BASE/bin/tool-runner doctor all"
echo "  $DEST/$BASE/bin/tool-runner verify all   # FT_EVIDENCE_DIR=<writable dir> recommended"
