# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组；breaking 变更在 `Removed` 标记并附 **Migration**。

## [1.0.0] - 2026-10-30

首个公开稳定版。仓库历史、发布链路与文档体系整体重建；CLI 契约以本版本为准。

### Added

- **统一构建产物**：`npm run build` 输出扁平 `dist/index.js`（`rootDir: src/abap_cli`），npm 包只含 `dist` / `abap/src` / `skills` / `agents`。
- **单一命令注册表**：`src/abap_cli/registry/commands.ts` 是唯一命令清单；drift 检查、文档生成与测试全部从它派生。
- **文档生成与校验**：`npm run docs:build` 从真实 `--schema --json` 输出生成 `docs/commands.md`、skills quick refs、wiki 命令索引与缺失页 stub；`npm run docs:check` 已并入 `npm run verify`，生成物漂移会让 CI 失败。
- **CI 验证闸门**：新增 `verify.yml`（push / PR 跑 `npm run verify`），`publish.yml` 在发布前自行 verify 并校验 tag 与 `package.json` 版本一致。

### Changed

- **版本号单线**：`package.json`、ICF service（`ICF_SERVICE_VERSION` / ABAP `gc_version`）、CHANGELOG 统一为 `1.0.0`，结束 0.2.x 时代 package 与 ICF service 版本分离的历史。
- **根文档与知识库收敛**：`docs/commands.md` 等生成物禁止手改；`wiki/` 默认全量入库（草稿放 `wiki/_local/`）；一次性 feedback 报告、Copilot 指针文件、旧 spec 引用全部移除。
- **构建/验证流程**：新增 `clean`、`docs:build`、`docs:check`；`verify = build + test + docs:check + skills drift`；本地 pre-push hook 只作快速反馈，CI 是权威闸门。

### Removed (breaking)

- **extensions 扩展机制**：删除 `abap extensions`（含 `list` / `lock`）、`src/abap_cli/extensions/`、`.abap.json` 的 `extensions[]` 字段、`meta.extensions` 输出及 `EXTENSION_*` 错误码；命令面收敛为 29 个顶层命令。**Migration**：从 `.abap.json` 删除 `extensions`；依赖扩展 hook 的流程需在 CLI 外实现。未来若重做，另立设计。
- **deprecated 别名与兼容开关**：`--max`（select/search，改用 `--limit`）、`--system`（init，改用 `--profile`）、`--type SICF`（改用 `--type HTTP`）、`ABAP_CLI_LEGACY_CREATE`。**Migration**：替换为 canonical 参数即可。
- **0.x 的 npm 版本线**：0.1.0–0.2.8 已从 npm 下线且版本号不可复用；升级请安装 `abap-cli@1.0.0`。

**Migration（已部署 ICF 服务）**：ICF service 版本从 `0.6.0` 升到 `1.0.0`，执行一次 `abap deploy --yes` 重建/更新服务；旧的 `/sap/zabap_vibe` 节点不会自动删除。

### History

0.1.0–0.2.8 的逐版本变更记录随旧 git 历史归档（不再参与本仓库的版本叙事）；npm 上对应版本已全部下线。
