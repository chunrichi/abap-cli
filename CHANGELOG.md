# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组；breaking 变更在 `Removed` 标记并附 **Migration**。
条目面向 CLI 用户：写「用户能做什么 / 行为如何变化 / 升级要注意什么」，不写内部实现（类名、ABAP 函数、文件路径、错误码枚举）；同一功能的细节合并成一条。

## [Unreleased]

## [1.2.0] - 2026-11-01

本版把「改完能验、能交付、能追溯」补进 agent 闭环，并统一机器可读契约：修复一批"看着成功、实际没生效/没执行"的假成功路径，新增传输预检与释放、版本历史与结构符号读取、`doctor --strict`。有破坏性变更（退出码与 `--json` 形状），见 Migration。

### Added

- **传输预检与释放**：`abap transport check <对象>` 只读报告该变更会记录到哪个请求、是否被阻塞及阻塞消息；`abap transport release <请求>` 释放请求并输出逐对象结果，支持 `--ignore-locks` / `--ignore-atc` / `--dry-run`，非交互环境需 `--yes`。
- **版本历史与结构符号**：`abap inspect <对象> --versions` 列出 ADT 版本历史（`--show <版本>` 取该版源码，`--out` 落盘）；`abap inspect <对象> --symbols` 把类/接口结构摊平成带源码行号的符号表，可用 `--kinds` / `--name-pattern` 过滤。两者都有各自的 `--schema`。
- **`abap doctor --strict`**：配置或环境有问题时以非零退出码结束，可作为 agent/CI 的前置 gate；`doctor` 同时新增 `data.ok`，`--fix` 会输出已修复项与剩余问题。

### Changed

- **`--json` 失败路径统一**：缺参或裸调用一律以用法错误（exit 2）结束，stdout 为空、stderr 只有一个可解析的 JSON 信封；人类 help 只保留在 `--help` / `abap help`（exit 0）。
- **配置错误可直接恢复**：配置错误带上缺失字段、可执行的下一步与示例，agent 不再需要从散文里猜命令。
- **`doctor` 不再"假绿"**：配置全错时 `data.ok=false`；加 `--strict` 后退出码反映问题。
- **`validate:aff` 纳入统一契约**：缺参/路径不存在为用法错误（exit 2），校验失败为校验错误（exit 7）；输出走统一信封、紧凑 JSON，文件路径为 cwd 相对 POSIX。
- **push 的激活校验区分"没有变更"与"静默失败"**：SAP 返回 200 但没执行激活时，先确认是否真的还有未激活版本——有则失败；没有（重复推送未改动的源码）则成功并给出告警。
- **SAP 错误更可诊断**：失败详情包含 SAP 异常类型与属性，并对常见错误给出恢复建议。
- **AFF 伴生文件要求放宽**：类的 include 与表技术设置改为可选，合法对象不再被 `validate:aff` 误判为失败。
- **本地命令标注修正**：`validate:aff`、`report-stuck`、`session` 不再被列为"会连接 SAP"。

### Fixed

- `--json` 下裸调用/缺参输出人类 help 且 exit 0，agent 会误判成功。
- 把对象元数据 `.json` 当 ABAP 源码 push 会写脏 SAP 且可能报成功；现在直接拒绝并提示源文件。
- `doctor` 在配置全错时仍报成功；`validate:aff` 缺文件/无参数仍报成功。
- `transport` / `session` 裸调用时 stdout 与 stderr 双写 help。
- `push` 在 SAP 静默跳过激活时报告成功。
- `inspect --versions` 在类 include 上拿不到版本号；`inspect --symbols` 的成员类型映射不全。

### Removed (breaking)

- **`--json` 下缺参/裸调用的退出码**：`abap pull`、`run`、`check`、`profile`、`tcode`、`mime` 原先 exit 0 且 stdout 是 help；现在 exit 2、stdout 为空、stderr 单个 JSON 信封。
- **`validate:aff` 退出码与 JSON 形状**：校验失败从 exit 1 改为 7，缺参/路径不存在从 exit 0 改为 2；`--json` 从 `{status, summary, files}` 改为统一信封 `{status, meta, data:{summary, files}}`，`files[].path` 由绝对路径改为 cwd 相对路径。
- **profile 名称规则**：名称需 1–64 字符、字母/数字/`_`/`.`/`-` 且以字母或数字开头；旧名仍可读取/连接/删除，但不能 `set` 或导出后重新导入。

