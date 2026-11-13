# Google Drive App · 软件资产库维护指南（2026-11-13）

[App 入口](https://drive.google.com/drive/folders/1zZV3LcoOebjKqrbDNH2NOsqPMkM9xgJw) 今后用于给 ChatGPT/本地 Agent 提供可离线安装的软件、工具、运行时和版本化验证收据。项目研究资料、临时产品文件与软件安装资产分离。

## 目录结构

```text
App/
  00-INBOX/                  默认上传入口，待完整性、来源和运行验证
  10-formal-tools/
    portable/                原 packages：36 个工具 tar、5 个共享运行时、core、SHA256SUMS
      tools/
      runtimes/
    python-wheelhouses/      原 whl：11 份 Python3.13 离线 ZIP + 原始校验清单
    validation/              原 verified：验证收据、限定资格索引，不重复存储软件
      receipts/
      whl-scoped-cp313/      唯一额外保留 highspy 1.16.0 正确命名消费别名
  90-archive/
    Formal-Methods-legacy/   旧版安装包、WSL 环境缓存、历史经验/技能（异版本不删）
    project-exports/         原根目录 DKE/DIS 临时项目资料
```

## 对上传者的简单要求

- **统一上传 App/00-INBOX**，不要直接把未检查内容放到正式工具目录。未来如有其他工具集，用 `App/10-<project>` 独立分类。
- 名称尽可能采用 `<tool>-<version>-<os>-<architecture>.<ext>`；多分片使用连续 `.part-00` 等，每片尽量不超过 128MiB。
- 同批提供 `SHA256SUMS` 或 manifest（工具入口、源/许可、运行时、操作系统/ABI、依赖和版本）。新旧版本不能覆盖混淆。
- 执行者先核对 SHA、解包路径/符号链接，进行非 root 隔离安装与正例/反例/错误输入验证，再通过**移动**进入正式目录。
- 验证结果放在 `validation` 和 GitHub [#24](https://github.com/kaicreator-mm/formal-tools/issues/24)、[产品 #11](https://github.com/kaicreator-mm/formal-tools/issues/11)。**同一个二进制只存一份**，验证无需再复制包。
- 无法证明内容一致时，不执行永久删除；不同版本、不同 ABI、zip wheelhouse 与 portable tar、Lean4 完整包与分片、原始来源与必须保留的错误命名证据，不算简单重复。

## 去重和正式资格

[资产正本 ID + 历史副本 ID 映射](APP_CANONICAL_CATALOG.json) 保存了本次目录调整依据。源文件 ID 没有变化；旧验证文件夹 ID 也保留。旧 [R2 验证矩阵](../r2/ASSET_LANES.json) 的副本 ID 是历史证据，不再作为长期下载地址；最新消费链接以本目录索引和源文件 ID 为准。

Why3 **重新上传版本**与旧版不同，必须重新执行安全预检/证明验证；Lean4 分片虽然与整包字节数匹配，仍需要真正 SHA256 重组验证；不因目录清理自行升为 PASS。

特殊保留：原始 `highspy-whl-1.15.1-...zip` 实际内部为 highspy 1.16.0，保留原名和原 SHA 文件并额外保留正确命名的 `highspy-wheelhouse-1.16.0-...` 别名。原 HiGHS 1.15.1 的 Registry 锁定仍单独审核。
