#!/usr/bin/env bash
# R2 stage: pydeps closures + slim runtime (root container via python script),
# then re-tar affected archives + sums, then README regen happens separately.
set -euo pipefail
docker run --rm \
  -v /home/cc/formal-tools-build/out:/out \
  -v /home/cc/formal-tools-build/src/portable/scripts/r2-pydeps-split.py:/split.py \
  ft-builder:deb13 python3 /split.py

# refresh bundle copies for the 11 python-lib tools (root container, post-closure)
docker run --rm \
  -v /home/cc/formal-tools-build/out:/out \
  ft-builder:deb13 python3 - <<'PYEOF'
import os, shutil, subprocess
OUT = "/out"
B = os.path.join(OUT, "bundle", "formal-tools-portable-debian13-x86_64", "tools")
for t in ("sympy","networkx","hypothesis","simpy","mesa","causal-learn","rdf-shacl","ortools","highs","dowhy","pymc"):
    src = os.path.join(OUT, "tools", t)
    dst = os.path.join(B, t)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, symlinks=True)
    subprocess.run(["chmod", "-R", "a+rX", dst], check=True)
print("BUNDLE_TOOLS_REFRESH_OK")
PYEOF

# core archive re-tar (carries CURRENT tests incl. fc symlink? — symlink created below)
docker run --rm \
  -v /home/cc/formal-tools-build/out:/out \
  -v /home/cc/formal-tools-build/src/portable/verification/cases/fast-check:/fcsrc \
  ft-builder:deb13 bash -c '
set -euo pipefail
B=/out/bundle/formal-tools-portable-debian13-x86_64
mkdir -p $B/tests/fast-check
cp /fcsrc/expect.sh /fcsrc/pos.mjs /fcsrc/neg.mjs $B/tests/fast-check/ 2>/dev/null || true
cd $B/tests/fast-check && ln -sfn ../../tools/fast-check/node_modules node_modules
chmod -R a+rX $B/tests
rm -f /out/packages/formal-tools-portable-core-linux-x86_64.tar.zst
cd $B
tar -cf - bin tests registry licenses docs manifest.json evidence | zstd --ultra -22 -T16 -q -f -o /out/packages/formal-tools-portable-core-linux-x86_64.tar.zst
zstd -t /out/packages/formal-tools-portable-core-linux-x86_64.tar.zst
echo CORE_RETAR_OK'

# per-tool archive re-tar (11) — archives consumed then recreated with pydeps
cd /home/cc/formal-tools-build/out/bundle/formal-tools-portable-debian13-x86_64
for t in sympy networkx hypothesis simpy mesa causal-learn rdf-shacl ortools highs dowhy pymc; do
  ver=$(cat tools/$t/meta.json | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])")
  ar=/home/cc/formal-tools-build/out/packages/tools/$t-$ver-linux-x86_64.tar.zst
  rm -f "$ar"
  tar -cf - "tools/$t" | zstd --ultra -22 -T16 -q -f -o "$ar"
  zstd -t "$ar"
  echo "REPACK $t-$ver"
done
echo TOOL_RETARS_DONE
