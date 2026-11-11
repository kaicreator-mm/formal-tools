# G3_NATIVE_SMOKE — Minimal Native Solver Smoke + Evidence Collection (Issue #11)

- 日期：2026-11-11（收据 `written_at` 2026-11-10T16:55:01.560Z UTC 首采；隐私修复后重采见下）
- 证据分支：`task/ft-i11-g3smoke`
- 基线：任务简报给出 `e1d172ec`；执行时实际 `origin/main` 已前进到 **`ad35fd2`**（PR #13 G2 合并），本工位基于该 HEAD。
- 收据文件：`validation/native-smoke-g3/native-acceptance.json`
- **EVIDENCE_SHA**（收据文件 SHA-256，隐私修复 v1.2 重采后）：`80a4100f85056f5d775947b964bb6eba02e71b5a8d674e7dbff046273b0fc8c9`
- 首采（schema v1.1，含真实主机名/绝对路径，已撤回替换）：`71638dd8ca7adfa499fcdbf12ef1ec7e90e79a6ec1e9d48edd93c5aac102012f`

## G3_NATIVE_SMOKE 范围与边界

- 仅覆盖本地已有工具（z3 / cvc5）；不做 13 工具全量扫描；不下载、不安装任何资产。
- 复用 `packages/runner/js/native.mjs`（doctor / runFixture / executeNativePlan）、
  `native-catalog.mjs`（planNative / planToolProbe）、`tool-manager.mjs`（inspectInstallation），
  未重复实现 Runner；对既有 `scripts/native-acceptance.mjs` 做**纯增量**收据修复（v1→v1.1→v1.2）。
- `CANDIDATE_FOR_REVIEW ≠ NATIVE_VERIFIED ≠ 业务命题已证明`。全部 Claim 级判定保持
  `NOT_EVALUATED`，业务命题未验证。

## 隐私规则（v1.2，收据层强制）

