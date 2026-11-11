#!/usr/bin/env bash
# server-side launcher: clean slate -> single pack instance (no ssh-session coupling)
for pat in 'orchestrate' 'zstd ' 'tar -cf'; do
  pgrep -f "$pat" 2>/dev/null | while read -r p; do kill -9 "$p" 2>/dev/null; done
done
sleep 3
left=$(pgrep -f 'orchestrate|zstd' 2>/dev/null | wc -l)
echo "remaining=$left"
if [ "$left" != 0 ]; then
  echo "ABORT: processes survived cleanup"
  exit 3
fi
cd /home/cc/formal-tools-build
rm -f repack-zstd4.log
nohup bash src/portable/orchestrate.sh pack > repack-zstd4.log 2>&1 < /dev/null &
echo "PACK_PID=$!"
