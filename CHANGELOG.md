# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六类按版本分组。Breaking 变更同时在 `Removed` 与 `Migration` 列出。

## [Unreleased]

### Changed
- **Skill/agent 包收敛（三合二）** —— `abap-edit` + `abap-data` → `abap-object`（13 命令：对象全生命周期 + DDIC 子集 + `select` / `run` / `tcode` 只读消费）；`extension` 归 `abap-setup`（5 命令：接入 / 诊断 / 传输 / 基础设施）。顶层 skills 由 3 → 2，`agents/abap-developer.md` handoffs 由 3 → 2。
- **`scripts/` 统一为 `.mjs`** —— `select-table.sh` → `pages-select.mjs`；`diagnose.sh` / `resolve-transport.sh` / `deploy-if-outdated.sh` → `.mjs`。Node 18+ ESM，`node:child_process.spawn`，弃 `jq`，跨平台（macOS / Linux / Windows + WSL）一致。

### Removed
- **冗余 `.sh` 脚本** —— `abap-edit/scripts/validate-push.sh`（2 命令链 agent 一行拼出）/ `inspect-activation.sh`（按 SKILL.md 错误恢复表现写）。

## [0.2.0] - 2026-08-20

### Removed
- **`abap config`**（026）—— 删除；`show`/`set` 全部归 `abap init`（首次创建与后续修改走同一条路径）。**Breaking**——详见 Migration。

