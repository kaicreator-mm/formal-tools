#!/usr/bin/env bash
# R2: build per-tool self-contained Python dependency closures + slim runtime.
# Stage 1 (root container): per-tool pip closures into out/tools/<t>/pydeps, shim
#   PYTHONPATH update, PACKAGE-INFO, slim python313 runtime tree.
# Stage 2 (host): re-tar the slim runtime archive; tool archives re-tarred later by
#   r2-repack-final.sh (which rebuilds bundle/tools from out/tools).
set -euo pipefail
docker run --rm -i \
  -v /home/cc/formal-tools-build/out:/out \
  ft-builder:deb13 python3 - <<'PYEOF'
import os
import re
import shutil
import subprocess
import sys

OUT = "/out"
PY = os.path.join(OUT, "runtimes", "python313", "bin", "python3.13")
SITE = os.path.join(OUT, "runtimes", "python313", "lib", "python3.13", "site-packages")

REQS = {
    "sympy": ["sympy"],
    "networkx": ["networkx"],
    "hypothesis": ["hypothesis"],
    "simpy": ["simpy"],
    "mesa": ["mesa"],
    "causal-learn": ["causal-learn"],
    "rdf-shacl": ["pyshacl"],
    "ortools": ["ortools"],
    "highs": ["highspy"],
    "dowhy": ["dowhy"],
    "pymc": ["pymc"],
}

CONSTRAINTS = "/out/pkgs-tmp/constraints.txt"
os.makedirs("/out/pkgs-tmp", exist_ok=True)
env = dict(os.environ)
env["PYTHONHOME"] = os.path.join(OUT, "runtimes", "python313")
env["PYTHONNOUSERSITE"] = "1"
env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"

r = subprocess.run([PY, "-m", "pip", "freeze", "--all"], capture_output=True, text=True)
open(CONSTRAINTS, "w", encoding="utf-8", newline="\n").write(r.stdout)
print("constraints pins:", r.stdout.count("\n"))

for tid, req in REQS.items():
    tdir = os.path.join(OUT, "tools", tid)
    pydeps = os.path.join(tdir, "pydeps")
    if os.path.exists(pydeps):
        shutil.rmtree(pydeps)
    os.makedirs(pydeps)
    r = subprocess.run(
        [PY, "-m", "pip", "install", "--no-cache-dir", "--target", pydeps,
         "-c", CONSTRAINTS] + req, capture_output=True, text=True)
    if r.returncode != 0:
        print("PIP FAIL:", tid, r.stderr[-300:])
        sys.exit(1)
    # shim: PYTHONPATH -> pydeps (self-contained closure)
    run_p = os.path.join(tdir, "run")
    run = open(run_p, encoding="utf-8").read()
    if "pydeps" not in run:
        run = run.replace(
            "export PYTHONHOME=",
            'export PYTHONPATH="$TOOL_DIR/pydeps"\nexport PYTHONHOME=', 1)
        open(run_p, "w", encoding="utf-8", newline="\n").write(run)
    ver = "?"
    mp = os.path.join(tdir, "meta.json")
    if os.path.isfile(mp):
        ver = json.load(open(mp, encoding="utf-8")).get("version", "?")
    info = (
        f"PACKAGE-INFO - {tid} {ver}\n"
        "================================================\n"
        "本压缩包自包含: pydeps/ = 本工具本体 + 完整 Python 依赖闭包\n"
        "（含 numpy/scipy/pandas 等共享数值栈——按需重复打包，单工具即下即用）。\n"
        "运行方式: bin/tool-runner run " + tid + " … 或 bin/tool-runner py <script>\n"
        "（shim 自动设置 PYTHONHOME/PYTHONPATH，无需系统 Python）\n"
    )
    open(os.path.join(tdir, "PACKAGE-INFO.txt"), "w", encoding="utf-8", newline="\n").write(info)
    subprocess.run(["chmod", "-R", "a+rX", pydeps], check=True)
    print("closure:", tid, "pydeps=", end=" ")
    print(subprocess.run(["du", "-sh", pydeps], capture_output=True, text=True).stdout.split()[0])

# slim python313 runtime: interpreter + stdlib only (no third-party site-packages)
SLIM = os.path.join(OUT, "runtimes", "python313-slim")
if os.path.exists(SLIM):
    shutil.rmtree(SLIM)
shutil.copytree(os.path.join(OUT, "runtimes", "python313"), SLIM, symlinks=True)
sp = os.path.join(SLIM, "lib", "python3.13", "site-packages")
shutil.rmtree(sp)
os.makedirs(sp)
subprocess.run(["chmod", "-R", "a+rX", SLIM], check=True)

import tarfile
ar = "/out/packages/python313-slim-3.13.5-linux-x86_64.tar.zst"
with tarfile.open(ar, "w:zst") as tf:
    tf.add(SLIM, arcname=".")
print("SLIM_OK", os.path.getsize(ar) // 1048576, "MB")

# also refresh bundle/tools copies for the 3 rebuilt tools
for tid in REQS:
    src = os.path.join(OUT, "tools", tid)
    dst = os.path.join(OUT, "bundle", "formal-tools-portable-debian13-x86_64", "tools", tid)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, symlinks=True)
    subprocess.run(["chmod", "-R", "a+rX", dst], check=True)
print("BUNDLE_TOOLS_REFRESHED")
PYEOF
echo CLOSURES_DONE
