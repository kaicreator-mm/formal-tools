#!/usr/bin/env bash
# One-off: regen why3 shim (robust python file), then verify why3 single-tool.
set -euo pipefail
docker run --rm \
  -v /home/cc/formal-tools-build/src:/src:ro \
  -v /home/cc/formal-tools-build/out:/out \
  -v /home/cc/formal-tools-build/src/portable/scripts/r2-why3-final.py:/regen.py \
  ft-builder:deb13 python3 /regen.py
docker run --rm -v /home/cc/formal-tools-build/out:/out ft-builder:deb13 \
  chmod +x /out/tools/why3/run
cd /home/cc/formal-tools-build
rm -f out/evidence/r2/verify-why3.tsv out/evidence/r2/why3/verify-why3.*.log 2>/dev/null || true
SKIP_AB=1 bash src/portable/scripts/r2-verify-loop.sh > r2-why3-verify.log 2>&1
grep -E "why3 ->" r2-why3-verify.log || true
grep -E "LOOP_DONE|totals" r2-why3-verify.log | tail -2 || true
