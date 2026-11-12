#!/usr/bin/env python3
"""Generate README.md for the delivery packages directory (host-side, run on build server).
Reads real sizes from the package dir, versions from bundle meta.json, verification
verdicts from the repo-fetched receipts. Usage: make-packages-readme.py [out_dir]
(out_dir defaults to $FT_PKG_DIR; data paths from env.sh via os.environ set by caller).
"""
import glob
import json
import os
import sys

pkg = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FT_PKG_DIR", ".")
bundle = os.environ.get("FT_BUNDLE")
repo_status = os.path.join(os.environ.get("FT_REPO_ROOT", ""), "portable", "status")

def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024

def version_of(tool_id):
    mp = os.path.join(bundle, "tools", tool_id, "meta.json")
    if os.path.isfile(mp):
        return json.load(open(mp, encoding="utf-8")).get("version") or "?"
    return "?"

# verdicts from the committed receipts (fetched from server evidence)
verdicts = {}
prt = os.path.join(repo_status, "PORTABLE_RUNTIME.json")
if os.path.isfile(prt):
    d = json.load(open(prt, encoding="utf-8"))
    for t in d.get("tools", []):
        verdicts[t["id"]] = t.get("verify_verdict")

import re
NAME_RE = re.compile(r"^(.*)-([^-]+)-linux-x86_64\.tar\.zst$")

def parse_name(base):
    m = NAME_RE.match(base)
    return (m.group(1), m.group(2)) if m else (None, None)

tool_files = sorted(glob.glob(os.path.join(pkg, "tools", "*.tar.zst")))
rt_files = sorted(glob.glob(os.path.join(pkg, "runtimes", "*.tar.zst")))
core = os.path.join(pkg, "formal-tools-portable-core-linux-x86_64.tar.zst")

names = {"python313": "CPython 3.13.5", "node22": "Node.js 22.16.0", "py-cache": "tree-sitter 语法缓存",
         "java21": "Temurin JRE 21.0.13+9", "dotnet8": ".NET 8 runtime",
         "py-cache": "tree-sitter grammar cache"}

L = []
L.append("# formal-tools-portable — Debian 13 (trixie) x86_64 交付包")
L.append("")
L.append("36 类形式化/逻辑/优化/仿真工具的离线可移植 bundle，按“一个工具一个压缩包”分发")
L.append("(zstd -22 最大压缩，全部通过压缩后完整性自检：`zstd -t` + tar 条目数与源目录比对)。")
L.append("")
L.append("- 目标环境: Debian 13 x86_64, glibc ≤ 2.41, 无网络、任意路径解压即用")
L.append("- 运行时: CPython 3.13.5 / Node.js 22.16.0 / Temurin JRE 21.0.13+9 (随包)")
L.append("- 验证: 每工具在全新 `debian:13` 容器、`--network none`、只读挂载下执行")
L.append("  正例/反例/无效输入三用例, 按类型化语义判定 (SAT/UNSAT、PROVED、")
L.append("  PROPERTY_HOLDS、OPTIMAL、VERIFIED…), 退出码 0 不单独作为通过依据")
L.append("")
L.append("## 快速开始")
L.append("")
L.append("```sh")
L.append("apt install zstd            # 解压依赖")
L.append("sha256sum -c SHA256SUMS     # 完整性校验")
L.append("sh unpack.sh --dest /opt    # 解出完整 bundle 树")
L.append("/opt/formal-tools-portable-debian13-x86_64/bin/tool-runner list")
L.append("/opt/formal-tools-portable-debian13-x86_64/bin/tool-runner doctor all")
L.append("/opt/formal-tools-portable-debian13-x86_64/bin/tool-runner run z3 model.smt2")
L.append("```")
L.append("")
L.append("## 文件说明")
L.append("")
L.append("| 文件 | 大小 | 说明 |")
L.append("|---|---|---|")
c = os.path.basename(core); s = os.path.getsize(core)
L.append(f"| `{c}` | {human(s)} | **骨架包**: bin/tool-runner + tests/ 全部用例 + registry/ + manifest.json + evidence/ 收据 + licenses/ docs/ |")
for f in rt_files:
    base = os.path.basename(f)
    rt, _ = parse_name(base)
    L.append(f"| `{base}` | {human(os.path.getsize(f))} | 共享运行时: {names.get(rt, rt)} |")
for f in tool_files:
    base = os.path.basename(f)
    tid, fname_ver = parse_name(base)
    ver = version_of(tid) or fname_ver
    v = verdicts.get(tid, "?")
    mark = "✅" if v == "PASS" else ("⚠️" if v in ("SKIP", "UNAVAILABLE") else v)
    note = ""
    pi = os.path.join(bundle, "tools", tid, "PACKAGE-INFO.txt")
    if os.path.isfile(pi):
        note = " — 仅含启动 shim；本体在 python313 运行时包内（包内有 PACKAGE-INFO.txt 说明）"
    L.append(f"| `{base}` | {human(os.path.getsize(f))} | {tid} {ver} [{mark} {v}]{note} |")
L.append("")
npass = sum(1 for v in verdicts.values() if v == "PASS")
L.append("## 验证状态")
L.append("")
L.append(f"- **{npass}/{len(verdicts)} PASS**（离线三用例真实执行；逐工具收据见仓库")
L.append("  `portable/status/receipts/`，标注 ⚠️ 的工具见其包内 PACKAGE-INFO/收据说明）")
L.append("")
L.append("## 完整性")
L.append("")
L.append("`SHA256SUMS` 覆盖本目录全部 .tar.zst; `unpack.sh` 校验后按 core → runtimes → tools")
L.append("顺序解压成完整 bundle 树 (工具与运行时也可单独解压替换, 版本化文件名互不覆盖)。")
L.append("")
out = os.path.join(pkg, "README.md")
open(out, "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
print("README written:", out, len(L), "lines")
