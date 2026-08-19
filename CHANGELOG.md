# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六类按版本分组。Breaking 变更同时在 `Removed` 与 `Migration` 列出。

## [0.2.0] - 2026-08-20

### Removed
- **`abap config` 命令**（026）—— `config show` → `abap init --show-config`；`config set` → `abap init --profile / --tr / --package / --source-dir`（首次创建与后续修改走同一条路径：merge 已存在的 `.abap.json`，不替换）。理由：`init` 已覆盖「绑定 + 修改」，`config` 是冗余语义层。删除 `src/abap_cli/commands/config.ts`；`index.ts` 的 `COMMAND_SPECS` 不再包含 `config`。迁移见下方。

### Added
- **`abap init --show-config`**（026）—— 只读打印当前 `.abap.json`（向上找最近的，git 边界停）。不连接 SAP；agent 可任意时刻自省当前 workspace 绑定。
- **`abap init --unset-package / --unset-tr / --unset-source-dir`**（026）—— 从 `.abap.json` 移除指定顶层 key；非 TTY 需 `--yes`。补齐原 `config set` 不支持清空的缺陷。
- **`abap init --source-dir <path>`**（026）—— 写入 `.abap.json` 的 `sourceDir`（`push --all` / `check --all` 的基目录）。
- **三层职责收敛** —— `profile`（全局连接档案） / `init`（工作区绑定 + 修改 + 自省 + agent 脚手架，唯一入口） / `doctor`（诊断）。
- **三种 JSON 输出模式**（025）—— 新增全局 `--pretty-json`。`OutputMode = 'human' | 'json' | 'pretty-json'`；`--json` 紧凑（省 LM agent token），`--pretty-json` 缩进 2。`jsonFromCommand(cmd)` 返回 `OutputMode`；`printResult/printError/renderResult/renderError` 第一参数由 `boolean` 升级为 `OutputMode`。
- **`stripEmpty()` token-efficient**（025）—— `renderResult` 在 json/pretty-json 模式递归清空 `data` 中的空 `{}` / `[]`（保留 `null`/`false`/`0`/`''`），节省 ~5–20% LM agent token。
- **`--schema` 精简 meta**（025）—— `meta` 不再含 `timestamp` / `warnings`，仅保留 `command` / `version` / `durationMs`；schema introspection 跨运行稳定。
- **`abap tcode`** —— 只读解析事务码到其配置的 ABAP 入口程序 / 屏幕，走 ICF `GET /tcode/<code>`（SAP 端 `dispatch_tcode` / `read_tcode`，含 `S_TCODE` 权限检查）。错误码：`TCODE_NOT_FOUND`（NOT_FOUND/8）/ `TCODE_NOT_AUTHORIZED`（AUTH_ERROR/5）。
- **`abap where-used`（别名 `references`）** —— 只读查询对象的直接引用（ADT `usageReferences`）。支持 `--type` / `--ref-type` / `--package`（大小写不敏感）/ `--limit`（默认 100，上限 500）/ `--schema`；类型 CLAS / INTF / PROG / FUGR / TABL，非法类型报 `TYPE_NOT_SUPPORTED`。截断时通过 `nextSteps` 提示提高 `--limit` 或收窄过滤。
- **TABL/STRU 三件套 pull**（024）—— `abap pull <name> --type TABL|STRU` 写出 abap-file-format 三件套：`src/tabl/<name>.tabl.json` + `<name>.tabl.ddic` +（TABL only）`<name>.tabl.settings.json`；STRU 无 `settings.json`。新增 `src/abap_cli/dictionary/tabl-artifact.ts`（`parseTablDdic` / `tablArtifactPaths` / `isTablArtifactFile`）；`dictionary/ddic-json.ts` 扩展 `DdicFieldLocal`/`DdicFieldWire`（`precField`）+ `extractTablArtifactWire`；`flows/pull-flow.ts` `runPullDdic` 检测三件套 wire → 走 `writePullDdicTabl`（先校验 DDL 再写文件，保证不落部分文件），`--overwrite` 覆盖三件套。ICF 服务 0.4.0 → 0.5.0（SAP 端 `zcl_abap_vibe_tabl_format`）。错误码：`TABL_DDL_INVALID`（VALIDATION_ERROR/7）/ `TABL_ARTIFACT_INCOMPLETE`（VALIDATION_ERROR/7）。push 路径仍走 014 的单文件 wire（flat push），三件套 push 留作 follow-up。
- **HTTP service 拉取 / 推送 / 创建**（022）—— `abap pull <name> --type HTTP` / `abap push <file>.http.json` / `abap create HTTP <name> --file <file>.http.json` 全部走自建 ICF `/http/<name>`。`folderFor('HTTP') = 'http'`，本地布局 `<rootDir>/http/<name>.http.json`，与 abap-file-format `zif_aff_http_v1` 嵌套结构（`header` + `generalInformation`）双向兼容。`dictionary/http-json.ts` 含 `localToWire` / `wireToLocal` / `validateHttpObject`，namespace Z/Y/slash 强制；`IcfClient` 新增 `getHttp` / `postHttp`；`--atomic` 推送对 HTTP 文件做结构化 JSON 校验。错误码：`HTTP_CREATE_FAILED`（SAP_ERROR/6）/ `HTTP_OBJECT_NOT_FOUND`（NOT_FOUND/8）。
- **`abap --help` local / SAP 命令分组** —— `LazyCommandSpec` 新增 `scope: 'local' | 'sap'`；4 个本地命令（`init` / `profile` / `doctor` / `extensions`）显式标注。
- **扩展机制**（023）—— `ValidationRule` / `LifecycleHook` / `CommandExtension` 三种扩展类型，支持 `.abap.json` 配置加载 + `extensions list` 命令。新增 `src/abap_cli/extensions/`；`ABAP_CLI_EXTENSIONS_STRICT=1` 开启严格模式（扩展加载失败则 exit 3），非严格模式下失败记录到 `meta.extensions.failed`。路径扩展安全性：仅允许 cwd 和 `~/.abap-cli/extensions/` 下的文件，防止路径穿越。错误码：`EXTENSION_LOAD_FAILED`（CONFIG_ERROR/3）/ `EXTENSION_VALIDATION_FAILED`（VALIDATION_ERROR/7）。
- **`abap select`（016）** —— read-only table data 查询 CLI（`SE16N` 等价），走自建 ICF。选项：`--table`（DDIC 校验）/ `--fields`（投影）/ `--where`（AND-only 严格语法）/ `--limit` / `--offset` / `--order-by` / `--count-only` / `--dry-run` / `--schema`。三层注入防御（字段 DDIC 校验 + 值走绑定变量 + limit/offset 服务端再校验）。v1 仅 TABL + VIEW。
- **`abap run`（015）** —— 执行 ABAP class（classrun）或 static method，闭环 push → run → verify。两条路径：classrun 触发 `if_oo_adt_classrun~main`；wrapper 反射调用公开静态方法并序列化结果。`detectPlainTextError` 识别真 SAP 的纯文本错误消息。错误码：`METHOD_FAILED` / `METHOD_NOT_SUPPORTED` / `CLASS_NOT_RUNNABLE` / `OBJECT_NOT_ACTIVE` / `LOCAL_CLASS_NOT_RUNNABLE` / `TIMEOUT` / `WRAPPER_NOT_DEPLOYED`。
- **`abap pull --remote <system>`**（015）—— 从远端系统拉取对象的 active 版本（ICF `/version-source`，TMS RFC 目的地）。类型映射 PROG/INTF/CLAS；JSON 结果含 `remote` + `version`。`REMOTE_VERSION_NOT_FOUND` 归一为 `OBJECT_NOT_FOUND`；无效 system ID 客户端 `INVALID_ARGUMENT`。
- **`abap push` 按对象解析 transport；DDIC `.json` 经 ICF**（014）—— 无 `--tr` 时若对象已绑请求或位于 `$TMP` 也可推送（`pushOne` 每次 `transportInfo` 复用对象自身请求）。DDIC 文件走 ICF `POST /sap/zabap_vibe/ddic/<type>`；`--check-only` 对 DDIC 拒绝；`--atomic` 对 DDIC 做结构化 JSON 校验。
- **`abap deploy` 缺包自动建 + per-part 激活** —— 首次全新 SAP 部署不再 `Object ... does not exist`：按对象分组 → resolveObject 失败则调 createObject → pushObject 每 part；结果新增 `objects` 数组（created/updated/unchanged/failed）。pushObject 后逐 part 激活（修复根 URI 激活在 method/OSI 项上的静默失效）。
- **`abap check --atc --out [file]`** —— `--out` 与 `--atc` 一起用，把完整 SAP `AtcWorkList` 落本地文件；stdout 仍打印映射后的 `CheckIssue[]`。非 `--atc` 时 `--out` 拒绝。
- **`abap doctor` 报告未初始化 workspace** —— 无 `.abap.json` 时 config 节输出 `config.workspace`（err）并指引到 `abap init`，不再静默省略。
- **CLI 命令树重构**（021）—— 19 个顶层命令收敛为 16 个。新增能力：`abap init --agent <target>`（幂等脚手架 AGENTS.md + skills/ + 厂商入口文件，`--force` 覆盖）；`abap extension status`（只读探测 SAP 侧 ICF 服务 installed/version/match）；`abap check syntax|content|atc` 子命令化（`--files` 父命令快捷方式）；`abap profile`（承接原 connection，保留 `set`，`use` 并入 `init --profile`）。`package.json` `files` 增补 `skills/` `agents/` `AGENTS.md` `.github`，供 `--agent` 脚手架分发。
- **Skill/agent 分发包 v1.1 自包含重构**（019）—— 顶层 `skills/` `agents/` 提供 3 个 skill（`abap-setup` / `abap-edit` / `abap-data`）覆盖全部 CLI 命令 + 1 个编排 agent（`abap-developer`）；自包含结构（SKILL.md + references/scripts/assets），frontmatter 遵循 agentskills.io 开放标准，跨 Claude Code / Cursor / Copilot / Continue / Codex 兼容。
- **Skill bundle 强化**（020）—— 新增 `test/unit/skill-bundle.test.ts`（25 用例）自动校验 frontmatter / 目录一致 / 命令覆盖 / 路径约束 / 行数限制。
- **SAP JSON 生成统一为 `/ui2/cl_json`**（017）—— 三个 ABAP 类（`ZCL_ABAP_VIBE_ICF` / `_RUNNER` / `_SETUP`）约 74 处手工拼接统一为 `/ui2/cl_json=>serialize`；DDIC 拉取改结构化 wire 类型。vhcala4hci 旧版不转义 `"` / `\` —— 新增一次探测 + 自转义。服务版本 0.2.0 → 0.4.0。
- **新 ErrorCode**（025）—— `DDIC_TABL_FORMAT_UNSUPPORTED`（VALIDATION_ERROR/7，canonical TABL 投影无法表示对象）；`PULL_PARTIAL_FAILURE`（VALIDATION_ERROR/7，部分对象 pull 成功/失败统计）。
- **`abap init --agent <target>` 脚手架**（021）—— target 支持 `generic`（基础 `AGENTS.md` + `skills/`）/ `copilot`（+ `.github/copilot-instructions.md`）/ `claude`（+ `CLAUDE.md`）/ `cursor`（+ `.cursor/rules/abap.mdc`）。幂等；已存在文件默认跳过，`--force` 覆盖。
- **npm 发布准备** —— `files` 增加 `abap/src`（`abap deploy` 运行期依赖的打包 ABAP 源码）；补 `repository` / `homepage` / `bugs` 元数据。

### Changed
- **`abap deploy` 默认包 + transport 规则** —— `--package` 现默认 `$TMP`（对齐打包的 `abap/package.devc.xml`）。`--tr` 仅当 `--package` 非 `$TMP` 时必需。
- **`abap connection import` 默认跳过已存在 profile** —— `--overwrite` 才覆盖。
- **Lazy command 注册** —— `src/abap_cli/index.ts` 改为 `COMMAND_SPECS` 表 + `registerLazyCommands`，仅在命令分发或 `--help` 时才 import 模块（及重依赖：keytar / abap-adt-api / clack）。CLI 入口用 `program.parseAsync()`。
- **Unify pull/push 编排迁入 `sync/`** —— `sync/pull-flow.ts` 承担整 pull 流程；`sync/push-flow.ts` 新增文件级 `runPush` 编排。同时打破 `formats/` ↔ `sync/` 包循环（`ObjectPart` 等移入 `formats/object-parts.ts`）。
- **`abap config` 对 `.abap.json` 覆写遵循 `--yes` / `--non-interactive`** —— 参数化路径原先即使带 `--yes` 也拒绝已存在的 `.abap.json`；现在 `--yes` / `--non-interactive` 下覆写。

### Fixed
- **`abap search --page-all` 单请求拿全量** —— 真 ADT quickSearch 无 offset（旧循环只在首轮停），现单次 `searchObject` `maxResults = --limit × --page-all-max`（默认 1000；vhcala4hci 验证 5000）。同时修 `--exact`：`*` 在客户端严格比较前剥除，裸名加宽为 `*NAME*`。
- **`abap push` 不再把命名 include 落到 main part** —— 推 `zcl_foo.clas.macros.abap` 给无该 include 的对象时不再写覆盖 main。命名 include 必须严格匹配，否则 `SAP_ERROR`（exit 6）。
- **`abap pull FUGR` `.func.json` 现含 `includeNumber`** —— 函数模块元数据补 `includeNumber`（schema `$required`）；从函数组 UXX include 源解析，UXX 缺失回退到模块在组内的 1-based 位置。
- **Transport write 保护** —— `abap transport create` / `assign` 现在按写操作对待，遵循 `--yes` / `--dry-run` 契约；非 TTY `VALIDATION_ERROR`（exit 7）拒绝。
- **错误契约 CI 强制** —— 命令边界目录每个 `throw new <Error>` 必须构造 `CliError`，由 `test/unit/cli-error-boundary.test.ts` 强制（lint 扫 + allow-list）。
- **stdout / stderr 分离审计** —— `--json` 失败路径原先会泄漏纯文本帮助到 stdout；commander 顶层错误处理重构为 `src/abap_cli/top-error.ts`，所有路径统一走它。`--json` 模式保持 stdout 空，stderr 走 JSON 信封 + 帮助正文。

### Migration

#### `abap config` 移除（026）
| 旧命令 | 新命令 |
|---|---|
| `abap config show` | `abap init --show-config` |
| `abap config set --profile X` | `abap init --profile X --yes` |
| `abap config set --package Z` | `abap init --package Z --yes` |
| `abap config set --tr DEVK9` | `abap init --tr DEVK9 --yes` |
| `abap config set --source-dir P` | `abap init --source-dir P --yes` |
| （无对应能力） | `abap init --unset-package / --unset-tr / --unset-source-dir --yes` |

非交互环境写操作：所有 `abap init` 修改类调用都需 `--yes`（与既有 `init` 行为一致）。

#### `OutputMode` 类型升级（025）
- `json: boolean` → `mode: OutputMode`（或直接用 `jsonFromCommand(cmd)` 返回值）
- `--json` 用户行为不变（紧凑 JSON 输出）；新增 `--pretty-json` 提供缩进版本
- `printResult(true|false, ...)` → `printResult('json'|'human', ...)`
- `--schema` 响应 `meta` 不再含 `timestamp` / `warnings`（消费方若依赖需调整）

#### CLI 命令树重构（021）
| 旧命令 | 新命令 |
|---|---|
| `abap connection add/list/show/set/test/delete/export/import` | `abap profile …`（同名子命令） |
| `abap connection use <name>` | `abap init --profile <name> --yes` |
| `abap deploy` | `abap extension deploy`（flags 不变） |
| `abap check --syntax/--content/--atc <f>` | `abap check syntax/content/atc <f>`（裸 `abap check <f>` 走 `--files` 快捷方式） |
| `abap atc` | 移除（→ `abap check atc <f> --variant Z_VAR`） |
| `abap sync` | 移除（Agent 显式编排 status → pull → push） |
| `abap report-stuck` + 全局 `--report-stuck` + `ABAP_REPORT_STUCK` | 全部移除（结构化 JSON 错误已覆盖反馈价值） |

旧命令名不再可用，统一按未知命令处理。存储层（`~/.abap-cli/systems.json`、keychain、`.abap.json`）与 `SystemProfile` 内部命名不变——**零数据迁移**。

#### 其他（017）
- **`abap select` 行值为原生类型**（017）—— `data.rows` 单元格按 `/ui2/cl_json` 原生序列化（NUMC/INT/DEC → number、DATS → `YYYY-MM-DD`、TIMS → `HH:MM:SS`）。迁移：`--json` 消费者将 cell 视为 `string | number | boolean | null`；CLI `SelectResult.rows` 类型为 `Record<string, unknown>[]`。ICF 0.3.0 → 0.4.0（`abap deploy` 重新部署）。
- **`abap connection delete <name>` 非交互环境需要 `--yes`** —— 脚本 / CI（无 TTY）原先无条件删 profile + keychain 密码；现以 `VALIDATION_ERROR`（exit 7）拒绝。

## [0.1.0] - 2026-08-05

### Added
- **统一 CLI 输出契约**（012）—— 每个 `--json` 信封带统一 `meta` 块（`command` / `version` / `timestamp` / `durationMs` / `warnings`）；错误带显式 `error.category` 1:1 映射退出码。契约权威文档 `specs/012-unify-cli-output-contract/contracts/cli-output.md`，由 `output-contract-audit.test.ts` 强制。
- **`abap search --schema` / `abap create --schema [type]`** —— agent 参数自描述：JSON 打印机器可读命令 schema 到 stdout，exit `0`，无 SAP 调用。`create --schema` 无 type 列支持的类型，有 type 时附 `templates`。
- **`abap create local <type> <name>`** —— 实验性本地创建草稿骨架文件（abap-file-format 布局），无 SAP 联系。落地：`abap create ... --no-pull` 然后 `abap push <file> --tr <tr>`。

### Changed
- **错误码迁移**（breaking 012）—— 移除 `UNLOCK_WARNING` / `NOT_IMPLEMENTED`；保留 `OBJECT_EXISTS` / `FILE_EXISTS` / `COMMAND_MOVED` / `PUSH_FAILED` 并正式规范化。所有 `Warning:` / `console.warn` 输出改为结构化 `meta.warnings`。
- 文档与 CLI 同步：`docs/commands.md` 现覆盖所有当前选项 / 子命令；README、getting-started、architecture、development 文档更新。
- 裸 `abap` 和裸 `abap connection`（无子命令）打印帮助到 stdout 并 exit `0`。缺必填参数 / 选项先 stdout 打该子命令帮助再 stderr 打结构化 `USAGE` 错误（exit `2`）。
- **`abap connection add <name>`**（name 存在时拒绝）；`connection set <name>` 严格为「修改已存在 profile」，缺失时指向 `add`。
- **`abap pull`** 现写官方 abap-file-format 布局：每对象一目录（`src/<object>/`），含 `<name>.<type>.json` 元数据 + `<name>.<type>.abap` 源 part。
- 类本地类型 include 现使用 abap-file-format 名 `definitions` / `implementations`（breaking 文件名变更）。
- Pull 现组织于按类型的 `PullStrategy`（`formats/pull-strategy.ts`），strategy 是未来类型的扩展点。
- **`abap pull` 现支持 FUGR**（`--type FUGR`），按 abap-file-format fugr 布局；`abap push` 同步支持 FUGR 子对象（独立锁）。
- **`abap pull` PROG 元数据**现含 `generalInformation.programType`；带命名空间的对象名映射到 `#`-转义目录。
- **`abap init`** 不再创建 `src/` 和 `ddic/` 工作目录 —— 仅写 `.abap.json`，目录由 pull / create / sync 按需创建。
- **`abap auth test` 移除** —— 合并入 `abap connection test <name>`（退出码反映最差失败层）。
- **`abap system` 重命名为 `abap connection`**（breaking）；移除裸 `abap system` 后面的交互菜单。