### Added
- **`abap init` 扩展能力**（026）—— `--show-config`（自省当前 workspace 绑定）/ `--unset-package / --unset-tr / --unset-source-dir`（清空顶层 key）/ `--source-dir <path>`（`push --all` / `check --all` 基目录）。
- **三种 JSON 输出模式**（025）—— 新增全局 `--pretty-json`（缩进 2）；`--json` 紧凑模式节省 LM agent ~5–20% token。
- **`stripEmpty()` 输出优化**（025）—— `--json` 自动剥除空 `{}` / `[]`，减少 envelope 体积。
- **`abap tcode`** —— 只读解析事务码到 ABAP 入口程序 / 屏幕（ICF，含 `S_TCODE` 权限检查）。错误码：`TCODE_NOT_FOUND`（8）/ `TCODE_NOT_AUTHORIZED`（5）。
- **`abap where-used`（别名 `references`）** —— 只读查询对象的直接引用，支持 CLAS / INTF / PROG / FUGR / TABL；`--limit` 默认 100、上限 500；截断时通过 `nextSteps` 提示。
- **`abap select`（016）** —— read-only 表查询 CLI（`SE16N` 等价）。三层注入防御（字段名白名单 + 值绑定变量 + 整数边界）。v1 支持 TABL + VIEW。
- **`abap run`（015）** —— 执行 ABAP classrun 或 PUBLIC STATIC 方法，闭环 push → run → verify。错误码：`METHOD_FAILED` / `CLASS_NOT_RUNNABLE` / `OBJECT_NOT_ACTIVE` / `WRAPPER_NOT_DEPLOYED` 等。
- **`abap pull --remote <system>`**（015）—— 从远端系统拉取对象的 active 版本（类型映射 PROG / INTF / CLAS）。`REMOTE_VERSION_NOT_FOUND` 归一为 `OBJECT_NOT_FOUND`。
- **`abap push` 按对象解析 transport；DDIC 经 ICF**（014）—— `pushOne` 复用对象自身请求（已绑 / `$TMP` 无需 `--tr`）；DDIC 文件走 ICF，`--check-only` 对 DDIC 拒绝。
- **`abap deploy` 缺包自动建 + per-part 激活** —— 首次部署不再 `Object ... does not exist`；结果新增 `objects` 数组报告每个对象的 create/update/unchanged/failed。
- **`abap check --atc --out [file]`** —— `--out` 把完整 `AtcWorkList` 落本地文件，stdout 仍输出映射后的 `CheckIssue[]`；非 `--atc` 时 `--out` 拒绝。
- **TABL/STRU 三件套 pull**（024）—— `abap pull <name> --type TABL|STRU` 写出官方三件套（`.tabl.json` + `.tabl.ddic` + `.tabl.settings.json`（TABL only））；失败时不落部分文件。ICF 服务 0.4.0 → 0.5.0。错误码：`TABL_DDL_INVALID` / `TABL_ARTIFACT_INCOMPLETE`。
- **HTTP service 拉取 / 推送 / 创建**（022）—— `<name>.http.json` 走自建 ICF `/http/<name>`，与 abap-file-format `zif_aff_http_v1` 双向兼容；namespace `Z`/`Y`/`/` 强制。
- **CLI 命令树重构**（021）—— 19 → 16 个顶层命令。新增 `abap init --agent <target>`（脚手架 `AGENTS.md` + skills/，支持 copilot/claude/cursor/generic，幂等，`--force` 覆盖）；`abap extension status`（探测 SAP 侧 ICF）；`abap check syntax|content|atc` 子命令化；`abap profile` 承接原 `connection`；`abap --help` 按 `scope: 'local' | 'sap'` 分组。
- **Skill/agent 自包含分发包**（019/020）—— 顶层 `skills/` `agents/` 自包含（SKILL.md + references/scripts/assets）+ 1 个 `abap-developer` 编排 agent；遵循 agentskills.io 标准；自动校验 frontmatter / 目录一致 / 命令覆盖 / 路径约束。
- **扩展机制**（023）—— `ValidationRule` / `LifecycleHook` / `CommandExtension` 三类扩展，从 `.abap.json` 加载；`extensions list` 命令；`ABAP_CLI_EXTENSIONS_STRICT=1` 切换严格模式。
- **SAP 端 JSON 生成统一**（017）—— 三个 ABAP 类约 74 处手工拼接统一为 `/ui2/cl_json=>serialize`；含 vhcala4hci 旧版 `"` / `\` 自动转义。ICF 0.2.0 → 0.4.0。
- **新 ErrorCode**（025）—— `DDIC_TABL_FORMAT_UNSUPPORTED`（canonical TABL 投影无法表示）/ `PULL_PARTIAL_FAILURE`（批量 pull 部分失败）。
- **npm 发布准备** —— `files` 加 `abap/src`；补 `repository` / `homepage` / `bugs` 元数据。

### Changed
- **`abap deploy` 默认 `$TMP`** —— 不再要求 `--package`；`--tr` 仅当 `--package` 非 `$TMP` 时必需。
- **`abap connection import` 默认跳过已存在 profile** —— `--overwrite` 才覆盖。
- **Lazy command 注册**（startup 加速）—— `index.ts` 改为 `COMMAND_SPECS` 表 + `registerLazyCommands`，仅在命令分发或 `--help` 时才 import 模块（含 keytar / abap-adt-api / clack 等重依赖）；用 `program.parseAsync()`。
- **Pull / push 编排迁入 `sync/`** —— `sync/pull-flow.ts` 与 `sync/push-flow.ts` 接管；打破 `formats/` ↔ `sync/` 包循环。
- **`abap config` 覆写遵循 `--yes`** —— 即便带 `--yes`，原先仍拒绝已存在的 `.abap.json`；现在允许。

### Fixed
- **`abap search --page-all` 单请求拿全量** —— 真 ADT quickSearch 无 offset；现单次 `maxResults = --limit × --page-all-max`（默认 1000）。同时修 `--exact`：`*` 在客户端剥除，裸名加宽为 `*NAME*`。
- **`abap push` 命名 include 不再落到 main** —— 推 `*.clas.macros.abap` 给无该 include 的对象时不再覆盖 main，否则 `SAP_ERROR`（exit 6）。
- **`abap pull FUGR` 含 `includeNumber`** —— 函数模块元数据补 `includeNumber`（schema 必填）。
- **Transport 写保护** —— `abap transport create` / `assign` 按写操作对待，遵循 `--yes` / `--dry-run`；非 TTY `VALIDATION_ERROR`（7）。
- **错误契约 CI 强制** —— 命令边界目录每个 `throw new <Error>` 必须构造 `CliError`，由 `test/unit/cli-error-boundary.test.ts` 强制。
- **`--json` stdout/stderr 严格分离** —— 失败路径不再泄漏纯文本帮助到 stdout；通过统一 `top-error.ts` 处理。

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

#### Skill bundle 重构 — `abap-edit` + `abap-data` → `abap-object`；`extension` 归 `abap-setup`
- **目的**：3 个 skill 按"对哪个对象做什么" + "环境是否就绪"重排为 2 个；agent 一次决策对应一个 skill，handoffs 由 3 → 2。
- **`abap-edit` + `abap-data` → `abap-object`**：合并 13 命令（`search` / `where-used` / `pull` / `push` / `check` / `create` / `activate` / `inspect` / `diff` / `status` / `create local` / `select` / `run` / `tcode`，含 DDIC）。`abap-data` 的只读消费（查表 / 跑类 / 查业务码）与 `abap-edit` 的对象生命周期是同一意图维度的两个面，按对象合一是顺。
- **`extension` 归 `abap-setup`**：`extension deploy` 是基础设施安装（部署 `/sap/zabap_vibe` ICF 服务），与 `init` / `doctor` / `profile` / `transport` 同脉络。
- **CLI 命令名不变**：搜索 / pull / push / select / run / tcode 等所有命令的接口与输出契约均未变化；仅 skill 文档归属调整。Agent 升级到 0.2.0 后应重新加载 skill 描述以命中 2 个 skill。

## [0.1.0] - 2026-08-05

### Added
- **统一 CLI 输出契约**（012）—— 每个 `--json` 信封含 `meta` 块（`command` / `version` / `timestamp` / `durationMs` / `warnings`）；错误带 `error.category` 1:1 映射退出码；由 `output-contract-audit.test.ts` 强制。
- **`abap search --schema` / `abap create --schema [type]`** —— agent 参数自描述：机器可读 schema 到 stdout，exit `0`，零 SAP 调用。
- **`abap create local <type> <name>`** —— 离线创建草稿骨架（abap-file-format 布局，零 SAP 联系）。

### Changed
- **错误码迁移（breaking 012）** —— `UNLOCK_WARNING` / `NOT_IMPLEMENTED` 移除；`OBJECT_EXISTS` / `FILE_EXISTS` / `COMMAND_MOVED` / `PUSH_FAILED` 规范化保留。`Warning:` / `console.warn` 全部进结构化 `meta.warnings`。
- **`abap pull` 改写官方 abap-file-format 布局** —— 每对象一目录（`src/<object>/`），含 `<name>.<type>.json` 元数据 + `<name>.<type>.abap` 源 part。
- **类本地 include 文件名变更**（breaking）—— `definitions` / `implementations` 替代旧名。
- **Pull 按类型组织** —— `formats/pull-strategy.ts` 提供 `PullStrategy` 扩展点；新增 FUGR 支持。
- **`abap pull --type FUGR`** —— 函数组按 abap-file-format 布局拉取；`abap push` 同步支持 FUGR 子对象（独立锁）。
- **`abap pull` PROG 元数据** —— 增 `generalInformation.programType`；带命名空间的对象名映射到 `#`-转义目录。
- **`abap init` 不再创建工作目录** —— 仅写 `.abap.json`；`src/` / `ddic/` 由 pull / create / sync 按需创建。
- **`abap system` 重命名为 `abap connection`**（breaking）—— 移除裸 `abap system` 交互菜单。
- **`abap connection add <name>`** —— name 存在时拒绝；`set <name>` 严格为「修改已存在 profile」，缺失时指向 `add`。
- **裸 `abap` / 裸 `abap connection`** —— 打印帮助到 stdout 并 exit `0`；缺必填参数 → 先 stdout 打子命令帮助再 stderr 打结构化 `USAGE`（exit `2`）。
- **文档同步** —— `docs/commands.md` 覆盖全部选项 / 子命令；README、getting-started、architecture、development 更新。

