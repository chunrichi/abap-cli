# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六类按版本分组。Breaking 变更同时在 `Removed` 与 `Migration` 列出。

## [Unreleased]

### Added
- **扩展机制补全（为内部/下游发行版铺路）** —— 让 `deploy` / `report-stuck` / command-policy 这类内部功能可以完全以扩展形式实现，无需修改核心：
  - `beforeCommand` 钩子支持**否决**：返回 `{block: true, reason}` 即中止命令，报 `EXTENSION_COMMAND_BLOCKED`（`VALIDATION_ERROR` / exit 7）。这是实现"按工作区禁用命令"的通道。
  - `beforeParse` 钩子现在**真正被触发**（此前注册后静默不执行）。
  - 扩展 manifest 接受 `{sourceType:"npm", packageName}`（loader 早已支持，此前被 registry 拒掉），扩展可用私有 npm 包分发。
- **`abap pull --tr <transport>`** —— 一次拉取整个 transport 请求里的对象（含嵌套子任务，按类型去重）。`--json` 返回 `transport` / `requested` / `pulled` / `failed` / `deduplicated` / `entries` / `written` / `skipped`，便于 agent 判断进度。与 `<object>` / `--package` 互斥。
- **`abap create --yes` / `abap push --yes`** —— 写操作在非交互环境（CI / agent 循环）的显式确认。缺 `--yes` 时返回 `VALIDATION_ERROR`（exit 7），错误里附 `nextSteps` + 命令示例，照抄即可。`push` 同时支持 `--dry-run` 跳过 ADT 写入。
- **`abap transport show` 嵌套任务展开** —— `--json` 新增 `tasks[]` 与 `deduplicated` 字段，告知 transport 引用了多少对象（去重后）。方便 agent 判断真实工作量。

### Fixed
- **`CommandExtension` 此前完全不生效** —— 注册的扩展命令只被存进 `program.lazyExtensions`，而没有任何消费方，调用时一律报 unknown command（exit 2）。现改为直接注册为 commander 子命令。

### Changed
- **扩展命令不再允许覆盖内置命令** —— 与内置同名的 `CommandExtension` 在加载期即判定 `failed`（此前记为 `loaded` 但实际不可用）。内置命令始终优先。
- **Skill 包收敛**：随包 skill 由 3 个合为 2 个。`abap-object` 承担对象全生命周期（含 DDIC + `select` / `run` / `tcode`），`abap-setup` 承担接入与基础设施（含 `extension`）。**CLI 命令与输出契约不变**——仅 skill 文档重新归属。Agent 升级后应重新加载 skill 描述以命中合并后的 skill。
- **辅助脚本统一为 Node ESM**：以前随包发的 `.sh` 脚本改写为 `.mjs`，跨平台（macOS / Linux / Windows + WSL）行为一致，不再依赖 `jq`。
- **CLI 顶层 + 子命令 `description` 收紧** —— 对齐上游分支「动词 + 对象 + 关键安全提示」风格：移除 `push` 的步骤流程、`init` 的 flag 枚举、`check` 的子命令全列等内部实现细节；保留写操作的 `--yes` / `--dry-run` 必要提示；保留只读标注以便 agent 区分。`COMMAND_SPECS`（root `--help` 的 stub）与各 `commands/*.ts`（`<cmd> --help` 的真实注册）已双向同步。`--help` 输出体积减小，agent 通过 `description` 也能更快定位命令用途。无输出契约/行为变更。
- **`abap push` 描述完全对齐上游** —— 移除顶层 `(write — requires --yes / ...)` 注释、`commonErrorsAfter()` 帮助文本、option 末尾的 `(FR-012)` / `(mutex with --no-activate)` 内部代号；`--tr` 描述回到「用途」而非「使用条件」（避免误导：实际仅 unbound object 才需 `--tr`）。写操作的非交互安全提示已由 `VALIDATION_ERROR.nextSteps` + 命令示例承担，agent 误调时仍能拿到可粘贴修复命令。- **全部命令的 `argument` / `option` 描述对齐上游** —— `create` 的 `--no-activate/--check-only/--yes` 简化；`pull` 的 `--overwrite/--skip-existing` 去掉赘词；`run` 的 `[class-name]/--timeout` 缩写；`select` 的 `--table/--fields/--limit/--dry-run` 简化；`transport` 的 `--yes` 统一；`inspect` 的 `--locks/--activation` 去冗余 `(read-only)`；`doctor/extension deploy/where-used/status/diff/activate` 等同向收敛。`init` 保留主线独有的 `--source-dir/--show-config/--unset-*`（0.2.0 init 自省/修改能力），不回退。
### Removed
- 冗余辅助脚本（按 SKILL.md 直接两命令链拼出即可）。

