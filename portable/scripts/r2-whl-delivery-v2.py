#!/usr/bin/env python3
"""Regenerate whl delivery zips with standard whl-style naming + max compression.
Naming: <tool>-<version>-cp313-cp313-manylinux_2_39_x86_64.zip (mirrors whl convention)
Compression: ZIP_DEFLATED compresslevel=9 (zlib max)."""
import hashlib
import json
import os
import shutil
import zipfile

WH = "/out/whl-offline"
PKG = "/out/packages/whl-delivery"
B = "/out/bundle/formal-tools-portable-debian13-x86_64"
os.makedirs(PKG, exist_ok=True)

# clear old zips
for f in os.listdir(PKG):
    if f.endswith(".zip"):
        os.remove(os.path.join(PKG, f))

DIST_NAMES = {"rdf-shacl": "pyshacl", "highs": "highspy"}
PLATFORM_TAG = "manylinux_2_39_x86_64"

TOOLS = sorted(
    t for t in os.listdir(WH) if os.path.isdir(os.path.join(WH, t))
)

L = [
    "# formal-tools Python 工具 — whl 离线交付包",
    "",
    "Debian 13 x86_64 / glibc ≤ 2.41 / CPython 3.13 / manylinux whl。",
    "ChatGPT web Linux 沙箱或任意 Debian/Ubuntu Linux 环境：自带 python3 + pip，零额外依赖。",
    "",
    "## 快速开始",
    "",
    "```sh",
    "# 解压想要的工具 zip（示例：sympy）",
    "unzip sympy-whl.zip -d sympy-whl",
    "# 离线安装（一条命令，--no-index 表示不联网）",
    "pip install --no-index --find-links sympy-whl/ sympy",
    "# 验证",
    "python3 -c 'import sympy; print(sympy.__version__)'",
    "```",
    "",
    "## 交付包命名",
    "",
    "遵循 whl 命名规范：`<package_name>-<version>-cp313-cp313-manylinux_2_39_x86_64.zip`",
    "（内容为 whl 离线安装集，非单个 whl；扩展名 .zip 表示 zip 容器格式）",
    "",
    "## 工具一览",
    "",
    "| 交付包 | whl 数 | 大小 | pip 安装命令 |",
    "|---|---|---|---|",
]

zip_sha_lines = []

for t in TOOLS:
    d = os.path.join(WH, t)
    whls = sorted(f for f in os.listdir(d) if f.endswith(".whl"))
    sz = subprocess.run(["du", "-sh", d], capture_output=True, text=True).stdout.split()[0] if os.path.isdir(d) else "?"
    dist = DIST_NAMES.get(t, t)

    # version from meta.json in bundle
    mp = os.path.join(B, "tools", t, "meta.json")
    ver = "?"
    if os.path.isfile(mp):
        ver = json.load(open(mp, encoding="utf-8")).get("version", "?")

    # whl-style naming
    zname = f"{dist}-{ver}-cp313-cp313-{PLATFORM_TAG}.zip"
    z = os.path.join(PKG, zname)

    # max compression
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for f in sorted(os.listdir(d)):
            zf.write(os.path.join(d, f), f)

    h = hashlib.sha256(open(z, "rb").read()).hexdigest()
    zip_sha_lines.append(f"{h}  {zname}\n")

    sz = os.path.getsize(z) // 1024
    L.append(f"| `{zname}` | {len(whls)} whls | {sz} KB | `pip install --no-index --find-links {t}/ {dist}` |")
    print("zip:", zname, sz, "KB")

    # per-tool SHA256SUMS inside whl-offline dir
    sha_lines = []
    for w in whls:
        wh = hashlib.sha256(open(os.path.join(d, w), "rb").read()).hexdigest()
        sha_lines.append(f"{wh}  {w}\n")
    open(os.path.join(d, "SHA256SUMS"), "w", encoding="utf-8", newline="\n").write("".join(sha_lines))

L += [
    "",
    "## 安装方式（ChatGPT web Linux 沙箱）",
    "",
    "1. 从 Drive 下载目标工具的 zip（如 `sympy-1.14.0-cp313-cp313-manylinux_2_39_x86_64.zip`）",
    "2. 解压到工作目录",
    "3. `pip install --no-index --find-links <解压目录>/ <包名>`",
    "4. `import <模块名>` 即可使用",
    "",
    "- **不需要网络**：所有依赖 whl 都在目录里，`--no-index` 禁止联网",
    "- **不需要 root**：pip 安装到用户目录或 --target 指定路径",
    "- **不需要自定义 shim**：标准 pip 流程，ChatGPT 沙箱原生兼容",
    "- **不需要额外依赖**：python3 + pip 即可（ChatGPT 沙箱默认自带）",
    "",
    "## 注意事项",
    "",
    "- 每个工具的依赖闭包是**自包含的**：包含 numpy/scipy/pandas 等共享数值栈",
    "  （多个工具 zip 里会有重复的 numpy/scipy whl——按需独立安装的设计代价）",
    "- whl 目标平台: manylinux x86_64（Debian 13/Ubuntu 22.04+ 均兼容）",
    "- Python 版本: CPython 3.13（ChatGPT 沙箱默认 python3 版本，兼容 3.13）",
    "- 纯 Python 工具（sympy/networkx/hypothesis/simpy/mesa）whl 极小（<3MB）",
    "- 含二进制扩展的工具（ortools/pymc/highs/causal-learn/dowhy）较大但功能完整",
    "",
    "## SHA256",
    "",
    "每个 zip 内含 `SHA256SUMS`（逐 whl 校验）；zip 本身的 SHA256 见 `SHA256SUMS-ZIPS`。",
]

out = os.path.join(PKG, "INSTALL.md")
open(out, "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")

open(os.path.join(PKG, "SHA256SUMS-ZIPS"), "w", encoding="utf-8", newline="\n").write("".join(zip_sha_lines))
print("DELIVERY_OK:", len(TOOLS), "zips")
