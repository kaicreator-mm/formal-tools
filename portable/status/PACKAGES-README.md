# formal-tools-portable — Debian 13 (trixie) x86_64 交付包

36 类形式化/逻辑/优化/仿真工具的离线可移植 bundle，按“一个工具一个压缩包”分发
(zstd -22 最大压缩，全部通过压缩后完整性自检：`zstd -t` + tar 条目数与源目录比对)。

- 目标环境: Debian 13 x86_64, glibc ≤ 2.41, 无网络、任意路径解压即用
- 运行时: CPython 3.13.5 / Node.js 22.16.0 / Temurin JRE 21.0.13+9 (随包)
- 验证: 每工具在全新 `debian:13` 容器、`--network none`、只读挂载下执行
  正例/反例/无效输入三用例, 按类型化语义判定 (SAT/UNSAT、PROVED、
  PROPERTY_HOLDS、OPTIMAL、VERIFIED…), 退出码 0 不单独作为通过依据

## 快速开始

```sh
apt install zstd            # 解压依赖
sha256sum -c SHA256SUMS     # 完整性校验
sh unpack.sh --dest /opt    # 解出完整 bundle 树
/opt/formal-tools-portable-debian13-x86_64/bin/tool-runner list
/opt/formal-tools-portable-debian13-x86_64/bin/tool-runner doctor all
/opt/formal-tools-portable-debian13-x86_64/bin/tool-runner run z3 model.smt2
```

## 文件说明