### Fixed
- `abap inspect` 被 import 但从未在 `index.ts` 注册，命令静默不存在；现连上并按文档运行。
- `abap init`（交互、已存在 profile）现在将回退键入的密码持久化到 OS keychain。
- `abap push` 不再手工拼装失败信封——聚合失败现通过统一渲染器抛结构化 `CliError`。
- 未映射异常不再伪装为 `SAP_ERROR`（exit 6）——现以 `UNKNOWN`（exit 1）出现（exit 1 原先不可达）。
- 编辑锁无法释放的推送不再报失败：文件记为成功，问题以 `UNLOCK_WARNING` 进入 `meta.warnings`（退出码仍 `0`）。

### Removed
- `ErrorCode UNLOCK_WARNING` —— 不再是错误码，告警进 `meta.warnings`，退出码 0。
- `ErrorCode NOT_IMPLEMENTED` —— 死代码。如未来需，用 `VALIDATION_ERROR`。
- `abap atc` —— 移除（→ `abap check atc <f> --variant Z_VAR`）。
- `abap auth test` —— 合并入 `abap connection test <name>`。

### Migration
| 旧 | 新 | 说明 |
|---|---|---|
| 无形状异常 → `SAP_ERROR`（exit 6） | → `UNKNOWN`（exit 1） | 无法归类的异常不再伪装 SAP 错误 |
| `OBJECT_EXISTS` / `FILE_EXISTS` / `COMMAND_MOVED` / `PUSH_FAILED` | 保留，规范化 | 类别与退出码不变 |

