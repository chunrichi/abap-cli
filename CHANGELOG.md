# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六类按版本分组。Breaking 变更同时在 `Removed` 与 `Migration` 列出。

## [Unreleased]

### Changed
- **P1 — `--schema` 统一为 unified envelope**：`run` / `select` / `tcode` / `where-used` 的 `--schema` 此前直接在 stdout 输出裸 schema 对象（`{command, arguments, ...}`），与 `search` / `create` 的 unified envelope 不一致。现全部改为输出 `{ status: 'success', meta, data }`（`data` 为原 schema，`meta` 为精简版 `command` / `version` / `durationMs`，支持 `--pretty-json` 缩进）。**Migration**：Agent 消费 `abap run|select|tcode|where-used --schema` 时，从 `JSON.parse(stdout)` 改为 `JSON.parse(stdout).data`；未使用 `--schema` 的输出不受影响。
- **P1 — envelope JSON Schema + 全命令契约测试**：新增 `src/abap_cli/output/cli-output.schema.json`（draft-07，success/error 两种 envelope 的单一事实源，覆盖 meta / error / extensionMeta 结构、error.category 枚举、error.code 命名模式）与 `test/unit/envelope-schema.test.ts`。测试扫描 `src/abap_cli/commands/*.ts` 的全部注册命令：① 每个命令的失败路径（未知选项）必须在 stderr 输出 schema-valid 的错误 envelope、stdout 严格为空、exit 2；② 每个带 `--schema` 的命令（create/run/search/select/tcode/where-used）成功路径输出 schema-valid 的 envelope 且 meta 仅含 `command`/`version`/`durationMs`；③ 扩展错误必须使用专用 `EXTENSION_*` code（不伪装内建错误）。

### Fixed
- **P0 — Windows / cross-platform path contract**：所有 `--json` 输出的路径字段统一为 POSIX 相对路径（`/`），Agent 在 Windows / Linux / macOS 下消费到同一种结构。新增 `src/abap_cli/core/path-output.ts` 提供 `toOutputPath` / `toRelativeOutputPath` / `normalizePullData` 三个边界 helper（`isPathLike` 为内部判别）。Node 的 `path.join` / `path.relative` 仍用于 fs I/O（host-native 必需），但所有进入 `data` envelope / human 文本的路径都先经过规范化。受影响字段：
  - `create`：`data.file`（local 创建草稿 + DDIC/HTTP `--file`）、`data.localFile`（create-then-pull）、`error.details.file`、`human` 中的 `relPath`。
  - `pull`：`data.file` / `data.entries[].file` / `data.entries[].files` / `data.written` / `data.skipped` / `data.failed`（单对象、textpool、DDIC 单文件、TABL/STRU three-piece、HTTP、remote、package 批量、transport 批量六条路径全覆盖）；human 消息和 `OVERWRITE_REQUIRED` 错误文本中的 `file` 字段同步。
  - `push`：`data.results[].file` + human 文本；`--atomic` 失败的 `details.failures[].file`、DDIC/HTTP 校验与 `FILE_PARSE_ERROR` 的 `details.file` / message。
  - `deploy`：`data.files[].file`。
  - `init --agent`：`data.written` / `data.skipped`。
  - `init`：`data.configPath`（`--show-config` / `--unset-*`）与 `CONFIG_ERROR` 的 `details.file`。
  - `profile`：`profile export --file` 的 `data.file` + human；`PROFILE_MISMATCH` warning 文本中的 workspace 相对路径。
  - `doctor`：`config.active` verbose 文本中的 workspace 相对路径。
  - `check`：`data.issues[].file`、`data.out`（仅 `--atc --out` 时报告；显式路径回显用户输入、默认值输出相对 POSIX `.abap/atc/<variant>-<ts>.json`，且与真实落盘文件一致）、persisted ATC JSON 的 `files[].file`。
  - `status` / `diff`：`data.parts[].detail`（`local file: <path>` 改为相对 cwd 的 POSIX 路径）。