| 文件 | 大小 | 依赖 | 说明 |
|---|---|---|---|
| `formal-tools-portable-core-linux-x86_64.tar.zst` | 27.3 KB | **必解** | **骨架包**: bin/tool-runner + tests/ 全部用例 + registry/ + manifest.json + evidence/ 收据 + licenses/ docs/ |
| `dotnet8-8.0-linux-x86_64.tar.zst` | 23.7 MB | 见下方依赖矩阵 | 共享运行时: .NET 8 runtime |
| `java21-21.0.13.9-linux-x86_64.tar.zst` | 30.8 MB | 见下方依赖矩阵 | 共享运行时: Temurin JRE 21.0.13+9 |
| `node22-22.16.0-linux-x86_64.tar.zst` | 31.1 MB | 见下方依赖矩阵 | 共享运行时: Node.js 22.16.0 |
| `py-cache-1.25.0-linux-x86_64.tar.zst` | 21.7 MB | 见下方依赖矩阵 | 共享运行时: tree-sitter grammar cache |
| `python313-3.13.5-linux-x86_64.tar.zst` | 280.7 MB | 见下方依赖矩阵 | 共享运行时: CPython 3.13.5 |
| `aflpp-5.03c-linux-x86_64.tar.zst` | 3.1 MB | 自包含（内置 libpython） | aflpp 5.03c [✅ PASS] — `tool-runner run aflpp --fuzz-smoke` |
| `alloy-6.2.0-linux-x86_64.tar.zst` | 19.4 MB | java21 | alloy 6.2.0 [✅ PASS] — `tool-runner run alloy model.als` |
| `apache-jena-5.5.0-linux-x86_64.tar.zst` | 21.7 MB | java21 | apache-jena 5.5.0 [✅ PASS] — `tool-runner run apache-jena --validate data.ttl` |
| `apalache-0.63.0-linux-x86_64.tar.zst` | 182.5 MB | java21 | apalache 0.63.0 [✅ PASS] — `tool-runner run apalache check --inv=Inv spec.tla` |
| `causal-learn-0.1.4.8-linux-x86_64.tar.zst` | 444.3 KB | python313 | causal-learn 0.1.4.8 [✅ PASS] — `tool-runner py discover.py`；包内含 site-packages 子集 (pylib/) |
| `cbmc-6.11.0-linux-x86_64.tar.zst` | 19.6 MB | 自包含（内置 gcc 前端） | cbmc 6.11.0 [✅ PASS] — `tool-runner run cbmc prog.c` |
| `clingo-5.8.3-linux-x86_64.tar.zst` | 4.7 MB | 自包含（内置私有库） | clingo 5.8.3 [✅ PASS] — `tool-runner run clingo prog.lp` |
| `cvc5-1.4.2-linux-x86_64.tar.zst` | 8.4 MB | 自包含 | cvc5 1.4.2 [✅ PASS] — `tool-runner run cvc5 model.smt2` |
| `dafny-4.11.0-linux-x86_64.tar.zst` | 44.3 MB | 自包含（内置 z3） | dafny 4.11.0 [✅ PASS] — `tool-runner run dafny verify prog.dfy` |
| `dowhy-0.14-linux-x86_64.tar.zst` | 643.7 KB | python313 | dowhy 0.14 [✅ PASS] — `tool-runner py causal.py`；包内含 site-packages 子集 (pylib/) |
| `elk-0.6.0-linux-x86_64.tar.zst` | 5.1 MB | java21 | elk 0.6.0 [✅ PASS] — `tool-runner run elk -c -i ontology.ofn -o tax.ttl` |
| `fast-check-4.10.2-linux-x86_64.tar.zst` | 121.5 KB | node22 | fast-check 4.10.2 [✅ PASS] — `tool-runner node tests/fast-check/pos.mjs` |
| `fast-downward-24.06-linux-x86_64.tar.zst` | 93.6 MB | python313 | fast-downward 24.06 [✅ PASS] — `tool-runner run fast-downward domain.pddl problem.pddl --search "astar(lmcut())"` |
| `highs-1.15.1-linux-x86_64.tar.zst` | 2.2 MB | python313 | highs 1.15.1 [✅ PASS] — `tool-runner py lp.py`；包内含 site-packages 子集 (pylib/) |
| `hypothesis-6.170.15-linux-x86_64.tar.zst` | 1.4 MB | python313 | hypothesis 6.170.15 [✅ PASS] — `tool-runner py test_props.py`；包内含 site-packages 子集 (pylib/) |
| `kani-0.68.0-linux-x86_64.tar.zst` | 233.7 MB | 自包含（内置 rust 工具链 + gcc 前端） | kani 0.68.0 [✅ PASS] — `tool-runner run kani <crate_dir>` |
| `lean4-4.35.0-linux-x86_64.tar.zst` | 540.9 MB | 自包含 | lean4 4.35.0 [✅ PASS] — `tool-runner run lean4 proof.lean` |
| `mesa-3.5.2-linux-x86_64.tar.zst` | 431.1 KB | python313 | mesa 3.5.2 [✅ PASS] — `tool-runner py abm.py`；包内含 site-packages 子集 (pylib/) |
| `minizinc-2.10.1-linux-x86_64.tar.zst` | 75.7 MB | 自包含（建议 --solver Chuffed） | minizinc 2.10.1 [✅ PASS] — `tool-runner run minizinc model.mzn --solver Chuffed` |
| `networkx-3.7-linux-x86_64.tar.zst` | 3.1 MB | python313 | networkx 3.7 [✅ PASS] — `tool-runner py graph.py`；包内含 site-packages 子集 (pylib/) |
| `nuxmv-2.2.0-linux-x86_64.tar.zst` | 18.8 MB | 自包含（内置私有库） | nuxmv 2.2.0 [✅ PASS] — `tool-runner run nuxmv model.smv` |
| `ortools-9.15.6755-linux-x86_64.tar.zst` | 20.8 MB | python313 | ortools 9.15.6755 [✅ PASS] — `tool-runner py solve.py`；包内含 site-packages 子集 (pylib/) |
| `prism-4.11-linux-x86_64.tar.zst` | 36.6 MB | java21 | prism 4.11 [✅ PASS] — `tool-runner run prism model.pm -pf "P>=0.1 [F s=7]"` |
| `prob-1.16.1-linux-x86_64.tar.zst` | 32.7 MB | java21 | prob 1.16.1 [✅ PASS] — `tool-runner run prob -mc 100 model.mch` |
| `pymc-6.4.0-linux-x86_64.tar.zst` | 1.0 MB | python313 | pymc 6.4.0 [✅ PASS] — `tool-runner py bayes.py`；包内含 site-packages 子集 (pylib/) |
| `rdf-shacl-0.40.2-linux-x86_64.tar.zst` | 981.0 KB | python313 | rdf-shacl 0.40.2 [✅ PASS] — `tool-runner py validate.py`；包内含 site-packages 子集 (pylib/) |
| `robot-1.9.11-linux-x86_64.tar.zst` | 69.4 MB | java21 | robot 1.9.11 [✅ PASS] — `tool-runner run robot reason --reasoner ELK --input o.ttl` |
| `simpy-4.1.2-linux-x86_64.tar.zst` | 45.8 KB | python313 | simpy 4.1.2 [✅ PASS] — `tool-runner py sim.py`；包内含 site-packages 子集 (pylib/) |
| `souffle-2.5-linux-x86_64.tar.zst` | 4.5 MB | 自包含（内置 mcpp 预处理器） | souffle 2.5 [✅ PASS] — `tool-runner run souffle prog.dl` |
| `storm-1.8.0-linux-x86_64.tar.zst` | 129.2 MB | 自包含（内置求解器库） | storm 1.8.0 [✅ PASS] — `tool-runner run storm --prism model.pm --prop "P>=0.1 [F s=7]"` |
| `sympy-1.14.0-linux-x86_64.tar.zst` | 12.5 MB | python313 | sympy 1.14.0 [✅ PASS] — `tool-runner py solve.py`；包内含 site-packages 子集 (pylib/) |
| `tla-tlc-1.8.0-linux-x86_64.tar.zst` | 4.0 MB | java21 | tla-tlc 1.8.0 [✅ PASS] — `tool-runner run tla-tlc spec.tla -cfg spec.cfg` |
| `tree-sitter-0.27.2-linux-x86_64.tar.zst` | 6.2 MB | 自包含 CLI；python 绑定需 python313 | tree-sitter 0.27.2 [✅ PASS] — `tool-runner py parse.py / tool-runner run tree-sitter parse file.c` |
| `vampire-5.1.0-linux-x86_64.tar.zst` | 15.5 MB | 自包含 | vampire 5.1.0 [✅ PASS] — `tool-runner run vampire conjecture.p --time_limit 10` |
| `why3-1.8.0-linux-x86_64.tar.zst` | 39.6 MB | 需 z3（证明后端） | why3 1.8.0 [✅ PASS] — `tool-runner run why3 prove -P z3 theory.mlw` |
| `z3-5.4.0-linux-x86_64.tar.zst` | 12.3 MB | 自包含 | z3 5.4.0 [✅ PASS] — `tool-runner run z3 model.smt2` |

