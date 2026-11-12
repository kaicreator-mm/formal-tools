#!/usr/bin/env python3
"""R2: per-tool self-contained Python dependency closures + slim runtime (root container).

Stage 1: per-tool pip closure into /out/tools/<t>/pydeps (tool itself + ALL deps,
  versions pinned to the verified shared-runtime set via pip freeze constraints).
Stage 2: shim PYTHONPATH -> pydeps, PACKAGE-INFO rewrite (self-contained closure).
Stage 3: slim python313 runtime tree (interpreter + stdlib, no third-party packages).
Stage 4: refresh bundle/tools copies for the 11 tools.
"""
import glob
import json
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

CONSTRAINTS = "/tmp/r2-constraints.txt"
env = dict(os.environ)
env["PYTHONHOME"] = os.path.join(OUT, "runtimes", "python313")
env["PYTHONNOUSERSITE"] = "1"
env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"

print("== stage 1: constraints from verified shared runtime ==")
r = subprocess.run([PY, "-m", "pip", "freeze", "--all"], capture_output=True, text=True)
open(CONSTRAINTS, "w", encoding="utf-8", newline="\n").write(r.stdout)
print("pins:", r.stdout.count("\n"))

TOOLS = sorted(REQS)
for tid in TOOLS:
    print(f"== closure: {tid} ==")
    tdir = os.path.join(OUT, "tools", tid)
    pydeps = os.path.join(tdir, "pydeps")
    if os.path.exists(pydeps):
        shutil.rmtree(pydeps)
    os.makedirs(pydeps)
    r = subprocess.run(
        [PY, "-m", "pip", "install", "--no-cache-dir", "--target", pydeps,
         "-c", CONSTRAINTS] + REQS[tid],
        capture_output=True, text=True)
    if r.returncode != 0:
        print("PIP FAIL:", tid, r.stderr[-400:])
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
    sz = subprocess.run(["du", "-sh", pydeps], capture_output=True, text=True).stdout.split()[0]
    print(f"  {tid} closure: {sz}")

print("== stage 3: slim python313 runtime tree ==")
SLIM = os.path.join(OUT, "runtimes", "python313-slim")
if os.path.exists(SLIM):
    shutil.rmtree(SLIM)
shutil.copytree(os.path.join(OUT, "runtimes", "python313"), SLIM, symlinks=True)
sp = os.path.join(SLIM, "lib", "python3.13", "site-packages")
shutil.rmtree(sp)
os.makedirs(sp)
subprocess.run(["chmod", "-R", "a+rX", SLIM], check=True)
print("SLIM_TREE_OK")

print("== stage 4: refresh bundle/tools copies ==")
BDIR = os.path.join(OUT, "bundle", "formal-tools-portable-debian13-x86_64", "tools")
for tid in REQS:
    src = os.path.join(OUT, "tools", tid)
    dst = os.path.join(BDIR, tid)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, symlinks=True)
    subprocess.run(["chmod", "-R", "a+rX", dst], check=True)
print("BUNDLE_REFRESH_OK")
