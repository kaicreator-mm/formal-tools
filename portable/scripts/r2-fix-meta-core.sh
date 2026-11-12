#!/usr/bin/env bash
# R2 recovery: fix doubled TOOL_TOOL_* keys in all meta.sh, refresh bundle runner+tests
# from current src, re-tar core archive, update its SHA256SUMS line.
set -euo pipefail
source /home/cc/formal-tools-build/src/portable/env.sh
SRC=/home/cc/formal-tools-build/src/portable
B="$FT_BUNDLE/formal-tools-portable-debian13-x86_64"

# 1) meta.sh: TOOL_TOOL_* -> TOOL_* (out/tools + bundle), root container for perms
docker run --rm -v /home/cc/formal-tools-build/out:/out -v "$B:/b" -v "$SRC:/src:ro" \
  ft-builder:deb13 bash -c '
set -e
sed -i "s/^TOOL_TOOL_/TOOL_/" /out/tools/*/meta.sh /b/tools/*/meta.sh 2>/dev/null || true
cp /src/packaging/bundle-template/bin/tool-runner /b/bin/tool-runner
chmod +x /b/bin/tool-runner
rm -rf /b/tests && mkdir -p /b/tests
cp -a /src/verification/cases/. /b/tests/
echo META_AND_RUNNER_AND_TESTS_FIXED'

# 2) re-tar core archive from refreshed bundle parts
cd "$B"
tar -cf - bin tests registry licenses docs manifest.json evidence \
  | zstd --ultra -22 -T16 -q -f -o "$FT_PKG_DIR/formal-tools-portable-core-linux-x86_64.tar.zst"
zstd -t "$FT_PKG_DIR/formal-tools-portable-core-linux-x86_64.tar.zst"

# 3) update core line in SHA256SUMS
cd "$FT_PKG_DIR"
grep -v "formal-tools-portable-core-linux-x86_64.tar.zst" SHA256SUMS > S.tmp
sha256sum formal-tools-portable-core-linux-x86_64.tar.zst >> S.tmp
mv S.tmp SHA256SUMS

# 4) sanity: runner schema marker + meta keys
grep -c "runner_schema" "$B/bin/tool-runner" >/dev/null && echo RUNNER_HAS_SCHEMA
grep -m1 "^TOOL_ID=" "$B/tools/z3/meta.sh" && echo META_KEYS_OK
echo "CORE_FIXED"
