import io

p = "portable/scripts/r2-verify-loop.sh"
s = io.open(p, encoding="utf-8").read()

# stage A: insert split-part branch after the [ -f ] continue line
anchor_a = '[ -f "$path" ] || { echo -e "$path\\tMISSING" >> "$EV/stageA-archive.tsv"; continue; }'
insert_a = (
    anchor_a
    + "\n"
    + '  parts=$(ls "$path".part-?? 2>/dev/null | wc -l)\n'
    + '  if [ "$parts" -gt 0 ]; then\n'
    + '    cat "$path".part-?? > /tmp/r2-rejoin.tar.zst\n'
    + '    zt=$(zstd -t /tmp/r2-rejoin.tar.zst >/dev/null 2>&1 && echo OK || echo BAD)\n'
    + "    sha_now=$(sha256sum /tmp/r2-rejoin.tar.zst | cut -d' ' -f1)\n"
    + '    sha_ok=$([ "$sha_now" = "$hash" ] && echo OK || echo BAD)\n'
    + "    rm -f /tmp/r2-rejoin.tar.zst\n"
    + "  else\n"
)
assert anchor_a in s, "A anchor miss"
s = s.replace(anchor_a, insert_a, 1)

# close the else: after the existing sha_ok line in stage A (first occurrence)
old_sha_a = (
    '    sha_ok=$(echo "$hash  $path" | sha256sum -c --quiet >/dev/null 2>&1 && echo OK || echo BAD)\n'
    '    echo -e "$path\\tsha=$sha_ok\\tzstd=$zt" >> "$EV/stageA-archive.tsv"'
)
new_sha_a = (
    '    sha_ok=$(echo "$hash  $path" | sha256sum -c --quiet >/dev/null 2>&1 && echo OK || echo BAD)\n'
    "  fi\n"
    '    echo -e "$path\\tsha=$sha_ok\\tzstd=$zt" >> "$EV/stageA-archive.tsv"'
)
assert old_sha_a in s, "A sha close miss"
s = s.replace(old_sha_a, new_sha_a, 1)

# stage B: add split branch
old_b = (
    '          mkdir -p "/u/$(dirname "$path")"\n'
    '          tar --zstd -xf "$path" -C /u 2>> /u/unpack-errors.log || { echo "UNPACK FAIL: $path" >> /u/unpack-errors.log; err=1; }'
)
new_b = (
    '          mkdir -p "/u/$(dirname "$path")"\n'
    '          if [ -f "$path" ]; then\n'
    '            tar --zstd -xf "$path" -C /u 2>> /u/unpack-errors.log || { echo "UNPACK FAIL: $path" >> /u/unpack-errors.log; err=1; }\n'
    '          elif [ -f "$path.part-00" ]; then\n'
    '            cat "$path".part-?? | tar --zstd -xf - -C /u 2>> /u/unpack-errors.log || { echo "UNPACK FAIL(split): $path" >> /u/unpack-errors.log; err=1; }\n'
    '          else\n'
    '            echo "MISSING: $path" >> /u/unpack-errors.log; err=1\n'
    '          fi'
)
assert old_b in s, "B anchor miss"
s = s.replace(old_b, new_b, 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("split handling added (A + B)")