**Migration**：

- 脚本依赖"裸调用 exit 0 + help"的，改为传必填参数；需要 help 时用 `--help` 或 `abap help <命令>`。
- 消费 `validate:aff --json` 的脚本：改读 `data.files[]`，按 exit 7（校验失败）/ 2（用法错误）分支。
- 以 `abap doctor` 退出码做 gate 的脚本：改用 `abap doctor --strict`（默认仍 exit 0，保持诊断语义）。
- 旧 profile 名含空格/斜杠等字符时：`abap profile delete <名>` 后以合法名称重新 `abap profile add`；工作区用 `abap init --profile <新名>` 重新绑定。
- 本次内置 ICF 服务版本随 CLI 升到 1.2.0（无端点功能变化）；升级后执行一次 `abap deploy --yes`，让 `deploy status` 恢复匹配。

## [1.1.0] - 2026-10-31

新增 4 类对象（DEVC / VIEW / SHLP / XSLT）、事务码写路径与长文本支持，并修复真实 SAP 上的会话、DDIC、HTTP pull 问题。升级后执行一次 `abap deploy --yes` 刷新内置 ICF 服务。含 breaking 变更，见 Migration。

### Added

- **数据库视图（VIEW）与搜索帮助（SHLP）**：支持 `create` / `pull` / `push` / `delete` 全流程，覆盖 join 视图、elementary 与 collective 搜索帮助；删除仅支持 `$TMP` 对象。已在 S/4HANA 真机验证。
- **XSLT 转换程序**：新增 `XSLT` 对象类型，本地为 `.xslt.json`（元数据）+ `.xslt.xml`（源码）两件套；支持创建、拉取、原地更新（保留版本历史）与删除。
- **事务码（TRAN）写路径**：`create` / `push` / `delete` 现在可用，支持 dialog / report（含 variant）/ parameter / variant 四类事务；OO 事务仍只读（SAP 规范功能不支持）。此前部分类型 `pull` 出来还是空文档，现已修复。
- **DOMA / DTEL 长文本**：`pull` 自动把对象长文本拉到 `<name>.<type>.docu.json` 伴生文件，`push` 自动推送；`lines: []` 删除远端长文本，`abap validate:aff` 识别伴生文件。
- **DEVC 包**：支持 `create`（`--check-only` 可预检）/ `pull` / `delete`；`push` 不支持（ADT 没有包更新接口）。
- **`abap test`**：在真实 SAP 上运行 ABAP Unit，只输出 summary 与失败用例；支持按风险等级、时长、类型过滤与 `--strict`。
- **对象类型扩展到 25 种**：`abap types` 现在列出 25 个类型码（各类型的 create / pull / push 支持情况见 README）。

### Changed

- **ICF 服务版本 1.1.0**：npm 包、CLI `--version` 与内置 ABAP 服务版本统一；升级后执行一次 `abap deploy --yes`，`abap deploy status` 会提示版本是否匹配。
- **本地 AFF 文件与 SAP 官方格式对齐**：HTTP 配置字段、消息类 `number`、表技术设置 `sizeCategory` 等校验与上游一致；少数旧文件可能需要重新 `pull`。

### Fixed

- **真实 SAP 上的会话问题**：CLI 不再保存或回放匿名上下文 cookie，长任务与失败命令也会正确关闭会话。此前会堆积 stateful 会话，最终所有 ADT 命令报 `400 Session not found`；现在会话可稳定复用，SM04 里不再"一条命令一条会话"。
- **DDIC 创建/推送**：真实 SAP 上 `create` / `push` DOMA / DTEL / TABL / STRU 此前会因字段转换、DTEL 嵌套类型与表技术设置失败；现在可直接创建并读回一致。
- **HTTP pull**：真实 SAP 上拉取 SICF 节点此前会产生过不了 `validate:aff` / `push` 的文件（描述超长、SICF 扩展字段）；现在拉下来的文件可直接校验与推送，旧文件重新 `pull` 即可。
- **`create local`**：CDS / RAP 伴生类型此前会生成无法 push 的假草稿；现在明确报 `TYPE_NOT_SUPPORTED` 并提示改用 `create --file`。

### Security