## 依赖矩阵（最小安装：core + 用到的运行时 + 目标工具包）

| 依赖组合 | 工具 |
|---|---|
| 仅 core | aflpp, cbmc, clingo, cvc5, dafny, kani, lean4, minizinc, nuxmv, souffle, storm, tree-sitter, vampire, z3 |
| core + java21 | alloy, apache-jena, apalache, elk, prism, prob, robot, tla-tlc |
| core + python313 | causal-learn, dowhy, fast-downward, highs, hypothesis, mesa, networkx, ortools, pymc, rdf-shacl, simpy, sympy |
| core + node22 | fast-check |
| why3 另需 z3 包（prove 后端）; dafny/cbmc/kani 已内置所需组件 | |

所有调用统一走 `bin/tool-runner`（自动设置 PYTHONHOME/LD_LIBRARY_PATH/PYTHONPATH、
JAVA_HOME 等）；Python 库工具也可用 `tool-runner py <script>` 在脚本里直接 import。

## 验证状态

- **36/36 PASS**（离线三用例真实执行；逐工具收据见仓库
  `portable/status/receipts/`，标注 ⚠️ 的工具见其包内 PACKAGE-INFO/收据说明）

## 完整性

`SHA256SUMS` 覆盖本目录全部 .tar.zst; `unpack.sh` 校验后按 core → runtimes → tools
顺序解压成完整 bundle 树 (工具与运行时也可单独解压替换, 版本化文件名互不覆盖)。

