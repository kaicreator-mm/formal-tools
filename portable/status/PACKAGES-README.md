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

| 文件 | 大小 | 说明 |
|---|---|---|
| `formal-tools-portable-core-linux-x86_64.tar.zst` | 27.3 KB | **骨架包**: bin/tool-runner + tests/ 全部用例 + registry/ + manifest.json + evidence/ 收据 + licenses/ docs/ |
| `dotnet8-8.0-linux-x86_64.tar.zst` | 23.7 MB | 共享运行时: .NET 8 runtime |
| `java21-21.0.13.9-linux-x86_64.tar.zst` | 30.8 MB | 共享运行时: Temurin JRE 21.0.13+9 |
| `node22-22.16.0-linux-x86_64.tar.zst` | 31.1 MB | 共享运行时: Node.js 22.16.0 |
| `py-cache-1.25.0-linux-x86_64.tar.zst` | 21.7 MB | 共享运行时: tree-sitter grammar cache |
| `python313-3.13.5-linux-x86_64.tar.zst` | 280.7 MB | 共享运行时: CPython 3.13.5 |
| `aflpp-5.03c-linux-x86_64.tar.zst` | 3.1 MB | aflpp 5.03c [✅ PASS] |
| `alloy-6.2.0-linux-x86_64.tar.zst` | 19.4 MB | alloy 6.2.0 [✅ PASS] |
| `apache-jena-5.5.0-linux-x86_64.tar.zst` | 21.7 MB | apache-jena 5.5.0 [✅ PASS] |
| `apalache-0.63.0-linux-x86_64.tar.zst` | 182.5 MB | apalache 0.63.0 [✅ PASS] |
| `causal-learn-0.1.4.8-linux-x86_64.tar.zst` | 704 B | causal-learn 0.1.4.8 [✅ PASS] |
| `cbmc-6.11.0-linux-x86_64.tar.zst` | 19.6 MB | cbmc 6.11.0 [✅ PASS] |
| `clingo-5.8.3-linux-x86_64.tar.zst` | 4.7 MB | clingo 5.8.3 [✅ PASS] |
| `cvc5-1.4.2-linux-x86_64.tar.zst` | 8.4 MB | cvc5 1.4.2 [✅ PASS] |
| `dafny-4.11.0-linux-x86_64.tar.zst` | 44.3 MB | dafny 4.11.0 [✅ PASS] |
| `dowhy-0.14-linux-x86_64.tar.zst` | 699 B | dowhy 0.14 [✅ PASS] |
| `elk-0.6.0-linux-x86_64.tar.zst` | 5.1 MB | elk 0.6.0 [✅ PASS] |
| `fast-check-4.10.2-linux-x86_64.tar.zst` | 121.5 KB | fast-check 4.10.2 [✅ PASS] |
| `fast-downward-24.06-linux-x86_64.tar.zst` | 93.6 MB | fast-downward 24.06 [✅ PASS] |
| `highs-1.15.1-linux-x86_64.tar.zst` | 702 B | highs 1.15.1 [✅ PASS] |
| `hypothesis-6.170.15-linux-x86_64.tar.zst` | 705 B | hypothesis 6.170.15 [✅ PASS] |
| `kani-0.68.0-linux-x86_64.tar.zst` | 233.7 MB | kani 0.68.0 [✅ PASS] |
| `lean4-4.35.0-linux-x86_64.tar.zst` | 540.9 MB | lean4 4.35.0 [✅ PASS] |
| `mesa-3.5.2-linux-x86_64.tar.zst` | 717 B | mesa 3.5.2 [✅ PASS] |
| `minizinc-2.10.1-linux-x86_64.tar.zst` | 75.7 MB | minizinc 2.10.1 [✅ PASS] |
| `networkx-3.7-linux-x86_64.tar.zst` | 700 B | networkx 3.7 [✅ PASS] |
| `nuxmv-2.2.0-linux-x86_64.tar.zst` | 18.8 MB | nuxmv 2.2.0 [✅ PASS] |
| `ortools-9.15.6755-linux-x86_64.tar.zst` | 700 B | ortools 9.15.6755 [✅ PASS] |
| `prism-4.11-linux-x86_64.tar.zst` | 36.6 MB | prism 4.11 [✅ PASS] |
| `prob-1.16.1-linux-x86_64.tar.zst` | 32.7 MB | prob 1.16.1 [✅ PASS] |
| `pymc-6.4.0-linux-x86_64.tar.zst` | 771 B | pymc 6.4.0 [✅ PASS] |
| `rdf-shacl-0.40.2-linux-x86_64.tar.zst` | 710 B | rdf-shacl 0.40.2 [✅ PASS] |
| `robot-1.9.11-linux-x86_64.tar.zst` | 69.4 MB | robot 1.9.11 [✅ PASS] |
| `simpy-4.1.2-linux-x86_64.tar.zst` | 694 B | simpy 4.1.2 [✅ PASS] |
| `souffle-2.5-linux-x86_64.tar.zst` | 4.5 MB | souffle 2.5 [✅ PASS] |
| `storm-1.8.0-linux-x86_64.tar.zst` | 129.2 MB | storm 1.8.0 [✅ PASS] |
| `sympy-1.14.0-linux-x86_64.tar.zst` | 699 B | sympy 1.14.0 [✅ PASS] |
| `tla-tlc-1.8.0-linux-x86_64.tar.zst` | 4.0 MB | tla-tlc 1.8.0 [✅ PASS] |
| `tree-sitter-0.27.2-linux-x86_64.tar.zst` | 6.2 MB | tree-sitter 0.27.2 [✅ PASS] |
| `vampire-5.1.0-linux-x86_64.tar.zst` | 15.5 MB | vampire 5.1.0 [✅ PASS] |
| `why3-1.8.0-linux-x86_64.tar.zst` | 39.6 MB | why3 1.8.0 [✅ PASS] |
| `z3-5.4.0-linux-x86_64.tar.zst` | 12.3 MB | z3 5.4.0 [✅ PASS] |

## 验证状态

- **36/36 PASS** — 每工具的 pos/neg(/err) 三用例真实执行,
  收据含 runner_schema 0.2 认证与真实退出码 (`portable/status/receipts/`)

## 完整性

`SHA256SUMS` 覆盖本目录全部 .tar.zst; `unpack.sh` 校验后按 core → runtimes → tools
顺序解压成完整 bundle 树 (工具与运行时也可单独解压替换, 版本化文件名互不覆盖)。

## 溯源

- 源码: kaicreator-mm/formal-tools, 分支 `build/portable-runtime-debian13-r0`, PR #22
- 构建: Docker 隔离 (ft-builder:deb13 容器内), 构建服务器仅作 Docker Host
- 收据: 每工具 build/verify JSON (版本、ELF/glibc 审计、下载 URL+SHA-256、
  用例判定), 同步提交于仓库 `portable/status/`

