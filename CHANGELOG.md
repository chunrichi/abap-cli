# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组。Breaking 变更在 `Removed` 标记并附 Migration。
更老的展开内容归档于 `docs/CHANGELOG-history.md`。

## [Unreleased]

### Added
- **`specs/032-aff-by-type-gap-fix/`**：spec kit 全流程立项 — `spec.md` (13 User Story / 35 FR / 12 SC) + `plan.md` (5 Phase) + `tasks.md` (66 T 编号)；治理 10 类已支持对象的 abap-file-format 合规性与本地文件处理 gap（spec 024 follow-up + memory B/D 沉淀 + `wiki/object-types.md` todo）。
- **`src/abap_cli/types/registry.ts`**：单一类型注册表，统一三份既有分裂表（`formats/type-folder.ts#TYPE_FOLDER` + `flows/create-types.ts#TYPE_MAP` + `formats/{ddic,http,transport}/json.ts` 的 `*_SUPPORTED_TYPES`）。新增类型仅改 `registry.ts` 一行即可让 9 个 CLI 命令与 schema 自动识别。
- **`src/abap_cli/cli/type-alias.ts`**：`normalizeTypeInput()` 处理 CLI 输入归一化。当前唯一别名 `SICF` → `HTTP`，返回 `aliasWarning` 字符串供 `meta.warnings[]` 承载。
- **`abapLanguageVersion` 全类型落盘**：`header.abapLanguageVersion` 从 ADT `objectStructure.metaData['abapsource:abapLanguageVersion']` 读取；10 类对象 pull 端均写 `<name>.<type>.json#header`；FUGR 三件 JSON（`fugr.json` / `sapl*.reps.json` / `*.func.json`）均含该字段。cloud 系统推送不再因缺字段失败。
- **DOMA `fixedValues` 双向 round-trip**：wire `{fixedValue, fixedValueLong: {languageIndependent, languageDependent[]}}` ↔ local `{fixedValue, description: {...}}`；接受 abap-file-format 嵌套 `format.fixedValues` 与 top-level `fixedValues` 两种形态；特殊字符（引号 / 反斜杠 / Unicode）round-trip 不丢失。- **DTEL `typeRef` 第三种 category 支持**：wire `typeRef: { typeName, referencedTypeName? }` ↔ local `dataTypeInformation: { category: 'typeRef', typeName, referencedTypeName? }`；接受 abap-file-format 嵌套形态与 top-level 扁平 `typeRef` 两种 local 输入。`domain` / `predefinedType` category 行为保持不变（不强制统一嵌套）。- **FUGR create-then-pull 残留 `<group>.fugr.abap` 清理**：`runCreate` FUGR 分支走 `pullObject()`（即 standard abap-file-format 布局），不再写规范的 FUGR 不允许的单文件。
- **`SICF` → `HTTP` 类型码别名**：`pull --type SICF` / `create SICF` 内部映射到 `HTTP`；`create --help` 提示「alias: SICF, deprecated」。`schema.allowedValues` 仍严格仅 `HTTP`。
- **Mock-adt 扩字段**：`test/mock-adt/server.js` 在 `structureXml` 输出 `abapsource:abapLanguageVersion`（默认 `standard`，`MOCK_CLOUD=1` 时 `cloudDevelopment`）。

### Changed
- **FUGR `fixPointArithmetic` mock fallback**：`src/abap_cli/formats/pull-fugr.ts` 在 `metaData['abapsource:fixPointArithmetic']` 缺省时默认 `false`（之前是字段缺失）。on-prem 消费者始终拿到布尔；cloud 系统明确 `true` 仍按 `true` 落盘。
- **跨类型注册表合一（US11 / T046-T052）**：`types/registry.ts` 成为 10 类对象（4 源 + 4 DDIC + HTTP + TRAN）的单一真源。`formats/type-folder.ts` 的 `TYPE_FOLDER`、`flows/edit/create-types.ts` 的 `TYPE_MAP`、`formats/{ddic,http,transport}/json.ts` 的 `*_SUPPORTED_TYPES` 常量全部迁移到 registry（保留同名 re-export 维持外部 import 兼容）。`create --schema` 的 `arguments[0].allowedValues` 从 4 个源对象升级为全 10 类。新增类型只需要编辑 `registry.ts` 一行，9 命令与 schema 自动识别。`isDdicSupportedType` / `isHttpSupportedType` / `isTranSupportedType` 收紧为 type guard（要求 uppercase 字符串）。

