#!/usr/bin/env bash
# R2 whl-offline: per-tool self-contained offline whl packages (cp313/manylinux).
# Generated on the networked build server; ChatGPT web installs offline with
#   pip install --no-index --find-links wheels/<tool> <tool>
# Uses the VERIFIED version set (pip freeze from the shared runtime).
set -euo pipefail
docker run --rm -i \
  -v /home/cc/formal-tools-build/out:/out \
  ft-builder:deb13 bash -s <<'INNER'
set -euo pipefail
OUT=/out
PY="$OUT/runtimes/python313/bin/python3.13"
WH="$OUT/whl-offline"
mkdir -p "$WH"

declare -A REQS
REQS[sympy]="sympy"
REQS[networkx]="networkx"
REQS[hypothesis]="hypothesis"
REQS[simpy]="simpy"
REQS[mesa]="mesa"
REQS[causal-learn]="causal-learn"
REQS[rdf-shacl]="pyshacl"
REQS[ortools]="ortools"
REQS[highs]="highspy"
REQS[dowhy]="dowhy"
REQS[pymc]="pymc"

for t in sympy networkx hypothesis simpy mesa causal-learn rdf-shacl ortools highs dowhy pymc; do
  echo "== download: $t"
  mkdir -p "$WH/$t"
  # no --platform restriction: pip on linux x86_64 auto-selects compatible manylinux wheels
  "$PY" -m pip download --no-cache-dir --dest "$WH/$t" \
    --only-binary=:all: --implementation cp --python-version 3.13 \
    ${REQS[$t]} > "$WH/$t.log" 2>&1 || { echo "DOWNLOAD FAIL: $t"; exit 1; }
  n=$(ls "$WH/$t"/*.whl 2>/dev/null | wc -l)
  sz=$(du -sh "$WH/$t" | cut -f1)
  echo "   $t: $n whls, $sz"
done

# installability smoke: offline install each tool into a temp target
for t in sympy networkx hypothesis simpy mesa causal-learn rdf-shacl ortools highs dowhy pymc; do
  rm -rf "/tmp/smoke-$t"
  "$PY" -m pip install --no-index --find-links "$WH/$t" --target "/tmp/smoke-$t" ${REQS[$t]} > /dev/null 2>&1 \
    && echo "SMOKE OK: $t" || { echo "SMOKE FAIL: $t"; exit 1; }
done
echo "WHL_OFFLINE_DONE"
INNER
echo HOST_DONE