## [0.0.6] - 2026-08-04

### Added
- `abap doctor` —— 一键环境诊断（environment / config / connection 三节，逐项 ok / err + 优先级 `nextSteps`）；`--fix` 仅应用安全可逆修复。
- `abap connection test <name>` —— 分层连接诊断（`tls` → `auth` → `adt` → `icf`）；退出码反映最差失败层。
- `abap inspect <object>` —— 只读对象元数据探测（`--structure` / `--includes` / `--locks` / `--package`）；永不取锁。
- `abap diff [file]` —— 本地 ↔ SAP 对比，按 part `direction` + 有界行变更 `summary`；只读。
- `abap sync` —— 链式 status / pull / push 工作流（默认 `--status`，`--pull` / `--push`，`--dry-run` 零写计划，`--yes`）；分歧 part 永不静默覆盖。
- `abap report-stuck` —— 本地反馈回路记录（`--goal` / `--tried` / `--where`）返回 `STUCK-` 报告 id；全局 `--report-stuck` flag + `ABAP_REPORT_STUCK=1` 自动触发；凭证永不记录。
- `test/mock-adt/server.js` —— `/sap/zabap_vibe/` ICF 根路由、`MOCK_AUTH_FAIL`、`ZCL_MULTI` 多 include 类 fixture。

