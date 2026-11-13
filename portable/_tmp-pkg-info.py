#!/usr/bin/env python3
"""One-off (builder container, /out mounted): embed PACKAGE-INFO.txt into every
python-lib tool payload so its ~1KB archive is self-describing, then record dist-info
proof (installed version + .dist-info dir) for the receipt."""
import glob
import json
import os
import shlex
import subprocess

OUT = "/out"
PY = os.path.join(OUT, "runtimes", "python313", "bin", "python3.13")
SITE = os.path.join(OUT, "runtimes", "python313", "lib", "python3.13", "site-packages")
os.environ["PYTHONHOME"] = os.path.join(OUT, "runtimes", "python313")
os.environ["PYTHONNOUSERSITE"] = "1"

PY_DISTS = {
    "rdf-shacl": "pyshacl", "ortools": "ortools", "sympy": "sympy",
    "networkx": "networkx", "hypothesis": "hypothesis", "highs": "highspy",
    "dowhy": "dowhy", "pymc": "pymc", "causal-learn": "causal-learn",
    "simpy": "simpy", "mesa": "mesa",
}

for tool_dir in sorted(glob.glob(OUT + "/tools/*/")):
    tid = os.path.basename(tool_dir.rstrip("/"))
    if tid not in PY_DISTS:
        continue
    dist = PY_DISTS[tid]
    r = subprocess.run([PY, "-s", "-c",
        "import importlib.metadata as m; d=m.distribution('%s'); print(d.version); print(d._path)" % dist],
        capture_output=True, text=True)
    ver, _, dpath = r.stdout.strip().partition("\n")
    info = f"""PACKAGE-INFO — {tid} {ver}
=========================================
本压缩包只含该工具的启动 shim (run) 与元数据 (meta.json/meta.sh)。
{tid} 是 Python 库类工具：真正的程序本体已安装在共享运行时
runtimes/python313-3.13.5-linux-x86_64.tar.zst 的 site-packages 里
（所有 Python 库类工具共用这一个运行时，因此本包只有 ~1KB——这是设计，不是损坏）。

使用方法：用 core 包里的 bin/tool-runner 运行（它会设置 PYTHONHOME/LD_LIBRARY_PATH）：
  ./bin/tool-runner verify {tid}
  ./bin/tool-runner py <script.py>   # 脚本内 import {dist} 即可用

安装凭证：
  dist: {dist} {ver}
  dist-info: {dpath.strip()}
"""
    open(os.path.join(tool_dir, "PACKAGE-INFO.txt"), "w", encoding="utf-8", newline="\n").write(info)
    # persist the dist-info dir next to meta for the receipt
    meta = json.load(open(os.path.join(tool_dir, "meta.json"), encoding="utf-8"))
    meta["payload"] = "shared runtime: runtimes/python313-3.13.5-linux-x86_64.tar.zst"
    meta["dist_info"] = dpath.strip()
    json.dump(meta, open(os.path.join(tool_dir, "meta.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    ms = os.path.join(tool_dir, "meta.sh")
    with open(ms, "a", encoding="utf-8") as f:
        f.write("PAYLOAD=%s\n" % shlex.quote(meta["payload"]))
    print("info:", tid, ver)
