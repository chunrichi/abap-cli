# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组；breaking 变更在 `Removed` 标记并附 **Migration**。
条目面向 CLI 用户：写「用户能做什么 / 行为如何变化 / 升级要注意什么」，不写内部实现（类名、ABAP 函数、文件路径、错误码枚举）；同一功能的细节合并成一条。

## [Unreleased]

加固 `abap profile add/set/import` 的输入契约，并修复 `abap init` 字段更新与写盘行为。含 breaking 变更（profile 名规则），见 Migration。

### Added

- **`abap init --agent agents`**：`--agent` 新增 vendor 中立的 `agents` 目标，把 6 个 skill 与 `abap-developer` agent 定义装进 `.agents/` 目录；输出与 `generic` 相同，未绑定某个厂商 IDE 时用它即可。
- **profile 子命令机器契约**：`abap profile <command> --schema --json` 返回该子命令自己的参数与选项，不再依赖把 add/set/export 选项混在一起的父级总览。
- **profile 列表更可读**：`abap profile list` 显示 client / language，并标出当前工作区绑定的 profile 与缓存的系统信息；`profile add` 明确返回"未验证"与下一步（`profile test` → `init --profile`）。

### Changed

- **URL 一律归一化到 origin**：`profile add/set/import` 与 `init` 建 profile 时，粘贴的 Fiori/WebGUI/深链接只保留 `scheme://host[:port]`，丢弃 path/query/fragment 并给出告警；URL 内嵌用户名密码直接拒绝。此前带 path 的 URL 会被原样保存，后续所有请求都会 404。
- **`abap init` 支持非交互字段更新**：`abap init --tr/--package/--source-dir --yes` 不需要 `--profile`，直接更新最近的 `.abap.json`；写入改为 merge，未传的字段（含 `sourceDir`）保留，不再整份覆盖。
- **profile 名规则**：名称需 1–64 字符、字母/数字/`_`/`.`/`-` 且以字母或数字开头（名称同时是配置键与 keychain 账号）。

### Fixed

- **`profile add` 的 textpool 探测用错连接**：此前用当前工作区的连接去探测刚创建的 profile，可能把别的系统的能力结论写进新 profile；现在由 `abap init` 针对目标 profile 探测，且连不上时不写结论。
- **交互式 `profile add` 可能写出坏配置**：URL 直接回车会写入空 URL，导致整份 profile 配置无法读取；现在向导落盘前与参数路径使用同一套校验。
- **`abap init` 覆盖 `.abap.json` 丢失 `sourceDir`**：字段更新与 profile 重绑现在都保留未传字段。

### Removed (breaking)

- **含空格、斜杠等字符的 profile 名不再接受**：`profile add/set/import` 会拒绝非法名称。既有 profile 仍可读取、连接与删除，但无法再 `set` 或导出后重新导入。

**Migration**：

- 旧 profile 名含空格/斜杠等字符时，用 `abap profile delete <name>` 后以合法名称重新 `abap profile add`（密码需要重新写入 keychain）；工作区 `.abap.json` 的 `system` 用 `abap init --profile <新名>` 重新绑定。
- 旧 profile 里保存了带 path/query 的 URL 时，执行 `abap profile set <name> --url https://host:port` 修正。

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