### Fixed
- 真 ADT quickSearch 在真实 SAP 上需要 `*` 通配 —— `resolveObject` 在精确名搜索零命中时重试 `*NAME*`。

### Verified
- 单元：112 测试跨 24 文件（38 新增）—— `npm run verify` 绿。
- Mock 端到端：六个命令离线验证。
- 真实 SAP（HANA vhcala4hci）：`connection test` tls / auth / adt ok（icf 404 —— ICF 未部署，预期）；其余命令 ok。

## [0.0.5] - 2026-08-03

### Added
- `abap search <query>` —— 经 ADT 仓库搜索 API 按名搜索 ABAP 对象，返回 `{ name, type, uri, description, packageName }`；`--type` 过滤、`--max` 上限（默认 100）；空结果为成功；查询字符串透传 SAP。
- `test/mock-adt/server.js` 搜索路由现支持 `maxResults` 参数。

### Verified
- Mock 端到端：基本搜索、前缀、空结果、`--type` 归一、`--max` 截断、默认上限、空查询 `USAGE`、`--max abc` `INVALID_ARGUMENT`、无头 `--json` agent 循环（search → pull）。

## [0.0.4] - 2026-08-02

### Added
- `abap transport list [--open]` —— 列出当前用户的 transport 请求（workbench + customizing），含请求号 / 描述 / 状态 / 属主；`--open` 仅留未释放。
- `abap transport create <description> [--package <package>]` —— 经 ADT `createTransport` API 创建新 transport（默认 `$TMP` 本地）；闭合「无请求 → 创建 → `--tr`」闭环，无须 SAP GUI。
- 统一 `--json` 输出与错误码与 pull / push / check / create 一致。
- `tmp/mock-adt/server.js` transport fixture + 创建路由供离线验证。