### Fixed
- **TABL/STRU push 走三件套**：`flows/edit/push.ts#pushDdicFile` 改用 `readDdicObjectForCreate`（之前直接 `readDdicJson`），TABL/STRU 三件套 `<name>.{tabl,stru}.{json,ddic,settings.json}` 在 push 路径与 create 路径行为一致（DDL 是字段定义唯一真相）。STRU 缺 `.settings.json` 不报错。DDL 解析失败 → `TABL_DDL_INVALID`（VALIDATION_ERROR/exit 7），含行号提示与三件套迁移 nextSteps。
- **TABL DDL 解析器扩展**：`formats/ddic/tabl-artifact.ts#parseTablDDic` 新增支持：① `.INCLUDE ... WITH SUFFIX <suffix>`（写入 `field.includeSuffix`）；② 多列复合 key（每列 `keyFlag: true, notNull: true`）；③ 行内 foreign key（`abap.char(3) with foreign key [dependent] check t005;` 一行式）；④ `@AbapCatalog.foreignKeys [ ... ]` 块（写入 `field.foreignKeys[]`）；⑤ `@ClientHandling.type`（驱动 `clientDependent` 显式覆盖默认启发式）。

### Tests
- `test/unit/abapLanguageVersion.test.ts` — 3 cases（cloud / on-prem / standard fallback）。
- `test/unit/doma-fixedValues-roundtrip.test.ts` — 5 cases（empty / single / multi-lang / special chars / nested `format.fixedValues`）。
- `test/unit/type-alias-sicf-http.test.ts` — 5 cases（uppercase / lowercase / subtype suffix / HTTP passthrough / unknown passthrough）。
- `test/unit/fugr-fixPointArithmetic-default.test.ts` — 3 cases（mock 三态：true / false / 缺字段默认 false）。
- `test/unit/tabl-ddl-extended.test.ts` — 5 cases（`.INCLUDE WITH SUFFIX` / 复合 key / 行内 foreign key / `@ClientHandling.type` / canonical deliveryClass + inline semantics）。
- `test/unit/push-ddic.test.ts` — 新增 3 cases（TABL 三件套 push 合并 DDL / STRU 三件套 push 缺 settings 不报错 / 残缺 DDL → `TABL_DDL_INVALID`）。
- `test/unit/types-registry.test.ts` — 8 cases（10 类全覆盖 / ADT vs ICF 路由 / `createObjtypeFor` 4 源对象 / `folderFor` 大小写 + 子类型 suffix / legacy alias 一致性 / `TYPE_REGISTRY` 与 helpers 无漂移）。
- `test/unit/dtel-typeRef.test.ts` — 12 cases（wire `typeRef` → local `dataTypeInformation` / 保留 `referencedTypeName` / 空 `typeName` 不写 / `localToWire` 反向 / 嵌套 vs 扁平 local 输入 / round-trip 保真 / AC3 未知 category 抛 `DTEL_CATEGORY_UNSUPPORTED` + message 含 3 个合法 category / 三个合法 category 不抛错 / 旧 flat shape 兼容）。
- `test/unit/schema.test.ts` — 更新 1 case（`create --schema` `allowedValues` 由 4 个源对象升级为 10 类）。
- 基线：1000 → 1044 测试，1042/1044 通过；2 个失败均为既有（`skill-bundle` 审计与 `deploy-dryrun` ERR_DLOPEN_FAILED），不在本次范围。
- tsc: 0 错误。

### Pending (未完成)

