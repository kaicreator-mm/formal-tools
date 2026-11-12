#!/usr/bin/env bash
# R2 task 1 (server): split archives >128MiB into 128MiB parts. ORIGINALS KEPT.
# Parts land beside originals in out/packages/{tools,runtimes}; SHA256SUMS gains one
# line per part (original lines kept). Receipt: SPLITS/SPLIT_RECEIPT.md + PART-SHA256SUMS.
# Rejoin (⚠️ explicit part numbers; a part-* glob would swallow .part-SHA256SUMS):
#   cat <archive>.part-00 <archive>.part-01 … > <archive>
#   zstd -t <archive> && sha256 must equal the original recorded in the receipt.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../env.sh
source "$HERE/env.sh"

LIMIT=$((128 * 1024 * 1024))
mkdir -p "$FT_PKG_DIR/SPLITS"
R="$FT_PKG_DIR/SPLITS/SPLIT_RECEIPT.md"
P="$FT_PKG_DIR/SPLITS/PART-SHA256SUMS"
: > "$P"
{
  echo "# R2 分卷收据（≤128MiB/卷，保留原包）"
  echo ""
  echo "生成: $(date -u '+%Y-%m-%dT%H:%M:%SZ')  分卷规则: split -b 128m -d -a 2（原包保留，分卷行追加进 SPLITS/PART-SHA256SUMS，主 SHA256SUMS 原行不变）"
  echo "重组（⚠️ 必须显式按序号列出，勿用 part-* 通配——目录里有 <archive>.part-SHA256SUMS"
  echo "       会被 cat 一起拼进去导致格式错误，本地演练曾复现）："
  echo "       cat <archive>.part-00 <archive>.part-01 … > <archive>"
  echo "       校验: zstd -t <archive>；且重组后 sha256 必须等于表中原始 SHA256"
  echo ""
  echo "| 归档 | 原始大小 | 原始 SHA256 | 分卷数 |"
  echo "|---|---|---|---|"
} > "$R"

cd "$FT_PKG_DIR"
for f in tools/*.tar.zst runtimes/*.tar.zst; do
  s=$(stat -c %s "$f")
  [ "$s" -gt "$LIMIT" ] || continue
  base=$(basename "$f")
  echo "split: $base ($((s/1048576))MiB)"
  rm -f "$base".part-*
  split -b 128m -d -a 2 "$f" "$base.part-"
  sha=$(sha256sum "$f" | cut -d' ' -f1)
  n=$(ls "$base".part-?? | wc -l)
  echo "| \`$base\` | $s | \`$sha\` | $n |" >> "$R"
  ls "$base".part-?? | while read -r p; do sha256sum "$p"; done >> "$P"
done
echo "SPLIT_DONE: receipt=$R part-sums=$P parts_total=$(cat "$P" | wc -l)"