### Verified
- Mock 端到端：list / create / 闭环（list → create → push `--tr`）/ `NO_TRANSPORT` 路径 / 无头 `--json` agent 循环。
- 真实 SAP（HANA vhcala4hci）：创建本地请求、闭环验证、dogfooding 循环（CLI transport create → pull → edit → push `--tr`）。

## [0.0.3] - 2026-08-02

### Added
- `abap create <type> <name>` —— 经 ADT REST API 在 SAP 中创建新源对象（CLAS / INTF / PROG / FUGR），配 `--package` / `--description` / `--tr` / `--no-activate` / `--json`。
- 每类型默认源骨架（class 写 DEFINITION + IMPLEMENTATION），create → pull → edit → push 循环可走通。
- 创建后激活复用 push 流程（lock → 写骨架 → 激活 → unlock，`finally` 保证释放）；`--no-activate` 仅创建并写骨架不激活。
- Transport 解析复用现有顺序（`--tr` > `.abap.json` > 用户开放请求 > `NO_TRANSPORT`）。
- 对象名归一化、类型映射（CLAS / OC、INTF / OI、PROG / P、FUGR / F）。
- DDIC 类型以 `DDIC_NOT_SUPPORTED` 拒绝（ICF 服务，后续阶段）；未知类型以支持的列表拒绝。
- `tmp/mock-adt/server.js` 现处理对象创建（ADT createObject POST）。