### Fixed
- **`abap inspect` 命令** —— import 但从未注册，命令静默不存在；现已注册并按文档运行。
- **`abap init` 持久化密码** —— 交互模式 / 已存在 profile 时，回退键入的密码持久化到 keychain。
- **`abap push` 失败信封** —— 不再手工拼装；通过统一渲染器抛结构化 `CliError`。
- **未映射异常不再伪装 `SAP_ERROR`** —— 归 `UNKNOWN`（exit 1）。
- **`abap push` 解锁失败** —— 文件记为成功，问题以 `UNLOCK_WARNING` 进 `meta.warnings`，exit 仍 `0`。

### Removed
- `ErrorCode UNLOCK_WARNING` —— 不再是错误码；告警进 `meta.warnings`，exit 0。
- `ErrorCode NOT_IMPLEMENTED` —— 死代码。
- **`abap atc`** —— 移除（→ `abap check atc <f> --variant Z_VAR`）。
- **`abap auth test`** —— 合并入 `abap connection test <name>`。

### Migration
| 旧 | 新 | 说明 |
|---|---|---|
| 无形状异常 → `SAP_ERROR`（exit 6） | → `UNKNOWN`（exit 1） | 无法归类的异常不再伪装 SAP 错误 |
| `OBJECT_EXISTS` / `FILE_EXISTS` / `COMMAND_MOVED` / `PUSH_FAILED` | 保留，规范化 | 类别与退出码不变 |

