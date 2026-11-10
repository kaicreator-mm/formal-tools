# Portable Runtime (Debian 13 x86_64) — build system

36 类形式化/逻辑/优化/仿真工具的**可移植构建与验证**基础设施。构建在远程 Docker 主机
(Ubuntu, 仅作 host) 上的 `ft-builder:deb13`(debian:13 + 工具链) 容器内进行,产物汇编为
**formal-tools-portable-debian13-x86_64** bundle,并在**全新、无网络**的 `debian:13` 容器中
做真实执行验证(正例/反例/无效输入三用例)。

## 目录

```
portable/
├── env.sh               # 服务器端共享配置(路径/镜像/并发)
├── orchestrate.sh       # 服务器端驱动: init|runtimes|build|pack|verify|receipts|status
├── deploy.sh            # 本机(Windows Git Bash): sync|run|fetch
├── builders/
│   ├── base.Dockerfile  # ft-builder:deb13 镜像
│   ├── lib.sh           # fetch(供应链哈希)/extract/deb/patchelf/shim/meta 助手
│   ├── build-runtimes.sh# python313(源码编译)/node22/java21 + py 依赖单次解析
│   ├── build-tool.sh    # 通用工具构建驱动(版本探测/ELF 审计/meta)
│   ├── host/storm-prepare.sh  # storm 官方镜像提取(宿主侧,不让 builder 摸 docker socket)
│   ├── java-src/AlloyRunner.java  # Alloy 无头 runner
│   ├── py-requirements.txt / py-constraints.txt
│   └── tools/<id>.sh    # 36 个工具 spec
├── verification/
│   ├── cases/<id>/      # 正例/反例/无效输入 + expect.sh(判定契约)
│   └── build-receipts.py# TSV 证据 -> JSON 收据 + PORTABLE_RUNTIME.json + SUMMARY.md
├── packaging/
│   ├── pack.sh          # 组装 bundle + 分包(<=190MiB) + SHA256SUMS + unpack.sh
│   ├── make-manifest.py # manifest.json
│   ├── bundle-template/bin/tool-runner  # 统一运行入口(随包分发)
│   └── unpack-template/unpack.sh
└── status/              # 构建服务器回传的收据(已提交,见 SUMMARY.md)
```

## 执行

```sh
# 本机(工作区任意位置):
portable/deploy.sh sync
portable/deploy.sh run init
portable/deploy.sh run runtimes
portable/deploy.sh run build all      # 36 工具(python 类自动串行,其余 3 并发)
portable/deploy.sh run pack
portable/deploy.sh run verify all     # 全新 debian:13, --network none
portable/deploy.sh run receipts
portable/deploy.sh fetch
```

## 设计要点

- **按工具隔离构建**:每个 spec 一个容器,互不共享可变状态;python-lib 类共享一个
  python313 runtime,由 build-runtimes.sh 一次性解析全部依赖(依赖收据 `py-deps.events`)。
- **供应链**:所有下载记 URL+SHA256;有上游哈希(pinned / sibling .sha256/.sha512 /
  maven .sha1 / npm shasum / Temurin API)则强校验,否则如实记 `computed-only`。
- **ELF 审计**:构建期 readelf 记录架构、NEEDED 库、最高 GLIBC 符号版本,写入 meta;
  验证期 doctor 用 ldd 复核缺库。
- **验证语义**:expect.sh 声明 via(run|py|node|java)/args/exit/regex/label;
  SMT 判 SAT/UNSAT,定理证明判 PROVED/REJECTED,模型检查判 HOLDS/COUNTEREXAMPLE,
  优化判 OPTIMAL/INFEASIBLE;`err` 用例要求无效输入产生非零退出或类型化错误。
  退出码 0 从不单独作为通过依据。
- **不入包**:任何形式的构建缓存/凭据;大文件只进分包产物,仓库只收收据与清单。