### Verified
- Mock 端到端：create → pull 往返、edit → push 迭代、重复 create → `OBJECT_EXISTS`、`--no-activate`、`NO_TRANSPORT`、未知 / DDIC 类型拒绝、无头 agent 循环。
- 真实 SAP（HANA 4.0）端到端：pull 真实程序 + 类（5 include）、往返一致性、激活、transport 回退、经 `abap check` 的真实语法错误检测。

## [0.0.2] - 2026-08-02

### Added
- `abap pull` —— 下载源对象（Class / Interface / Program / Function Group）到 `src/`，全部类 include，abap-file-format 命名。
- `abap push` —— 完整 lock → write → activate → unlock 流，配 `--tr` / `--check-only` / `--all` / `--json`；逐文件独立结果；`finally` 保证锁释放。
- `abap check` —— 仅基于内容的语法检查（无 SAP 侧变更）。
- 统一输出助手（`output/json.ts`）：一致 `{ status, data|error }` JSON 契约 + 退出码。
- ADT 编排层（`sync/`）：对象解析、transport 解析、push 流程。
- `tmp/mock-adt/server.js` —— 供离线端到端验证的本地 mock ADT 服务器。

### Fixed
- 激活使用数组重载（`InactiveObject` 全字段）—— 字符串重载的 `?context=main` 在真实 SAP 上被拒。
- `abapsource:sourceUri` 在真实系统上可能相对对象 URL；现归一为绝对 `/sap/bc/adt/...` 路径。
- 对象类型后缀（`PROG/P`、`CLAS/OC`）为文件扩展名剥除。
- 激活前 push 跳过基于内容的检查（会在真实 SAP 上留下编辑会话）；`--check-only` 仍用基于内容的检查。
- 空源 part（如空 `locals_imp`）跳过基于内容的检查（abap-adt-api 拒绝空内容）。