## [0.2.0] - 2026-08-20

### Removed
- **`abap config` 命令整体移除** —— `show` / `set` 全部归入 `abap init`，首次创建与后续修改走同一条路径。**Breaking**：详见 Migration。

### Added
- **`abap init` 多了几个常用自省 / 修改动作**
  - `--show-config` 查看当前 workspace 绑定的 profile / package / transport / 源目录
  - `--unset-package` / `--unset-tr` / `--unset-source-dir` 清空指定字段
  - `--source-dir <path>` 改 `push --all` / `check --all` 的基目录
- **三种 JSON 输出模式** —— 新增全局 `--pretty-json`（缩进 2，方便人看），保留 `--json`（紧凑模式，给 LM agent 用，体积节省约 5–20% token）。`--json` 自动剥除空 `{}` / `[]`，信封更瘦。
- **`abap tcode <code>`** —— 只读解析事务码 → ABAP 入口程序 + 屏幕（含 `S_TCODE` 权限检查）。错误码：`TCODE_NOT_FOUND`（8）/ `TCODE_NOT_AUTHORIZED`（5）。
- **`abap where-used <object>`（别名 `references`）** —— 只读查对象的直接引用（CLAS / INTF / PROG / FUGR / TABL）。`--limit` 默认 100、上限 500；截断时通过 `nextSteps` 提示重查。
- **`abap select --table <name>`** —— SE16N 等价的只读查表。`--fields` / `--where` / `--limit` / `--order-by` / `--count-only` / `--schema`；注入防御三层（字段名白名单 + 值绑定变量 + 整数边界）；v1 支持 TABL + VIEW。
- **`abap run <class>`** —— 执行 ABAP classrun 或 PUBLIC STATIC 方法，闭环 `push → run → verify`。错误码：`METHOD_FAILED` / `CLASS_NOT_RUNNABLE` / `OBJECT_NOT_ACTIVE` / `WRAPPER_NOT_DEPLOYED` 等。
- **`abap pull --remote <system>`** —— 从远端系统拉取对象的 active 版本（PROG / INTF / CLAS）。`REMOTE_VERSION_NOT_FOUND` 已归一为 `OBJECT_NOT_FOUND`。
- **`abap push` 按对象解析 transport；DDIC 经 ICF** —— 对象自身已绑 transport 或 `$TMP` 时无需 `--tr`；DDIC 文件走 ICF，`--check-only` 对 DDIC 拒绝。
- **`abap extension deploy` 缺包自动建 + per-part 激活** —— 首次部署不再 `Object ... does not exist`；结果新增 `objects` 数组报告每个对象的 create / update / unchanged / failed。
- **`abap check atc --out [file]`** —— `--out` 把完整 ATC worklist 落本地文件，stdout 仍输出映射后的 `CheckIssue[]`；非 `--atc` 时 `--out` 拒绝。
- **`abap pull <name> --type TABL|STRU`** —— 拉取 TABL / STRU 给出官方三件套文件（描述符 + DDL + settings）；失败时不落部分文件。错误码：`TABL_DDL_INVALID` / `TABL_ARTIFACT_INCOMPLETE`。
- **HTTP service 拉取 / 推送 / 创建** —— `<name>.http.json` 走自建 ICF `/http/<name>`；namespace `Z`/`Y`/`/` 强制。
- **`abap init --agent <target>`** —— 给工作区脚手架 AI agent 上下文（`AGENTS.md` + `skills/`），支持 copilot / claude / cursor / generic，幂等，`--force` 覆盖。
- **技能 / 模板自包含分发包** —— 顶层 `skills/` 与 `agents/` 跟着 npm 包发布，自带 SKILL.md / references / scripts / assets，符合 agentskills.io 标准。
- **扩展机制** —— 从 `.abap.json` 加载三类扩展（验证规则 / 生命周期钩子 / 自定义命令）；`extensions list` 查看；`ABAP_CLI_EXTENSIONS_STRICT=1` 切换严格模式。
- **新错误码** —— `DDIC_TABL_FORMAT_UNSUPPORTED`（canonical TABL 投影无法表示）/ `PULL_PARTIAL_FAILURE`（批量 pull 部分失败）。