## [0.0.6] - 2026-08-04

### Added
- **`abap doctor`** —— 一键环境诊断（environment / config / connection 三节），`--fix` 仅应用安全可逆修复。
- **`abap connection test <name>`** —— 分层连接诊断（tls → auth → adt → icf），退出码反映最差失败层。
- **`abap inspect <object>`** —— 只读对象元数据探测（`--structure` / `--includes` / `--locks` / `--package`），永不取锁。
- **`abap diff [file]`** —— 本地 ↔ SAP 只读对比，按 part `direction` + 行变更 `summary`。
- **`abap sync`** —— 链式 status / pull / push（默认 `--status`，`--pull` / `--push`），分歧 part 永不静默覆盖。
- **`abap report-stuck`** —— 本地反馈回路记录（`--goal` / `--tried` / `--where`）；全局 `--report-stuck` flag + `ABAP_REPORT_STUCK=1` 自动触发；凭证永不记录。

### Fixed
- **真 ADT quickSearch 需要 `*` 通配** —— `resolveObject` 在精确名搜索零命中时重试 `*NAME*`。

### Verified
- 112 单元测试跨 24 文件（38 新增）；`npm run verify` 绿。
- Mock 端到端：六个命令离线验证。
- 真实 SAP（vhcala4hci）：`connection test` tls / auth / adt ok（icf 404 —— ICF 未部署，预期）；其余命令 ok。

## [0.0.5] - 2026-08-03

### Added
- **`abap search <query>`** —— 经 ADT 仓库搜索 API 按名搜索 ABAP 对象；`--type` 过滤、`--max` 上限（默认 100）；空结果为成功。

### Verified
- Mock 端到端：基本搜索、前缀、空结果、`--type` 归一、`--max` 截断、默认上限、空查询 `USAGE`、`--max abc` `INVALID_ARGUMENT`、无头 `--json` agent 循环（search → pull）。

## [0.0.4] - 2026-08-02

### Added
- **`abap transport list [--open]`** —— 列出当前用户的 transport 请求（workbench + customizing）；`--open` 仅留未释放。
- **`abap transport create <description> [--package <package>]`** —— 创建新 transport（默认 `$TMP`），闭合「无请求 → 创建 → `--tr`」闭环。
- **`--json` 输出 / 错误码统一** —— 与 pull / push / check / create 一致。

### Verified
- Mock 端到端：list / create / 闭环（list → create → push `--tr`）/ `NO_TRANSPORT` / 无头 `--json` agent 循环。
- 真实 SAP（vhcala4hci）：dogfooding 循环（transport create → pull → edit → push `--tr`）。

## [0.0.3] - 2026-08-02

### Added
- **`abap create <type> <name>`** —— 经 ADT REST API 在 SAP 中创建新源对象（CLAS / INTF / PROG / FUGR）；默认源骨架（class 写 DEFINITION + IMPLEMENTATION），create → pull → edit → push 循环可走通。
- **`--no-activate`** —— 仅创建并写骨架，不激活。
- **Transport 解析** —— 复用 `--tr` > `.abap.json` > 用户开放请求 > `NO_TRANSPORT` 顺序；对象名归一化 + 类型映射（CLAS / OC、INTF / OI、PROG / P、FUGR / F）。
- **DDIC 类型拒绝** —— `DDIC_NOT_SUPPORTED`（ICF 服务，后续阶段）；未知类型以支持的列表拒绝。

