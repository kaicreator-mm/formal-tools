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

# per-tool dependency group + invocation example (consumed by humans and agents alike)
TOOLS_META = {
    "lean4": ("自包含", "tool-runner run lean4 proof.lean"),
    "z3": ("自包含", "tool-runner run z3 model.smt2"),
    "cvc5": ("自包含", "tool-runner run cvc5 model.smt2"),
    "vampire": ("自包含", "tool-runner run vampire conjecture.p --time_limit 10"),
    "tla-tlc": ("java21", "tool-runner run tla-tlc spec.tla -cfg spec.cfg"),
    "apalache": ("java21", "tool-runner run apalache check --inv=Inv spec.tla"),
    "alloy": ("java21", "tool-runner run alloy model.als"),
    "elk": ("java21", "tool-runner run elk -c -i ontology.ofn -o tax.ttl"),
    "robot": ("java21", "tool-runner run robot reason --reasoner ELK --input o.ttl"),
    "apache-jena": ("java21", "tool-runner run apache-jena --validate data.ttl"),
    "prism": ("java21", "tool-runner run prism model.pm -pf \"P>=0.1 [F s=7]\""),
    "prob": ("java21", "tool-runner run prob -mc 100 model.mch"),
    "dafny": ("自包含（内置 z3）", "tool-runner run dafny verify prog.dfy"),
    "cbmc": ("自包含（内置 gcc 前端）", "tool-runner run cbmc prog.c"),
    "souffle": ("自包含（内置 mcpp 预处理器）", "tool-runner run souffle prog.dl"),
    "clingo": ("自包含（内置私有库）", "tool-runner run clingo prog.lp"),
    "minizinc": ("自包含（建议 --solver Chuffed）", "tool-runner run minizinc model.mzn --solver Chuffed"),
    "nuxmv": ("自包含（内置私有库）", "tool-runner run nuxmv model.smv"),
    "storm": ("自包含（内置求解器库）", "tool-runner run storm --prism model.pm --prop \"P>=0.1 [F s=7]\""),
    "kani": ("自包含（内置 rust 工具链 + gcc 前端）", "tool-runner run kani <crate_dir>"),
    "aflpp": ("自包含（内置 libpython）", "tool-runner run aflpp --fuzz-smoke"),
    "why3": ("需 z3（证明后端）", "tool-runner run why3 prove -P z3 theory.mlw"),
    "fast-downward": ("python313", "tool-runner run fast-downward domain.pddl problem.pddl --search \"astar(lmcut())\""),
    "fast-check": ("node22", "tool-runner node tests/fast-check/pos.mjs"),
    "tree-sitter": ("自包含 CLI；python 绑定需 python313", "tool-runner py parse.py / tool-runner run tree-sitter parse file.c"),
    "rdf-shacl": ("python313", "tool-runner py validate.py"),
    "ortools": ("python313", "tool-runner py solve.py"),
    "sympy": ("python313", "tool-runner py solve.py"),
    "networkx": ("python313", "tool-runner py graph.py"),
    "hypothesis": ("python313", "tool-runner py test_props.py"),
    "highs": ("python313", "tool-runner py lp.py"),
    "dowhy": ("python313", "tool-runner py causal.py"),
    "pymc": ("python313", "tool-runner py bayes.py"),
    "causal-learn": ("python313", "tool-runner py discover.py"),
    "simpy": ("python313", "tool-runner py sim.py"),
    "mesa": ("python313", "tool-runner py abm.py"),
}

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
L.append("| 文件 | 大小 | 依赖 | 说明 |")
L.append("|---|---|---|---|")
c = os.path.basename(core); s = os.path.getsize(core)
L.append(f"| `{c}` | {human(s)} | **必解** | **骨架包**: bin/tool-runner + tests/ 全部用例 + registry/ + manifest.json + evidence/ 收据 + licenses/ docs/ |")
rt_need = {"java21": [], "python313": [], "node22": []}
for f in rt_files:
    base = os.path.basename(f)
    rt, _ = parse_name(base)
    L.append(f"| `{base}` | {human(os.path.getsize(f))} | 见下方依赖矩阵 | 共享运行时: {names.get(rt, rt)} |")
for f in tool_files:
    base = os.path.basename(f)
    tid, fname_ver = parse_name(base)
    ver = version_of(tid) or fname_ver
    v = verdicts.get(tid, "?")
    mark = "✅" if v == "PASS" else ("⚠️" if v in ("SKIP", "UNAVAILABLE") else v)
    deps, usage = TOOLS_META.get(tid, ("自包含", f"tool-runner run {tid} --help"))
    if deps.startswith("python313"):
        rt_need["python313"].append(tid)
    elif deps == "java21":
        rt_need["java21"].append(tid)
    elif deps == "node22":
        rt_need["node22"].append(tid)
    note = ""
    pl = os.path.join(bundle, "tools", tid, "pylib")
    pi = os.path.join(bundle, "tools", tid, "PACKAGE-INFO.txt")
    if os.path.isdir(pl):
        note = "；包内含 site-packages 子集 (pylib/)"
    elif os.path.isfile(pi):
        note = "；包内有 PACKAGE-INFO.txt"
    L.append(f"| `{base}` | {human(os.path.getsize(f))} | {deps} | {tid} {ver} [{mark} {v}] — `{usage}`{note} |")
L.append("")
L.append("## 依赖矩阵（最小安装：core + 用到的运行时 + 目标工具包）")
L.append("")
L.append("| 依赖组合 | 工具 |")
L.append("|---|---|")
self_c = sorted(tid for tid in verdicts if TOOLS_META.get(tid, ("自包含",))[0].startswith("自包含"))
L.append(f"| 仅 core | {', '.join(sorted(self_c)) or '-'} |")
L.append(f"| core + java21 | {', '.join(sorted(rt_need['java21'])) or '-'} |")
L.append(f"| core + python313 | {', '.join(sorted(rt_need['python313'])) or '-'} |")
L.append(f"| core + node22 | {', '.join(sorted(rt_need['node22'])) or '-'} |")
L.append("| why3 另需 z3 包（prove 后端）; dafny/cbmc/kani 已内置所需组件 | |")
L.append("")
L.append("所有调用统一走 `bin/tool-runner`（自动设置 PYTHONHOME/LD_LIBRARY_PATH/PYTHONPATH、")
L.append("JAVA_HOME 等）；Python 库工具也可用 `tool-runner py <script>` 在脚本里直接 import。")
L.append("")
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
