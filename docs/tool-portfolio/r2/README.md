# Tool Portfolio R2 — 36 工具资产路径与真实可调用性（2026-11-13）

> 产品事实源：[#11](https://github.com/kaicreator-mm/formal-tools/issues/11)。工具生命周期：[#24](https://github.com/kaicreator-mm/formal-tools/issues/24)。R1 静态 DAG 不重写；此 R2 是**新增证据快照**，不是对旧归档或 PR #22 的强制升级。#7 不参与。

## 目录职责与实际组织

| 目录 | 内容 | 验收资格 |
|---|---|---|
| [App/packages](https://drive.google.com/drive/folders/1DsQtN4Ei3F8YGyDxUGiXCWNuIU8mS2wp) | 原始 36 工具 tar.zst、5 个 shared runtime、core 和 `SHA256SUMS` | Immutable producer evidence; some unavailable/blocked |
| [App/whl](https://drive.google.com/drive/folders/1jT9rgermFAlgvXRpuUqRaQH0zesc0Lku) | 原始 11 wheelhouse ZIP、`SHA256SUMS-ZIPS`、`INSTALL.md` | 原封保存，原 ZIP 名与原始 SHA 可以重算；**不是经过重命名后的权威目录** |
| [verified/tools](https://drive.google.com/drive/folders/1Ruw61tyRGHwVSK6jsz41XYCXlFzECJqb) | 19 个原始 archive SHA + `tool-runner verify` 限定原生 PASS 的包 | original tar runner, 16 R3 + Storm/Apalache/Kani R4 |
| [verified/whl-scoped-cp313](https://drive.google.com/drive/folders/1PaOrmxwWPaQ067Cg-36aF8rJAMaULrEA) | 11 个隔离 pip `--no-index --target` 测试成功的 Python wheelhouse | `<distribution>-wheelhouse-<actual-version>-py313-debian13-x86_64.zip`；外层 ZIP **不是 wheel**，不宣称 manylinux_2_39 ABI |
| [verified/host-python313-scoped](https://drive.google.com/drive/folders/1gVs3oRAf_YQjcruEdo4D-7zEO07tI4cO) | Fast Downward 24.06 原始 tar | 运行时需绑定宿主 CPython 3.13，**非自包含**；有界 `tool-runner verify` 正/负通过 |
| `docs/tool-portfolio/r2/ASSET_LANES.json` | 每个工具稳定 issue、封包名、原版本、实际新版本、SHA、受限验证出口与明确阻塞 | 本次机器可读索引；不能替代原始 stdout/stderr 和独立技术审核 |

**HiGHS 处理**：原始 ZIP 名 `highspy-whl-1.15.1-cp313-cp313-manylinux_2_39_x86_64.zip` 内唯一 highspy wheel 是 `1.16.0`，外层哈希为 `a67913c95322957bfcaf6c0e9ff9f1dba8f99a2bd0be27d0ce80119feb45f620`；旧名字只存在于保留的原始来源，实际可用副本正确命名为 `highspy-wheelhouse-1.16.0-py313-debian13-x86_64.zip`，**字节、SHA 均未改动**。旧 HiGHS tar target 1.15.1 和 Registry 原锁定版本**不被静默覆盖**。正式主版本升级需 PR #22 源码与实际 1.16.0 ABI/契约审核；此次仅认可 alternate wheelhouse 1.16.0 的有界功能测试。原始 `SHA256SUMS-ZIPS` 仍以来源旧文件名索引，正确别名关系详见本 R2 JSON。

## 36 工具可调用性矩阵：分层而非单一 PASS

| 实际执行类别 | 数量 | 说明 |
|---|---:|---|
| R3 原 tar + original runner 限定 PASS | 16 | 旧 exact SHA 收据复用，未伪造新执行 |
| R4 原 tar + original runner 限定 PASS | 3 | Storm exit 0/0；Apalache 0/12/255；Kani 0/1，独立重新下载来源 SHA 校验、隔离执行 |
| R4 原 tar + **宿主 Python** adapter 限定 PASS | 1 | Fast Downward 24.06 plan 0/unsolvable 11；原 runtime python313 294MB **未验证** |
| R4 原 tar + **临时修复 fixture** 限定 PASS | 2 | nuXmv 补原 core 缺少的 expect、正反错三例；ProB 用可写输入、无死锁正例、`-strict` exit 0/1/1；原 core **未修复** |
| R4 替代 CLI 有界 PASS | 1 | Tree-sitter 0.27.2 原始 CLI 生成简易 grammar、解析合法 0/无效 1；原 `tree_sitter` Python binding fixture 仍 BLOCK |
| R4 系统 Python3.13 `wheelhouse` 隔离调用 PASS | 11 | 10 个原锁定版本 + HiGHS 高版本 1.16.0，均 SHA/CRC、无联网 pip、正反/错误 smoke；原 portable runner 待适配 |
| **R4 BLOCKED** | **2** | **Lean4** 下载 567MB 返回 HTTP 413；**Why3** 27 个包外绝对符号链接 + 编译期 OCaml `/usr/lib/.../why3/commands` 硬编码，安全剔除后 native setup 退出 1 |
| **合计** | **36** | **34/36** 有不同级别的限定调用证据，**并非 34/36 自包含正式合格**；T4/T5/G3/G4/REUSABLE 均不得因此晋级 |

## 本轮新增真实证据与修复边界

- SHA 严格对照 `App/packages/SHA256SUMS`；所有本轮解包 tar 都进行了 member type、非法路径、逃逸 symlink 和合计解包大小预检。原 Why3 归档 **27 个不安全外部 symlink**，未被原样解压。
- 新原生 R4 [Storm #54](https://github.com/kaicreator-mm/formal-tools/issues/54), [Apalache #28](https://github.com/kaicreator-mm/formal-tools/issues/28), [Kani #40](https://github.com/kaicreator-mm/formal-tools/issues/40) 真正 `tool-runner verify` PASS；各 TSV/log 的源字节与 SHA 在 R2 JSON/Issue 收据中记录。
- [Fast Downward #37](https://github.com/kaicreator-mm/formal-tools/issues/37) 通过绑定 `/opt/pyvenv/bin/python3` 作为 `runtimes/python313/bin/python3.13`，**仅此宿主** 3.13.5 环境；后续应正式适配系统 Python，不宣称原 Python313 bundle transport 成功。
- [nuXmv #45](https://github.com/kaicreator-mm/formal-tools/issues/45) 原 core 缺 `tests/nuxmv/expect.sh`；实际 binary 模型 true/false/语法错三例运行后，**本地新增 fixture** 的 runner 退出0。doctor 的原 `ldd` 因忽略 wrapper `LD_LIBRARY_PATH` 仍假 FAIL。
- [ProB #48](https://github.com/kaicreator-mm/formal-tools/issues/48) 原正例只有 INITIALISATION 无 OPERATIONS ⇒ 在 -mc 下会**死锁并产生真实 counterexample**；初次测试源目录只读导致 `.inprogress.prob` I/O 错；原默认模式出现 counterexample 仍退出0。**本地替换**有自环 operation 的正例，setup 复制 fixture 至可写临时目录，运行 `-strict` 后 pos 0、invariant violation neg 1、parse error 1；原源码与 core 未改，需 PR #22 原单 Writer 正式修复。
- [Tree-sitter #57](https://github.com/kaicreator-mm/formal-tools/issues/57) 纯 CLI 可以生成和解析，但原 `tree_sitter`、`tree_sitter_c` Python绑定没 wheel，不能称原 fixture PASS。
- [Why3 #59](https://github.com/kaicreator-mm/formal-tools/issues/59) 试验**只在隔离目录删除 27 个危险符号链接后**解包；未经改造的 upstream CLI 依赖编译期绝对路径 `/usr/lib/x86_64-linux-gnu/ocaml/5.3.0/why3/commands`，非 root setup exit1；没有对宿主 `/usr` 进行修改，**不晋级**。
- [Lean4 #41](https://github.com/kaicreator-mm/formal-tools/issues/41) Drive 413 再现，无文件 hash/native result，不晋级。

## 更新规则

源资产永远不因修改 Drive display-name而“变成不同二进制”，镜像/别名必须保留 `source_file_id`、原始文件名、完整 `sha256` 与 actual wheel distribution version；更换真实 wheel 版本需新包、新 hash、新 R4 native 输出并更新 Registry。

本 PR 只包含文档、快照和 Node 不变量测试，**不修改 PR #22 的 tool-runner 源码，也不触碰 #7**；Issue 是管理索引，Git R2 snapshot 是复现辅助事实。只有具备真实独立语义 Oracle 的 T5/产品 G3 才能消费适用的 Qualified Solution。

运行静态验证：
```sh
node --test tests/tool-asset-lanes.test.mjs
npm run formal:test
```
