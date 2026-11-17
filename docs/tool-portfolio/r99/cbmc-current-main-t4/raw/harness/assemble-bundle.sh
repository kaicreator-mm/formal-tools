#!/bin/bash
# CBMC current-main T4 R104 bundle assembly (root side, inside ft-builder:deb13).
# Overlay recipe (identical to the recorded R99 recipe):
#   original CBMC payload (Drive 11n3FyTfT..., sha eaa04909...)
# + original portable core (Drive 1xEUgLSTD..., sha fe9699e6...)
# + exact current-main Runner blob (b9a662f tree 40427c1, file sha 60af447e...)
# + current-main make_meta.py output (regenerated canonical TOOL_ID meta.sh)
# original meta.json byte-identical; original archives untouched.
set -eu
W=/w
rm -rf "$W/bundle" "$W/meta-scratch"
mkdir -p "$W/bundle" "$W/meta-scratch"
cp -a "$W/stage/core/." "$W/bundle/"
cp -a "$W/stage/cbmc/." "$W/bundle/"
cp "$W/repo/portable/packaging/bundle-template/bin/tool-runner" "$W/bundle/bin/tool-runner"
chmod +x "$W/bundle/bin/tool-runner"

# Regenerate meta.sh with the pinned current-main make_meta.py in a scratch dir
# (make_meta writes meta.json too; the bundle keeps the ORIGINAL meta.json).
M_TOOL_ID=cbmc M_TOOL_VERSION=6.11.0 M_TOOL_KIND=binary \
M_MAIN_BIN="tools/cbmc/bin/cbmc" M_GLIBC_MAX=2.38 M_ELF_ARCH=Advanced \
M_NEEDED="libstdc++.so.6,libm.so.6,libgcc_s.so.1,libc.so.6" \
M_VERSION_OUTPUT="6.11.0 (cbmc-6.11.0)" \
M_UPSTREAM_URL="https://github.com/diffblue/cbmc/releases/download/cbmc-6.11.0/ubuntu-24.04-cbmc-6.11.0-Linux.deb" \
M_BUILD_TS="2026-11-10T22:26:53Z" \
python3 "$W/repo/portable/builders/make_meta.py" "$W/meta-scratch"
cp "$W/meta-scratch/meta.sh" "$W/bundle/tools/cbmc/meta.sh"

echo "== overlay identity =="
sha256sum "$W/bundle/bin/tool-runner" "$W/bundle/tools/cbmc/meta.json" \
          "$W/bundle/tools/cbmc/meta.sh" "$W/bundle/tests/cbmc/expect.sh"

echo "== fixtures vs current-main tree =="
for f in expect.sh pos.c neg.c err.c; do
  cmp "$W/bundle/tests/cbmc/$f" "$W/repo/portable/verification/cases/cbmc/$f" \
    && echo "fixture $f IDENTICAL" || { echo "fixture $f DIFFERS"; exit 1; }
done

echo "== lock down bundle (write-protected) =="
chown -R root:root "$W/bundle"
chmod -R a-w "$W/bundle"
chmod -R a+rX "$W/bundle"
echo ASSEMBLE_DONE