### Verified
- 真实 SAP（HANA 4.0）端到端：pull 真实程序 + 类（5 include）、往返一致性、激活、transport 回退、经 `abap check` 的真实语法错误检测。

## [0.0.1] - 2026-07-31

### Added
- 三层架构（CLI / SAP / Agent）初始项目结构。
- commander.js CLI 框架（注册 10 个命令）。
- ADT 客户端包装（abap-adt-api）。
- 自建 DDIC 服务的 ICF 客户端。
- 文件格式处理（abap-source、ddic-json、file-resolver）。
- 项目配置管理（`.abap.json` + `.env`）。
- ABAP 源码（`abap/src/`）与 Agent 提示（`skills/`、`agents/`）占位目录。

### Fixed
真实 SAP 端到端测试 `abap select`（2026-08-08）对 vhcala4hci 暴露出两处 ICF handler ABAP 缺陷，均已修复并端到端验证（TC017–TC038 全 PASS）：
- **`execute_select` 行 / 字段序列化返回截断 JSON**（字符串模板 / `&&` 嵌套在 NetWeaver build 上失败）—— JSON 信封改用普通 `CONCATENATE` 构建；字段名经 `SPLIT` 拆分并迭代。
- **`DATA(lt_rows) = VALUE STANDARD TABLE OF REF TO data( ).` 抛 "Field VALUE is unknown"** —— 动态行类型改用显式类型工厂（`cl_abap_elemdescr=>get_c/get_n/get_d/get_p`）构建；SELECT 用 `SELECT *` 入全行类型，序列化时做投影过滤。
- 其他修复：`DD03L` 读改 `INTO CORRESPONDING FIELDS OF TABLE`、动态 ORDER BY 补全 `ASCENDING/DESCENDING` 关键字、OFFSET 仅在有 ORDER BY 时输出、`IcfClient` 暴露 ICF 错误信封码。

### Known limitations（vhcala4hci）
- **类主 include 激活需要 `?context=main`**：`AdtClientWrapper.activate` 故意省略 context，致类主在 push 后未激活。绕过：直接 `curl POST /sap/bc/adt/activation?method=activate&preauditRequested=false`，对象引用 `?context=…/source/main`。
- **无 `abap delete` 命令**：vhcala4hci 上类的 ADT DELETE 失败，因锁是会话本地（`IS_LOCAL>X</IS_LOCAL>`），跨 HTTP 请求不持久。