### Changed
- **`abap extension deploy` 默认 `$TMP`** —— 不再强制 `--package`；`--tr` 仅当 `--package` 非 `$TMP` 时必需。
- **`abap profile import` 默认跳过已存在 profile** —— `--overwrite` 才覆盖，避免误覆盖。
- **CLI 启动加速** —— 顶层命令延迟加载（仅在分发或 `--help` 时才 import 重依赖：keytar / abap-adt-api / clack）；`abap --help` 瞬间出来。

### Fixed
- **`abap search --page-all` 单请求拿全量** —— 真 ADT quickSearch 不支持 offset；现一次请求拿完（`maxResults = --limit × --page-all-max`，默认 1000）。同时修 `--exact`：`*` 在客户端剥除，裸名加宽为 `*NAME*`。
- **`abap push` 命名 include 不再落到 main** —— 推 `*.clas.macros.abap` 给无该 include 的对象时不再覆盖 main，否则 `SAP_ERROR`（exit 6）。
- **`abap pull FUGR` 含 `includeNumber`** —— 函数模块元数据补 `includeNumber`（schema 必填，避免下游误读）。
- **`abap transport create` / `assign` 非 TTY 写保护** —— 缺 `--yes` 返回 `VALIDATION_ERROR`（exit 7）。
- **`--json` stdout/stderr 严格分离** —— 失败路径不再泄漏纯文本帮助到 stdout。

### Migration

#### `abap config` 移除
| 旧命令 | 新命令 |
|---|---|
| `abap config show` | `abap init --show-config` |
| `abap config set --profile X` | `abap init --profile X --yes` |
| `abap config set --package Z` | `abap init --package Z --yes` |
| `abap config set --tr DEVK9` | `abap init --tr DEVK9 --yes` |
| `abap config set --source-dir P` | `abap init --source-dir P --yes` |
| （无对应能力） | `abap init --unset-package / --unset-tr / --unset-source-dir --yes` |

非交互环境写操作：所有 `abap init` 修改类调用都需 `--yes`（与既有 `init` 行为一致）。

#### CLI 命令树重构（19 → 16 个顶层命令）
| 旧命令 | 新命令 |
|---|---|
| `abap connection add/list/show/set/test/delete/export/import` | `abap profile …`（同名子命令） |
| `abap connection use <name>` | `abap init --profile <name> --yes` |
| `abap deploy` | `abap extension deploy`（flags 不变） |
| `abap check --syntax/--content/--atc <f>` | `abap check syntax/content/atc <f>`（裸 `abap check <f>` 走 `--files` 快捷方式） |
| `abap atc` | 移除（→ `abap check atc <f> --variant Z_VAR`） |
| `abap sync` | 移除（agent 显式编排 `status` → `pull` → `push`） |
| `abap report-stuck` + 全局 `--report-stuck` + `ABAP_REPORT_STUCK` | 全部移除（结构化 JSON 错误已覆盖反馈价值） |

旧命令名不再可用，按未知命令处理。**零数据迁移** —— profile 存储（`~/.abap-cli/systems.json`、keychain、`.abap.json`）格式未变。

#### `abap select` 行值为原生类型
- `data.rows` 单元格按 SAP 端 JSON 序列化器原生输出：NUMC / INT / DEC → `number`，DATS → `YYYY-MM-DD`，TIMS → `HH:MM:SS`。
- 迁移：`--json` 消费者将 cell 视为 `string | number | boolean | null`。

#### `abap profile delete <name>` 非交互环境需要 `--yes`
脚本 / CI（无 TTY）原先无条件删 profile + keychain 密码；现以 `VALIDATION_ERROR`（exit 7）拒绝。

#### Skill bundle 重构 — `abap-edit` + `abap-data` → `abap-object`；`extension` 归 `abap-setup`
- **CLI 命令名不变**：搜索 / pull / push / select / run / tcode 等所有命令的接口与输出契约均未变化；仅 skill 文档归属调整。
- **Agent 升级后**：应重新加载 skill 描述以命中合并后的 2 个 skill（`abap-object` + `abap-setup`），旧 skill 名称不再触发。

## [0.1.0] - 2026-08-05

### Added
- **统一 CLI 输出契约** —— 每个 `--json` 信封含 `meta` 块（`command` / `version` / `timestamp` / `durationMs` / `warnings`），错误带 `error.category` 与退出码 1:1 对应。Agent 可以靠 meta 区分"成功带警告"与"硬失败"。
- **`abap search --schema` / `abap create --schema [type]`** —— 机器可读 schema 到 stdout，exit `0`，零 SAP 调用。Agent 拿 schema 自描述来构造参数。
- **`abap create local <type> <name>`** —— 离线创建草稿骨架（不连 SAP），方便没 SAP 环境时先写文件。