收据发布在公开仓库，v1.2 起收据生成脚本强制：
- `host_identity.hostname` 永不记录真实主机名，写入 `REDACTED`（主机归因依赖 platform/release/arch/node/cpu）。
- 元数据中的本地绝对路径（argv/tool_bin_dir/executable/missing/diagnostics/error 文本）折叠为**末 3 段**（`…\.venv\bin\z3.exe` 形式）；stdout/stderr 保持逐字（哈希锚定证据，不改写）。
- **fail-closed 不变量**：写盘前全量扫描收据 JSON，任何残留盘符绝对路径 → 抛错拒写，宁可失败不发布泄漏收据。
- 首采 v1.1 收据含 22 处主机名/绝对路径字符串（公开仓库隐私暴露，P1），已由 v1.2 重采替换；z3 判定与 stdout SHA-256 与首采逐项一致（同一二进制同输出，证据等价）。
- **独立复核发现的历史风险（Owner 已接受）：** 旧提交 `2effef8775d6946bf1ccd3153291121de4562c62` 仍可能通过 GitHub 完整 SHA 读取早期 v1.1 JSON（真实 hostname + 本地绝对路径）；新的 HEAD **不能** 证明 GitHub 已清除旧对象。Owner 已在 [Issue #11 决议 #6778865075](https://github.com/kaicreator-mm/formal-tools/issues/11#issuecomment-6778865075) 接受仅限任务专用工作机非秘密路径及主机名的历史残留风险，明确不要求历史重写或 GitHub purge；该项不再作为当前 PR 未解决 P1。令牌、密钥和未知敏感信息仍不在接受范围内；本 PR 不触碰 #7 或旧 R1。
- **本次独立修复：** 新生成器还检测 POSIX/Linux/WSL/macOS 绝对路径，同时 Windows 路径识别不会截断 `https://` URL；追加覆盖 `error:C:\\...`、`error:/home/...` 与逗号/方括号前缀的边界校验，拒绝 hash-anchored stdout/stderr 中新发现的此类路径。新增 2 条回归测试，总计 9 条隐私测试；并修复扩大正则范围后误判已脱敏 `…/` 路径导致的回归。**历史 v1.2 原始收据完全不改写**，新增代码仅影响后续收据捕获。
- **输入字节匹配说明：** Windows 本地 `core.autocrlf` 造成 `positive.smt2` 与 `negative.smt2` 工作树内容为 CRLF；分别以 Git blob LF 文本转换 CRLF 后重算 SHA-256，匹配 v1.2 收据中的 `ad656e3f...` 与 `137366ea...`。原始 Git blob LF SHA 不相同；该区分不意味着源模型被独立语义证明。

## HOST_IDENTITY

| 字段 | 值 |
|---|---|
| hostname | `REDACTED`（v1.2 隐私规则；首采记录真实主机名，已撤回） |
| platform / release | win32 / 10.0.26300 |
| arch | x64 |
| node | v26.13.0（v1.2 隐私修复重采；首采 v1.1 为 v24.21.0，与收据 `host_identity.node` 一致） |
| cpu | AMD Ryzen 7 7840HS w/ Radeon 780M Graphics |
| FORMAL_TOOLS_BIN_DIR | `…\dx-service\.venv\bin`（绝对前缀按 v1.2 规则折叠，仅保留末 3 段） |

同机其他相关资产（仅记录，非本次执行对象）：
- WSL 侧 `/home/<user>/z3-exact-upstream/z3/build/z3`（Linux ELF，Z3 4.13.3）——Windows
  runner 以 `shell:false` 直接 spawn，无法无包装地调用 WSL 二进制，不纳入本次收据。
- `ft-i11-portable/portable` 为 Debian-13 可移植构建配方，尚无本地产物。

## TOOL_VERSIONS

| 工具 | 状态 | 版本（二进制自报） | 解析路径 | 二进制 SHA-256 | 字节 |
|---|---|---|---|---|---|
| z3 | EXECUTED（doctor） | `Z3 version 5.1.0 - 64 bit` | `…\.venv\bin\z3.exe`（PE32+ x64，绝对前缀已折叠） | `c638e6b8d066a5ad6ea2712dcd5e2eff5c57eba501b98e7fa8487f7daf0e863d` | 18,842,624 |
| cvc5 | **NOT_RUN** | — | — | — | — |

- z3 来源注意：继承自已废弃 dx-service 的本地 venv，供应链审计**未做**（见 P2）。
- cvc5：`inspectInstallation` 在 `FORMAL_TOOLS_BIN_DIR`（5 个候选含 PATH）均未命中 →
  `MISSING_EXECUTABLE`，doctor ENOENT → 收据如实记 NOT_RUN，不虚构结果。

## 用例矩阵（z3）

| 用例 | 输入 | argv | 退出码 | 耗时 | tool_outcome | test_verdict | claim_verdict |
|---|---|---|---|---|---|---|---|
| 正例（矛盾约束） | `skills/z3/examples/positive.smt2`（输入 SHA 见收据 input_sha256） | `z3 -smt2 <input>` | 0 | 17ms | UNSAT | PASS | NOT_EVALUATED |
| 负例（可满足） | `skills/z3/examples/negative.smt2` | 同上 | 0 | 22ms | SAT | PASS | NOT_EVALUATED |
| 错误输入 | 运行时生成 `(assert (assert`（截断项） | 同上 | 1 | 18ms | UNPARSED | NOT_EVALUATED | NOT_EVALUATED |
| UNKNOWN | 运行时生成 `(assert (> (sin x) 0.9))` | 同上 | 0 | 18ms | UNKNOWN | NOT_EVALUATED | NOT_EVALUATED |

三层分离已由收据字段固化：**工具执行结果**（exit/elapsed/stdout/stderr+SHA）、
**形式模型结果**（tool_outcome：UNSAT/SAT/UNPARSED/UNKNOWN）、
**业务命题判定**（claim_verdict=NOT_EVALUATED + scope 注记）。错误输出落在 stdout
（`(error "line 2 column 0: invalid expression, unexpected input")`），z3 5.1.0 行为。
UNKNOWN 用例 stdout SHA-256：`ff0a7d8548aef17f9bba7e3dc1b4017b0513f9ce60f8c2908f1d06f249a6e497`。

- acceptance：z3 = `CANDIDATE_FOR_REVIEW`（正负例双 PASS，尚需独立 CLI 语义审查）；
  cvc5 = `BLOCK_OR_REPAIR`（不可用）。脚本退出码 2 与 blocked=1 一致。

## NATIVE_PASS_NOT_RUN

- cvc5：NATIVE_PASS_NOT_RUN（本地不存在，未验证）。
- 其余 11 个注册工具：未在本次范围（NATIVE_PASS_NOT_RUN，未扫描）。
- LLM Method 生成、Solve/Verify 编排、语义独立 oracle：未执行（依赖 G2 后续与真实工具集）。

## P0_P1_P2

- **P0：0**。Runner 核心（capture/interpret/executeNativePlan）审计未发现伪造 PASS、
  超时/UNKNOWN 混淆或 shell 注入面；win32 无后缀 `spawn` 实测可用
  （CreateProcessW 自动补 `.exe`）。
- **P1：4 项，均已在收据生成层（`scripts/native-acceptance.mjs`）修复并经验证**：
  1. 收据缺 HOST_IDENTITY → 新增 `host_identity` 块（platform/arch/node/cpu/hostname）。
  2. 收据缺二进制身份（任务硬性要求"二进制路径、版本、SHA-256"）→ 新增 `installation`
     （inspectInstallation 解析路径/候选搜索）与 `binary_identity`（SHA-256/bytes/mtime）。
  3. 缺错误输入与 UNKNOWN 用例 → 新增 `extra_cases`（error_input / unknown_scope），
     期望语义逐条记录，均不产生 acceptance 判定。
  4. （隐私修复会话新增）首采 v1.1 收据在公开仓库暴露真实主机名与 22 处本地绝对路径
     （含 Windows 用户名临时目录与错误文本内嵌路径）→ v1.2 落地收据层强制脱敏 +
     fail-closed 不变量 + `tests/native-acceptance-privacy.test.mjs`（4 用例），重采后
     隐私扫描 0 命中；z3 判定与 stdout SHA-256 与首采逐项一致。
- **P2（记录，不在本任务修复）**：
  1. z3.exe 供应链来源未审计（继承自废弃 dx-service venv）；正式 NATIVE_VERIFIED 前应
     换用 portable bundle 或经哈希链验证的官方分发。
  2. `native-catalog.mjs` `encodeOpt` 存在重复的 `type==="bool"` 分支（无害死代码）。
  3. cvc5 与其余 11 工具本地缺失，待 portable 构建产出；UNKNOWN 用例仅覆盖 z3 实测行为。

## 验证

- `tsc --noEmit`（= `npm run typecheck`）：exit 0。
- `node --test tests/*.test.mjs`：154 pass / 0 fail / 2 skipped（skips 与基线 stash 对照
  一致，非本次改动引入；含新增 4 条收据隐私用例），exit 0。
- 隐私修复重采收据（schema v1.2）与首采（v1.1）证据等价：z3 正例 UNSAT PASS、负例 SAT
  PASS、error_input UNPARSED exit 1、unknown UNKNOWN exit 0，stdout/stderr SHA-256 逐项
  相同，二进制 SHA-256/bytes 相同；仅元数据路径/主机名按隐私规则折叠，计时与临时目录
  名每轮固有不同。