- **绝对路径字段统一转为 cwd-relative POSIX**：`push` 的 `data.results[].file`、`check` 的 `data.issues[].file` 与 persisted worklists、`status`/`diff` 的 detail 原本是 `path.resolve` 的绝对路径，跨平台前缀不一致（`C:/...` vs `/...`）。现全部输出 cwd 相对 POSIX 路径（新增 `toRelativeOutputPath` helper），Agent 在任意平台看到同一形状。`diff` 内部读取 detail 路径时用 `path.resolve(cwd, ...)` 转回绝对路径供 fs 使用。
- `path: "src/clas/..."` 形式的字面量（用户 `--file` 参数 / `out` 配置等）若包含 `\` 也自动转为 `/`，避免 Agent 在 Windows 上解析失败。
- **测试基线**：上游 Windows 报告的 54/756 失败是 `path.join` 输出 `\` 与测试期望 `/` 的冲突，本次新增 19 条 `path-output.test.ts`（含 `toRelativeOutputPath` 5 条，覆盖显式 `cwd` 参数）+ 修正 `pull-layout.test.ts` 用 `path.join` 写死 `/` 的两处断言 + `check-modes.test.ts` 的 `out` 断言改为跨平台正确（并补 `--out` 未传时不报告 `out` 的回归断言）+ `push-transport.test.ts` 补失败分支 `details.results[].file` 归一化断言。本机 macOS / Linux 上 787/787 全绿，Windows CI 同代码也将看到同样结构化结果。

## [0.2.1] - 2026-08-25

### Added
- **034 — ADT runtime API capabilities + 持久化 cache**：`probeAdtRuntime` 探测输出新增 `apiCapabilities: { icf: { available, primaryPath? }, httpService: { available, acceptsMime?, createAuthRequired? }, steampunkMarkers? }` —— 仅通过 discovery endpoint 收集（trial 真测：`{ icf: { available: false }, httpService: { available: true }, steampunkMarkers: ['steampunk','hana.ondemand'] }`；on-prem S4CORE： `{ icf: { available: true }, httpService: { available: false } }`）。`SystemProfile` 加 `runtime?: CachedRuntime` 字段，由 `profile test`（adt layer 成功时）刷新到 `~/.abap-cli/systems.json`。`extension deploy` 优先读 cache，缺时再 `probeAdtRuntime`。新增 `src/abap_cli/config/runtime-cache.ts`：`getOrProbeRuntime(name, { force? })` / `readCachedRuntime(name)` / `clearRuntimeCache(name)`。**真 BTP trial 端到端验证**：`profile test btptrial --json` 后 `~/.abap-cli/systems.json` 的 `systems.btptrial.runtime` 含 `tier: "steampunk"` + `apiCapabilities`，随后 `extension deploy --dry-run --json` 命中 cache，`runtime: "steampunk"` / `deployKind: "source-only"` / `icfNode: {status: "planned"}` 不变。
- **034 — ICF register strategy registry**：`extension deploy` 的 ICF 分支重构为 `IcfRegisterStrategy` 接口 + `icf-register-registry.ts` + `icf-bootstrap.ts`。三个内置 strategy： `OnPremClIcfTreeStrategy`（包装 `ZCL_ABAP_VIBE_ICF_SETUP` classrun，030 行为不变 — on-prem / unknown 默认走它）、 `SteampunkCockpitFallbackStrategy`（保留 030 Cockpit destination hint 行为）、 `SteampunkSwbStrategy`（未来 SAP-side SWB 接入占位 — `supports()` 当前总是 false，等 SAP 文档化 `/sap/bc/adt/ucon/httpservices` POST body schema 后翻转；trial 实测 `POST` 返回 500 SY530、 `PUT` 返回 403 S_ABPLNGVS，普通用户无法注册）。`registerIcfStrategy()` 是唯一新增策略的入口；deploy-flow 不再包含硬编码 if/else 逻辑。新增 `src/abap_cli/adc/icf-{register-strategy,register-registry,bootstrap}.ts` + `adc/strategies/{on-prem-cl-icf-tree,steampunk-cockpit-fallback,steampunk-swb}.ts`。
- **030 — ADT runtime 分层 + Steampunk `extension deploy` 分流**：新 `src/abap_cli/adc/runtime-probe.ts` 探测三档 ADT runtime（`netweaver740` / `netweaver750` / `steampunk` / `unknown`），依据 `/sap/bc/adt/repository/informationsystem` Atom XML 的 `sap-component`（首选，trial 上 404）+ `/sap/bc/adt/discovery` workspace 的 `/sap/bc/adt/icf/*` collection 缺失 + `Steampunk` / `hana.ondemand` / `abap-env` 关键字（备用，**trial 上是这一支**）。`IcfDeploymentInfo` 加 `runtime` + `icfSetupBlocked` 字段；`extension status` JSON 输出含 `runtime` / `icfSetupBlocked`；`extension deploy` 在 Steampunk 下走 `deployKind: "source-only"`，sources 照常 deploy，ICF 节点注册改为 `meta.warnings[].code: "STEAMPUNK_ICF_MANUAL"` + human 输出 Cloud Foundry destination 步骤（不抛错）。on-prem 用户行为**完全无感**（仍走 `cl_icf_tree`）。**真 BTP trial 验证**：4 个 CLAS（`ZCL_ABAP_VIBE_ICF` / `_ICF_SETUP` / `_RUNNER` / `_TABL_FORMAT`）deploy 成功（`changedAt` 17875882xx = 2026-08-25），`/sap/bc/adt/discovery` 返回 444KB / 940 collections / 0 个 `/sap/bc/adt/icf` / 8 个 Steampunk 关键字命中。设计 + 决策见 `specs/030-btp-ext-deploy-strategy/spec.md`。
- **`src/abap_cli/clients/create-object.ts`**：BTP-safe CLAS / INTF / PROG / FUGR create wrapper。等价复刻 `abap-adt-api` `createBodySimple` 的 XML body（root element + `<adtcore:packageRef>` + on-prem 包加 `<adtcore:uri>`），加 BTP 必需的 `<class:include class:includeType="testclasses"/>` + `<class:superClassRef/>`，Content-Type 改 `application/vnd.sap.adt.oo.classes.v4+xml`。`AdtClientWrapper.createObject` 默认走 wrapper；设 `ABAP_CLI_LEGACY_CREATE=1` 退回 library。
- **`auth/sso-loopback.ts`**（026 重做）：删除旧 helper-page "粘 Cookie header" 流程。`abap profile login <name>` 启 127.0.0.1 loopback listener + open browser 到 `<url>/sap/bc/adt/core/http/reentranceticket?redirect-url=…&sap-client=…&_=…`，按 Eclipse 形态捕获 cookie。
- **auth 认证策略模式重构**：`auth/adapter.ts` 拆为薄 dispatcher + `auth/strategy.ts` registry + `auth/strategies/{basic,cert,browser-sso,oauth-password}.ts`（side-effect 自注册，`registry-bootstrap.ts` 聚合）。新增通用 `--auth-option key=value` flag（可重复）：新认证方法无需新增 Commander option，从 bag 读字段。401/403 hints 由各 strategy 自带（`http-error.ts` 不再维护 per-method 常量）。`config/secrets.ts` 包一层 `SecretsBackend` 接口（当前仅 keytar），公共 API 签名不变。

### Changed
- **`oauth_password` 密码查找链调整**：`init-flow.resolvePassword` 与 `auth/strategies/oauth-password.ts` 现在按 **`OS keychain` → `--password` → TTY prompt** 查找（TTY prompt 输入后自动 store 到 keychain）。`init` wizard 在 `oauth_password` 也走 keychain prompt/store 流程（之前只对 `basic` 生效）。验证：`unset BTP_PASSWORD* && abap profile test btptrial` 直接从 keychain 取密码，tls/auth/adt 全 ok。
- **create-object body 去掉 `adtcore:responsible` 属性**：实测 BTP trial `CLASS_TRANSFORMATION` ST 拒绝带 `adtcore:responsible` 的 body（offset ≈370）。保留 comments 解释原因 + 验证记录。
- **CHANGELOG 压缩**：将 [Unreleased] 区段从 025 → 028 累积的 100+ 行展开压成核心条目。025 / 026 / 027 / 028 / extension / trial-real 诊断等已 release 的内容整体下移到 `docs/CHANGELOG-history.md`（即将提交）。
- **`init --agent` 路径分层**（breaking）：每个 vendor 写入 agent 框架约定的子目录，不再污染 workspace 根。
  - `copilot` → `.github/skills/<name>/` + `.github/agents/abap-developer.md`
  - `claude`  → `.claude/skills/<name>/` + `.claude/agents/abap-developer.md` + `CLAUDE.md`
  - `cursor`  → `.cursor/skills/<name>/` + `.cursor/agents/abap-developer.md` + `.cursor/rules/abap.mdc`
  - `generic` → `.agents/skills/<name>/` + `.agents/agents/abap-developer.md`
  - **不再**写入 `AGENTS.md` / `copilot-instructions.md` / `skills/README.md`。
  - **Migration**：先前已 `init --agent copilot` 把 `skills/` `agents/` `AGENTS.md` 倒在 workspace 根的目录手工删除即可（`rm -rf skills agents AGENTS.md .github/copilot-instructions.md`），重新跑 `abap init --agent copilot` 即可落到 `.github/` 正确位置。

### Removed
- **移除所有 env 密码读取**（breaking）：`SAP_PASSWORD` / `SAP_PASSWORD_<PROFILE>` / `BTP_PASSWORD` / `BTP_PASSWORD_<PROFILE>` / `CERT_PASSPHRASE_<PROFILE>` / `ABAP_CLI_SECRETS_BACKEND` 不再被读取。密码只来自 `--password` flag、OS keychain、TTY prompt。
  - **Migration**：CI / headless 脚本若依赖 env 密码，改为在启动时 `abap profile set <name> --password <pw>` 写入 keychain，或每次命令传 `--password`。

### Known limitations
- **BTP trial `extension deploy` 仅 source-only**（030 spec）：`cl_icf_tree` / `cx_for_icf_tree` / `ICFHOSTNUM` 是 Steampunk Released APIs 白名单禁（`LA(020)`），无法自动注册 SICF 服务。CLI 探测 runtime 后分流：on-prem 走 `cl_icf_tree`（现状），Steampunk 仅 deploy sources 并把 ICF 节点注册移到 CF destination（自动 hint 输出到 `meta.warnings`）。设计细节见 `specs/030-btp-ext-deploy-strategy/spec.md`。`create` / `push` / `activate` / `inspect` / `transport` / `profile test` / `search` 在 trial 全跑通。
- **BTP trial `reentranceticket` 当前不接受裸调**：需 abap-web 已设的 session cookie，CLI 单端点无法复刻 Eclipse 完整 OAuth2 PKCE chain（web-router client secret 在 SAP server 端，且 trial service-key 的 `redirect_uri` 不接受 `127.0.0.1`）。新 `sso-loopback.ts` 在 trial 上卡在 abap-web 不自动跳 loopback；未来 abap-web 改 redirect 行为或 SAP 开放 web-router code-exchange endpoint 时无需改动即可工作。trial 上唯一自动化 SSO 是 `oauth_password`。

## [0.2.0] - 2026-08-20