- Phase 4：US9 DOMA `signFlag/lowercase/convExit` + US10 HTTP `serviceId/descriptionByLang` + create 骨架 + US12 5 类对象文本元素多语言 + US13 PROG/I 子类型分流（US8 DTEL `typeRef` 已完成）。
- Phase 5：真实 SAP 端到端（vhcala4hci:50000 当前不可达 — host 解析为 127.0.0.1 但 50000 端口无服务；需恢复 SAP 后跑 10 类对象 round-trip）+ wiki 同步 + 文档收尾。

### Skills
- **`skills/abap-cli-performance/`**：ABAP 性能 review 方法论 skill（5→6 skill）;`metadata.commands` 列出触发的只读命令（`search / inspect / pull / check / select`），实际归属仍是 4 个领域 skill；本 skill 全程不写对象。同步更新：`skills/abap-cli/SKILL.md` 路由表 + 决策树、`skills/README.md` 索引表 + 路由表 + 命令覆盖核对、`agents/abap-developer.agent.md` `skills` / `handoffs` / references / 错误恢复表。路由关键词：`慢 / 性能 / 优化 / N² / FOR ALL ENTRIES / 内表 / HASHED / AMDP / CDS`。
- **wiki/design-decisions/**：5 篇设计决策录（001 三层架构 / 002 ICF bypass DDIC / 003 类型子目录布局 / 004 npm 扩展 trust hardening / 005 BTP vs on-prem），每篇遵循「决策 / 上下文 / 被否决方案 / 当前代价 / 后果」五段式；`.gitignore` 白名单加入 `wiki/design-decisions/` 与 `wiki/objects/`。
- **wiki/objects/**：10 类对象（CLAS / INTF / PROG / FUGR / TABL / STRU / DOMA / DTEL / HTTP / TRAN）逐类一页：路由 / 本地文件形态 / 关键字段 / 命令示例 / abap-file-format 合规性 / 已知坑。
- **wiki/agent-cookbook.md**：AI agent 端到端开发剧本库（修 bug / 加 DDIC / 跨系统同步 / 批量改 transport / 试运行 / 紧急回滚 / 新类 / 删除），每个剧本含完整命令序列 + 失败兜底。
- **wiki/coverage-matrix.md**：SAP 开发任务覆盖率矩阵（10 大类对象 CRUD + 运行时 + transport + 元数据 + 跨系统 + 配置 + ICF + 扩展 + 文档 + 缺失能力优先级），诚实快照供未来 spec 选题与用户预期管理。
- **wiki/architecture-diagrams.md**：8 张 Mermaid 图（三层架构 / pull 序列 / push 序列 / ICF 调用 / auth 路由 / error 与退出码 / 扩展信任链 / 命令全景）。
- **`scripts/build-cli-schema.ts` + `npm run build-schema`**：从 `error-codes.ts` 的 `ErrorCode` / `ErrorCategory` 联合 + `exit-codes.ts` 的 `EXIT_CODES` 表派生 `cli-output.schema.json` 的 `error.code` enum（31 项）、`error.category` enum（9 项）、并附 `__exitCodesAnnex` 说明（category → exit code）。手写 schema → 自动生成 schema，错误码变更不再需要手改 JSON。

## [0.2.3] - 2026-08-31

### Added
- **对象类型可发现性文档**：新增 `wiki/object-types.md`（9 类对象 × 4 个写命令路由矩阵；澄清"ICF"通道 vs 对象两种含义；列出 `TTYP` / DDLS-CDS / `TRAN` / `ENHO` 暂不支持）。`skills/abap-cli-edit` 决策树加 HTTP 分支 + 类型矩阵表；workflow.md 新增变体 12（HTTP 服务 pull/create/push）。`.gitignore` 增列 `!wiki/object-types.md`。
- **DDIC TABL/STRU DDL 骨架资产**：`skills/abap-cli-edit/assets/tabl-templates/` 5 个场景（transparent-key / transparent-with-include / transparent-currency-amount / transparent-quantity-unit / structure-basic），每个含 README + cp/sed 流程。SKILL.md 决策树与 workflow.md 变体 2 引用 assets。
- **abap-file-format 官方 JSON Schema 同站收录**：`assets/tabl-templates/schemas/` 收录 `tabl-v1.json` + `tabt-v1.json`，Agent 可用 ajv 8 做严格字段校验。
- **全 19 命令 `--schema` introspection**：此前仅 6 个命令支持，现全部支持机器可读契约。
- **docs/commands.md 自动生成**：`scripts/build-commands-doc.{ts,mjs}` 从 `commandSchemas` + `EXIT_CODES` 单一事实源生成全部 19 命令文档；`npm run build-docs` 调用。
- **ADT runtime 探测 + 持久化 cache**：probe 新增 `apiCapabilities`（icf / httpService / steampunkMarkers）；`SystemProfile` 加 `runtime?: CachedRuntime`，由 `profile test` 刷新到 `~/.abap-cli/systems.json`；新增 `runtime-cache.ts`。
- **ICF register strategy registry**：`extension deploy` ICF 分支重构为 `IcfRegisterStrategy` 接口 + 三个内置 strategy（OnPremClIcfTree / SteampunkCockpitFallback / SteampunkSwb 占位）。
- **BTP-safe CLAS / INTF / PROG / FUGR create wrapper**：等价复刻 `abap-adt-api` 的 XML body，加 BTP 必需元素；`ABAP_CLI_LEGACY_CREATE=1` 退回 library。
- **`auth/sso-loopback.ts`**：重做 sso，`profile login` 启 127.0.0.1 loopback listener + 浏览器捕获 cookie。
- **auth 认证策略模式重构**：`auth/adapter.ts` 拆为 dispatcher + `auth/strategy.ts` registry + 各 strategy 自注册；新增通用 `--auth-option key=value` flag。

### Changed
- **`abap create TABL/STRU` 接受 abap-file-format 三件套**：探测 main + `.tabl.ddic` + `.tabl.settings.json`，齐全走 `readTablArtifact` 合并；否则回落 wire-flat 单文件（向后兼容）。
- **`abap init` 向导顺序调整为「身份先、凭证后」**；TTY 下显式询问 insecure。
- **`--schema` 统一为 unified envelope**：`run` / `select` / `tcode` / `where-used` 输出 `{ status, meta, data }`，Agent 需从 `JSON.parse(stdout).data` 取 schema。
- **`CommandSchemaOption` / `CommandSchemaArgument` 接口扩展**：增加 type 联合、pattern / minimum / global 等字段；`CommandSchema` 加 scope / notes / errors，`usage` 改可选。
- **envelope JSON Schema + 全命令契约测试**：新增 `cli-output.schema.json`（draft-07）+ envelope-schema 测试，扫描全部注册命令。
- **`oauth_password` 密码查找链**：OS keychain → `--password` → TTY prompt（prompt 后自动 store 到 keychain）。
- **create-object body 去掉 `adtcore:responsible`**：BTP trial `CLASS_TRANSFORMATION` ST 拒绝带此属性。
- **`init --agent` 路径分层**：每个 vendor 写入 agent 框架约定的子目录（copilot → `.github/` / claude → `.claude/` / cursor → `.cursor/` / generic → `.agents/`）；不再写入 `AGENTS.md` / `copilot-instructions.md` / `skills/README.md`。
- **CHANGELOG 压缩**：早期版本累积的展开压成核心条目；旧内容整体下移到 `docs/CHANGELOG-history.md`。

### Removed
- **移除所有 env 密码读取**（breaking）：`SAP_PASSWORD` / `*_PASSWORD` / `*_PASSWORD_<PROFILE>` / `CERT_PASSPHRASE_<PROFILE>` / `ABAP_CLI_SECRETS_BACKEND` 不再被读取；密码只来自 `--password` flag、OS keychain、TTY prompt。**Migration**：CI 改为 `abap profile set <name> --password <pw>` 写入 keychain，或每次传 `--password`。
- **`--help` 不再嵌入 `Common errors / Exit codes` 块**：改为在错误抛出时通过 `CliError.references` 指向 `skills/abap-cli-{edit,setup}/references/errors.md`。

### Fixed
- **`extension deploy` 把 ICF source 写进 user transport 导致 outdated 死锁**：`targetPackage === '$TMP'` 时强制 `transport = ''`；加守卫显式拒绝 `--package $TMP --tr NDK...`；`extension status` 新增 `ICF_OUTDATED_DEADLOCK` 警告与恢复步骤。
- **`abap create` DDIC 校验错误信息不指明 wire JSON 结构**：`validateDdicObject` 明确写 top-level 字段要求；新增 `getDdicJsonExample` 返回最小 wire-flat 模板，`runCreateDdic` 把 `error.example` + `references` 一起塞进 envelope；`--schema` 对 DDIC 类型输出 `exampleJson`。
- **`abap create TABL/STRU` 不再因用户显式声明 `CLIENT/MANDT` 而撞 SAP 端 "Field already exists"**：CLI 端 `localToWire` 加 `stripClientFields`（大小写不敏感）剥掉 client-key 字段并留 `CLIENT_FIELD_STRIPPED` 诊断；`validateDdicObject` 加两条 guard；SAP 端 prepend MANDT 之前加重复字段守卫。
- **`inspect --activation` 忽略 `main` part 拖累 `ok`**：`ok` 只看 `{implementations, definitions, testclasses, macros}`；`main` 仍报告但不计入。
- **`abap create --help` 文本列出全部 9 个对象类型 + `$TMP` 引号提示**：`description` 扩为全部 9 类，`addHelpText` 加 Supported types 表格 + `--package $TMP must be quoted` 提示。
- **Windows / cross-platform path contract**：所有 `--json` 输出路径统一为 POSIX 相对路径（`/`）；新增 `core/path-output.ts` 提供三个边界 helper。

### Known limitations
- **BTP trial `extension deploy` 仅 source-only**：on-prem 走 `cl_icf_tree`，Steampunk 仅 deploy sources + 自动 hint CF destination。
- **BTP trial `reentranceticket` 当前不接受裸调**：trial 上唯一自动化 SSO 是 `oauth_password`。

## [0.2.3] - 2026-08-31

## [0.2.2] - 2026-08-28

### Security
- **扩展加载信任硬化（Lazy Load + Lockfile Pinning + 严格包名校验）**：启动期不再 `import()` 任何 npm 扩展；新增 `extensions.lock.json`（含 sha512 integrity），CLI 在 `import()` 之前用 `node:crypto` 校验；缺失 / 篡改归一为 `EXTENSION_LOAD_FAILED`（exit 3）。新增 `abap extensions lock [--allow-unsigned]`；npm 包名校验覆盖 `..` / `\` / 空 scope / URL scheme / 非 npm 名字符集。

### Added
- **ADT runtime 分层 + Steampunk `extension deploy` 分流**：探测 `netweaver740` / `netweaver750` / `steampunk` / `unknown`；Steampunk 下 `deployKind: "source-only"`，ICF 节点注册改为 `STEAMPUNK_ICF_MANUAL` 警告 + CF destination 步骤。真 BTP trial 验证：4 个 CLAS deploy 成功。

### Changed
- **Skill 重组：4 领域 + 1 meta**：`abap-setup` + `abap-object` 拆为 `abap-cli`（meta）+ `abap-cli-setup`（环境）+ `abap-cli-search`（只读）+ `abap-cli-edit`（写路径）+ `abap-cli-data`（运行时消费）。旧 skill 目录删除；`agents/abap-developer.agent.md` 扩为 9 步工作流 + 5 handoffs。**Migration**：`abap-setup` → `abap-cli-setup`；`abap-object` → `abap-cli-{search,edit,data}`（按意图选）；重新加载 agent。

## [0.2.1] - 2026-08-25

### Changed
- **CHANGELOG 压缩**：早期累积展开压成核心条目；旧内容整体下移到 `docs/CHANGELOG-history.md`。

### Removed
- **移除所有 env 密码读取**（breaking）：`SAP_PASSWORD` / `*_PASSWORD_<PROFILE>` / `CERT_PASSPHRASE_<PROFILE>` / `ABAP_CLI_SECRETS_BACKEND` 不再被读取。**Migration**：CI 改为 `abap profile set <name> --password <pw>` 写入 keychain，或每次传 `--password`。