#!/usr/bin/env bash
# One-off: atomic why3 repair + single-tool verify (root containers throughout).
set -euo pipefail
docker run --rm \
  -v /home/cc/formal-tools-build/out:/out \
  -v /home/cc/formal-tools-build/src:/src:ro \
  -v /home/cc/formal-tools-build/src/portable/scripts/r2-why3-atomic.py:/atomic.py \
  ft-builder:deb13 python3 /atomic.py
cd /home/cc/formal-tools-build
rm -f out/evidence/r2/verify-why3.tsv out/evidence/r2/why3/verify-why3.*.log 2>/dev/null || true
SKIP_AB=1 bash src/portable/scripts/r2-verify-loop.sh > r2-why3-atomic-verify.log 2>&1
grep -E "why3 ->" r2-why3-atomic-verify.log | tail -1
cd out/evidence/r2/why3 && grep verdict verify-why3.tsv | tail -1