### Changed
- **错误码迁移（breaking）** —— `UNLOCK_WARNING` / `NOT_IMPLEMENTED` 移除；`OBJECT_EXISTS` / `FILE_EXISTS` / `COMMAND_MOVED` / `PUSH_FAILED` 规范化保留。`Warning:` / `console.warn` 全部进结构化 `meta.warnings`。
- **`abap pull` 改写官方 abap-file-format 布局** —— 每对象一个目录（`src/<object>/`），含 `<name>.<type>.json` 元数据 + `<name>.<type>.abap` 源 part。**Breaking**：类本地 include 文件名变了 —— `definitions` / `implementations` 替代旧名。迁移：旧本地对象目录需要重新 `pull` 一次。
- **`abap pull --type FUGR`** —— 函数组按官方布局拉取；`abap push` 同步支持 FUGR 子对象（独立锁）。
- **`abap pull` PROG 元数据** —— 增 `generalInformation.programType`；带命名空间的对象名映射到 `#`-转义目录。
- **`abap init` 不再创建工作目录** —— 仅写 `.abap.json`；`src/` / `ddic/` 由 pull / create / sync 按需创建。
- **`abap system` 重命名为 `abap connection`**（breaking）—— 移除裸 `abap system` 交互菜单。
- **`abap connection add <name>`** —— name 存在时拒绝；`set <name>` 严格为「修改已存在 profile」，缺失时指向 `add`。
- **裸 `abap` / 裸 `abap connection`** —— 打印帮助到 stdout 并 exit `0`；缺必填参数 → 先 stdout 打子命令帮助再 stderr 打结构化 `USAGE`（exit `2`）。

### Fixed
- **`abap inspect` 命令** —— 之前 import 但从未注册（命令静默不存在）；现已注册并按文档运行。
- **`abap init` 持久化密码** —— 交互模式 / 已存在 profile 时，回退键入的密码持久化到 keychain。
- **`abap push` 解锁失败** —— 文件仍记为成功，问题以 warning 进 `meta.warnings`，exit 仍 `0`，不再让 unlock 卡住整个 push 结果。
- **未映射异常不再伪装 `SAP_ERROR`** —— 归 `UNKNOWN`（exit 1）。

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
- **`abap connection test <name>`** —— 分层连接诊断（tls → auth → adt → icf），退出码反映最差失败层，方便脚本判断卡在哪一步。
- **`abap inspect <object>`** —— 只读对象元数据探测（`--structure` / `--includes` / `--locks` / `--package`），永不取锁。
- **`abap diff [file]`** —— 本地 vs SAP 只读对比，按 part `direction` + 行变更 `summary`。
- **`abap sync`** —— 链式 `status` / `pull` / `push`（默认 `--status`）；分歧 part 永不静默覆盖。

### Fixed
- 真 ADT quickSearch 需要 `*` 通配 —— 精确名搜索零命中时自动重试 `*NAME*`。

### Verified
- 112 单元测试跨 24 文件（38 新增）。
- 真实 SAP（vhcala4hci）：`connection test` tls / auth / adt ok；其余命令 ok。

## [0.0.5] - 2026-08-03

### Added
- **`abap search <query>`** —— 按名搜 ABAP 对象；`--type` 过滤、`--max` 上限（默认 100）；空结果为成功而非报错。

### Verified
- Mock 端到端：基本搜索、前缀、空结果、`--type` 归一、`--max` 截断、无头 `--json` agent 循环（search → pull）。

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
- **`abap create <type> <name>`** —— 在 SAP 中创建新源对象（CLAS / INTF / PROG / FUGR）；默认源骨架（class 写 DEFINITION + IMPLEMENTATION），`create → pull → edit → push` 循环可走通。
- **`--no-activate`** —— 仅创建并写骨架，不激活。
- **Transport 解析** —— 复用 `--tr` > `.abap.json` > 用户开放请求 > `NO_TRANSPORT` 顺序；对象名归一化 + 类型映射（CLAS / OC、INTF / OI、PROG / P、FUGR / F）。
- **DDIC 类型拒绝** —— `DDIC_NOT_SUPPORTED`（ICF 服务，后续阶段）；未知类型以支持的列表拒绝。

