#!/usr/bin/env bash
# One-off: embed each python-lib tool's own site-packages subset into its payload,
# update shims (PYTHONPATH), PACKAGE-INFO, recompress each archive, update sums.
set -euo pipefail
source /home/cc/formal-tools-build/src/portable/env.sh
docker run --rm -i \
  -v "$FT_OUT:/out" \
  -v "$FT_BUNDLE:/b" \
  -v "$FT_PKG_DIR:/pkg" \
  ft-builder:deb13 python3 - <<'PYEOF'
import glob, os, shutil, subprocess, json

OUT = "/out"
SITE = os.path.join(OUT, "runtimes", "python313", "lib", "python3.13", "site-packages")
B = "/b"
PKG = "/pkg"
os.environ["PYTHONHOME"] = os.path.join(OUT, "runtimes", "python313")
os.environ["PYTHONNOUSERSITE"] = "1"

DISTS = {
    "sympy": ["sympy"],
    "networkx": ["networkx"],
    "hypothesis": ["hypothesis"],
    "dowhy": ["dowhy"],
    "pymc": ["pymc"],
    "causal-learn": ["causallearn"],
    "rdf-shacl": ["pyshacl"],
    "ortools": ["ortools"],
    "highs": ["highspy"],
    "simpy": ["simpy"],
    "mesa": ["mesa"],
}

def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print("CMD FAIL:", cmd[:120], r.stderr[-300:])
    return r.stdout.strip()

for tid, dists in DISTS.items():
    tdir = os.path.join(OUT, "tools", tid)
    pylib = os.path.join(tdir, "pylib")
    os.makedirs(pylib, exist_ok=True)
    copied = []
    for d in dists:
        for src in glob.glob(os.path.join(SITE, d)) + glob.glob(os.path.join(SITE, d + "-*.dist-info")):
            dst = os.path.join(pylib, os.path.basename(src))
            if os.path.exists(dst):
                shutil.rmtree(dst)
            shutil.copytree(src, dst, symlinks=True)
            copied.append(os.path.basename(src))
    # runtime version of the dist (from meta)
    meta = json.load(open(os.path.join(tdir, "meta.json"), encoding="utf-8"))
    ver = meta.get("version", "?")
    info = f"""PACKAGE-INFO - {tid} {ver}
================================================
本压缩包含:
  run              启动 shim（设置 PYTHONHOME/LD_LIBRARY_PATH/PYTHONPATH）
  meta.json/meta.sh 工具元数据（版本、ELF/glibc 审计）
  pylib/           本工具的 site-packages 子集（{", ".join(copied)}）
  PACKAGE-INFO.txt 本说明

共享数值依赖（numpy/scipy/pandas/matplotlib 等）在共享运行时
runtimes/python313-3.13.5-linux-x86_64.tar.zst 内，需一并解压。
运行方式: bin/tool-runner run {tid} … 或 bin/tool-runner py <script>
"""
    open(os.path.join(tdir, "PACKAGE-INFO.txt"), "w", encoding="utf-8", newline="\n").write(info)
    # shim: add PYTHONPATH line if missing
    run_p = os.path.join(tdir, "run")
    run = open(run_p, encoding="utf-8").read()
    if "PYTHONPATH" not in run:
        run = run.replace("export PYTHONHOME=", 'export PYTHONPATH="$TOOL_DIR/pylib"\nexport PYTHONHOME=', 1)
        open(run_p, "w", encoding="utf-8", newline="\n").write(run)
    print("embedded:", tid, "pylib dirs:", len(copied))

# refresh bundle copies + recompress per-tool archives
for tid, dists in DISTS.items():
    bdir = os.path.join(B, "tools", tid)
    if os.path.exists(bdir):
        shutil.rmtree(bdir)
    shutil.copytree(os.path.join(OUT, "tools", tid), bdir, symlinks=True)
    subprocess.run(["chmod", "-R", "a+rX", bdir], check=True)
    ver = json.load(open(os.path.join(bdir, "meta.json"), encoding="utf-8")).get("version", "?")
    ar = os.path.join(PKG, "tools", f"{tid}-{ver}-linux-x86_64.tar.zst")
    out = sh(f"cd /b && tar -cf - tools/{tid} | zstd --ultra -22 -T16 -q -f -o {ar}")
    sh(f"zstd -t {ar}")
    a = sh(f"zstd -dc {ar} | tar -tf - | wc -l")
    s = sh(f"cd /b && find tools/{tid} | wc -l")
    print(f"REPACK {tid}-{ver}: entries={a} src={s} size={os.path.getsize(ar)//1024}KB")
PYEOF
echo EMBED_DONE
# SHA256SUMS lines for the 11 (host side)
cd /home/cc/formal-tools-build/out/packages
for t in rdf-shacl ortools sympy networkx hypothesis highs dowhy pymc causal-learn simpy mesa; do
  grep -v "tools/$t-" SHA256SUMS > S.tmp
  sha256sum tools/$t-*linux-x86_64.tar.zst >> S.tmp
  mv S.tmp SHA256SUMS
done
echo SUMS_OK