- **Node.js 运行时要求**：必须使用已修复 Brotli 越界写漏洞的版本（22.23.4+ / 24.22.1+ / 26.12.1+）；Node 18/20 不再支持。`abap doctor` 会检查运行时并给出升级建议。

### Removed (breaking)

- **旧 feedback 命令**：自建反馈服务下线；反馈改为直接提 GitHub issue（`gh issue create` 或预填 issue URL），离线留档继续用 `abap report-stuck`。
- **HTTP 本地文件的 `url` 字段改名 `servicePath`**：与 SAP 官方 AFF 格式一致；旧文件会被 `validate:aff` / `push` 拒绝，重新 `abap pull --overwrite` 或手动改名即可。
- **Node.js 18 / 20 及未打补丁的 22 / 24 / 26**：不再受支持。

**Migration**：

- 升级 CLI 后执行一次 `abap deploy --yes`，刷新 ICF 服务（新增 VIEW / SHLP / XSLT / TRAN 写路径与长文本端点）。
- 脚本里的旧 feedback 调用改为 `gh issue create --repo chunrichi/abap-cli ...`（没有 GitHub 凭据时用预填 issue URL）。
- `.http.json` 的 `url` / `generalInformation.url` 改名为 `servicePath`，或 `abap pull <name> --type HTTP --overwrite`。
- Node.js 升级到 22.23.4+ / 24.22.1+ / 26.12.1+。

## [1.0.0] - 2026-10-30

首个公开稳定版：CLI 契约、npm 包与内置 ICF 服务版本从此以本版本为准。

### Added

- **统一的 CLI 契约**：每个命令都支持 `--json` 与 `--schema`，使用稳定的退出码与结构化错误；文档由命令 schema 生成并校验，agent 可直接按 schema 调用。
- **完整的开发闭环**：pull / push / check / diff / create / delete / activate / transport，以及内置 ICF 服务提供的 DDIC、表数据、报表、MIME、文本池等 ADT 未覆盖的读能力。
- **`abap deploy --dev`**：维护者可用开发形态逐类检查、激活内置 ICF 服务。

### Changed

- **版本号统一**：npm 包、ICF 服务与 CHANGELOG 统一为 1.0.0，结束 0.x 时代 package 与 ICF service 版本分离的历史。
- **内置 ICF 服务维护形态**：开发期按全局类树迭代，发布时合并回单类，SAP 系统上只安装 3 个全局对象。
- **keychain 默认使用系统原生后端**：macOS / Windows / Linux 优先使用系统凭据存储，跨 Node 升级更稳定。

### Fixed

- **macOS 反复弹出钥匙串授权窗口**：改用系统原生 keychain 后，读取密码不再每次要求授权。

### Removed (breaking)

- **extensions 扩展机制**：删除 `abap extensions` 命令、配置字段与相关错误码；依赖扩展 hook 的流程需在 CLI 外实现。
- **deprecated 别名与兼容开关**：`--max`（改用 `--limit`）、`--system`（改用 `--profile`）、`--type SICF`（改用 `--type HTTP`）等不再接受。
- **0.x 版本线**：0.1.0–0.2.8 已从 npm 下线，不可复用；请安装 `abap-cli@1.0.0`。
- **认证方式仅保留 basic auth**：移除证书 / SSO / OAuth 登录及相关参数；依赖 BTP trial、SAML SSO 或 X.509 的环境无法连接。
- **本地文件布局改为 AFF 扁平布局**：产物直接平铺在输出目录，文件名形如 `<name>.<type>...`；命名空间对象使用 `(ui2)cl_json` 形式，旧的 `#` 写法不再识别。
- **移除 CA store 的客户端证书导入**：只保留 `--ca` 的 CA 导入/回收。

**Migration**：

- 已部署 ICF 服务的系统执行一次 `abap deploy --yes`。
- 旧工作区重新 `abap pull`：产物会写到新的扁平布局，旧的嵌套目录可直接删除。
- 旧认证方式的 profile 执行 `abap profile set <name> --password <pwd>` 转为 basic，或删除重建。
- 旧 keychain 的 cert-passphrase 条目不再使用，可手动清理。
- 旧 `profile export` bundle（version 2）需用 basic profile 重新导出/导入。

### History

0.1.0–0.2.8 的逐版本记录随旧 git 历史归档（不再参与本仓库的版本叙事）；npm 上对应版本已全部下线。