### Verified
- Mock 端到端：create → pull 往返、edit → push 迭代、重复 create → `OBJECT_EXISTS`、`--no-activate`、`NO_TRANSPORT`、未知 / DDIC 类型拒绝、无头 agent 循环。
- 真实 SAP：pull 真实程序 + 类（5 include）、往返一致性、激活、transport 回退、`abap check` 真实语法错误检测。

## [0.0.2] - 2026-08-02

### Added
- **`abap pull`** —— 下载源对象（CLAS / INTF / PROG / FUGR）到 `src/`，全部类 include；abap-file-format 命名。
- **`abap push`** —— 完整 `lock → write → activate → unlock` 流；`--tr` / `--check-only` / `--all` / `--json`；逐文件独立结果。
- **`abap check`** —— 仅基于内容的语法检查（无 SAP 侧变更）。
- **统一输出契约** —— `{ status, data | error }` JSON + 退出码，所有命令遵循。

### Fixed
- **激活重载** —— 改用 `InactiveObject` 数组重载（字符串重载的 `?context=main` 在真实 SAP 上被拒）。
- **`abapsource:sourceUri` 归一** —— 相对路径归一为绝对 `/sap/bc/adt/...`。
- **对象类型后缀剥除** —— `PROG/P`、`CLAS/OC` 等不再作为文件扩展名。
- **激活前 push 跳过基于内容检查** —— 避免在真实 SAP 上留下编辑会话；`--check-only` 仍用内容检查。
- **空源 part** —— 空 `locals_imp` 等跳过内容检查（abap-adt-api 拒绝空内容）。

### Verified
- 真实 SAP（vhcala4hci）端到端：pull 真实程序 + 类（5 include）、往返一致性、激活、transport 回退、`abap check` 真实语法错误检测。

## [0.0.1] - 2026-07-31

> **注**：0.0.1 首发只覆盖了 `pull` / `push` / `check` 等最小闭环（见 0.0.2 / 0.0.3）。下方的功能列表是后续版本陆续补齐后整理而成的"当前全量清单"，方便 0.0.1 用户看清项目最终能做什么。

### Added
- **CLI 工具**：`abap-cli`（Node.js + TypeScript），通过 SAP ADT REST API 工作。
- **源对象全周期**（CLAS / INTF / PROG / FUGR）：`pull` 下载本地、`push` 回写（含 lock → write → activate → unlock 全流程）、`check` 语法验证、`create` 在 SAP 起新对象。
- **DDIC 对象**（DOMA / DTEL / TABL / STRU）：通过自建 ICF 服务（`/sap/zabap_vibe/ddic/*`）读写。
- **HTTP service 对象**：通过 `/sap/zabap_vibe/http/<name>` 读写。
- **transport 闭环**：`abap transport list` / `create` / `show` / `resolve` / `assign` —— 无需 SAP GUI 也能找到 / 创建 / 分配 transport。
- **只读查询**：`abap select`（SE16N 等价查表）/ `abap run`（跑 classrun 或 PUBLIC STATIC 方法）/ `abap where-used`（引用查询）/ `abap tcode`（事务码 → 入口程序）。
- **诊断 & 状态**：`abap doctor` / `abap inspect` / `abap diff` / `abap status` / `abap activate`。
- **配置 & profile**：`abap init`（首配置 + 后续修改一条路径）、`abap profile`（全局连接 profile 管理，存储于 `~/.abap-cli/systems.json` + keychain）。
- **`--json` / `--pretty-json` 输出**：所有命令遵循统一契约 `{ status, data | error }`，含 `meta` 块（`command` / `version` / `timestamp` / `durationMs` / `warnings`），错误带 `error.category` 与退出码 1:1 对应。
- **AI agent 集成**：随 npm 包发布 `skills/` + `agents/` 自包含分发包（SKILL.md + references/scripts/assets，符合 agentskills.io 标准）。
- **扩展机制**：从 `.abap.json` 加载 `ValidationRule` / `LifecycleHook` / `CommandExtension`。

### Known limitations
- **类主 include 激活需 `?context=main`** —— 部分 NetWeaver 版本上 push 后类主未激活；当前绕过：手工 `curl POST /sap/bc/adt/activation?method=activate&preauditRequested=false` 并附 `?context=…/source/main`。
- **无 `abap delete` 命令** —— ADT DELETE 在跨 HTTP 请求间锁不持久（会话本地 `IS_LOCAL>X</IS_LOCAL>`），目前稳定方案未确定。
