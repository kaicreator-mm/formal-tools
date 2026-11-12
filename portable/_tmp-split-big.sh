#!/usr/bin/env bash
# One-off: split delivery archives >150MiB into 150MiB parts (ChatGPT connector limit
# ~256MiB/file). Parts are named <archive>.part-NN; original single file removed.
# SHA256SUMS updated: one line per part; rejoin = cat parts > archive, then zstd -t.
set -euo pipefail
PKG=/home/cc/formal-tools-build/out/packages
cd "$PKG/tools"
LIMIT=$((150 * 1024 * 1024))
echo "== archives >150MiB =:"
for f in *.tar.zst; do
  s=$(stat -c %s "$f")
  [ "$s" -gt "$LIMIT" ] || continue
  echo "split: $f ($((s/1048576))MiB)"
  split -b 150m -d -a 2 "$f" "$f.part-"
  rm -f "$f"
done
cd "$PKG/runtimes"
for f in *.tar.zst; do
  s=$(stat -c %s "$f")
  [ "$s" -gt "$LIMIT" ] || continue
  echo "split: $f ($((s/1048576))MiB)"
  split -b 150m -d -a 2 "$f" "$f.part-"
  rm -f "$f"
done
cd "$PKG"
# rebuild SHA256SUMS from scratch over everything present (safest after churn)
find . -type f \( -name '*.tar.zst' -o -name '*.part-*' \) -printf '%P\n' | sort | xargs sha256sum > SHA256SUMS
echo "== part counts =="
for d in tools runtimes; do
  for f in "$d"/*.part-00; do
    [ -e "$f" ] || continue
    base=${f%.part-00}
    n=$(ls "$base".part-* | wc -l)
    echo "$base: $n parts, total $(du -ch "$base".part-* | tail -1 | cut -f1)"
  done
done
echo "SPLIT_OK"