### Verified
- Mock 端到端：create → pull 往返、edit → push 迭代、重复 create → `OBJECT_EXISTS`、`--no-activate`、`NO_TRANSPORT`、未知 / DDIC 类型拒绝、无头 agent 循环。
- 真实 SAP：pull 真实程序 + 类（5 include）、往返一致性、激活、transport 回退、`abap check` 真实语法错误检测。

## [0.0.2] - 2026-08-02

### Added
- **`abap pull`** —— 下载源对象（CLAS / INTF / PROG / FUGR）到 `src/`，全部类 include；abap-file-format 命名。
- **`abap push`** —— 完整 lock → write → activate → unlock 流；`--tr` / `--check-only` / `--all` / `--json`；逐文件独立结果；`finally` 保证锁释放。
- **`abap check`** —— 仅基于内容的语法检查（无 SAP 侧变更）。
- **统一输出助手** —— `output/json.ts` 一致 `{ status, data|error }` JSON 契约 + 退出码。
- **ADT 编排层 `sync/`** —— 对象解析、transport 解析、push 流程。

### Fixed
- **激活重载** —— 改用 `InactiveObject` 数组重载（字符串重载的 `?context=main` 在真实 SAP 上被拒）。
- **`abapsource:sourceUri` 归一** —— 相对路径归一为绝对 `/sap/bc/adt/...`。
- **对象类型后缀剥除** —— `PROG/P`、`CLAS/OC` 等不再作为文件扩展名。
- **激活前 push 跳过基于内容检查** —— 避免在真实 SAP 上留下编辑会话；`--check-only` 仍用内容检查。
- **空源 part** —— 空 `locals_imp` 等跳过内容检查（abap-adt-api 拒绝空内容）。

### Verified
- 真实 SAP（vhcala4hci）端到端：pull 真实程序 + 类（5 include）、往返一致性、激活、transport 回退、`abap check` 真实语法错误检测。

## [0.0.1] - 2026-07-31

### Added
- **三层架构**（CLI / SAP / Agent）初始结构。
- **commander.js CLI 框架** —— 注册 10 个命令。
- **ADT 客户端包装** —— 基于 `abap-adt-api`。
- **自建 ICF 客户端** —— DDIC 服务。
- **文件格式处理** —— `abap-source` / `ddic-json` / `file-resolver`。
- **配置管理** —— `.abap.json` + `.env`。
- **ABAP 源码与 agent 提示占位** —— `abap/src/`、`skills/`、`agents/`。

### Fixed
真 SAP `abap select`（vhcala4hci）端到端测试 TC017–TC038 暴露两处 ICF handler ABAP 缺陷，已修复并验证（**注意**：此条在 0.0.1 公开后追加）：
- **`execute_select` 行 / 字段序列化返回截断 JSON** —— 字符串模板 / `&&` 嵌套在 NetWeaver build 上失败，改用普通 `CONCATENATE` 构建；字段名经 `SPLIT` 拆分并迭代。
- **`DATA(lt_rows) = VALUE STANDARD TABLE OF REF TO data( ).` 抛 "Field VALUE is unknown"** —— 动态行类型改用显式类型工厂（`cl_abap_elemdescr=>get_c/get_n/get_d/get_p`）。
- 其他：`DD03L` 改 `INTO CORRESPONDING FIELDS OF TABLE`、动态 ORDER BY 补全 `ASCENDING/DESCENDING` 关键字、OFFSET 仅在有 ORDER BY 时输出、`IcfClient` 暴露 ICF 错误信封码。

### Known limitations（vhcala4hci）
- **类主 include 激活需 `?context=main`** —— `AdtClientWrapper.activate` 故意省略 context，致类主在 push 后未激活。绕过：`curl POST /sap/bc/adt/activation?method=activate&preauditRequested=false`，对象引用 `?context=…/source/main`。
- **无 `abap delete` 命令** —— 类 ADT DELETE 失败，因锁是会话本地（`IS_LOCAL>X</IS_LOCAL>`），跨 HTTP 请求不持久。
