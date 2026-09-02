# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组。Breaking 变更在 `Removed` 标记并附 Migration。
更老的展开内容归档于 `docs/CHANGELOG-history.md`。

## [Unreleased]

### Added
- **`specs/032-aff-by-type-gap-fix/`**：spec kit 全流程立项 — `spec.md` (13 User Story / 35 FR / 12 SC) + `plan.md` (5 Phase) + `tasks.md` (66 T 编号)；治理 10 类已支持对象的 abap-file-format 合规性与本地文件处理 gap（spec 024 follow-up + memory B/D 沉淀 + `wiki/object-types.md` todo）。
- **`src/abap_cli/types/registry.ts`**：单一类型注册表，统一三份既有分裂表（`formats/type-folder.ts#TYPE_FOLDER` + `flows/create-types.ts#TYPE_MAP` + `formats/{ddic,http,transport}/json.ts` 的 `*_SUPPORTED_TYPES`）。新增类型仅改 `registry.ts` 一行即可让 9 个 CLI 命令与 schema 自动识别。
- **`src/abap_cli/cli/type-alias.ts`**：`normalizeTypeInput()` 处理 CLI 输入归一化。当前唯一别名 `SICF` → `HTTP`，返回 `aliasWarning` 字符串供 `meta.warnings[]` 承载。
- **`abapLanguageVersion` 全类型落盘**：`header.abapLanguageVersion` 从 ADT `objectStructure.metaData['adtcore:abapLanguageVersion']`（root attr）读取；10 类对象 pull 端均写 `<name>.<type>.json#header`；FUGR 三件 JSON（`fugr.json` / `sapl*.reps.json` / `*.func.json`）均含该字段。cloud 系统推送不再因缺字段失败。
- **DOMA `fixedValues` 双向 round-trip**：wire `{fixedValue, fixedValueLong: {languageIndependent, languageDependent[]}}` ↔ local `{fixedValue, description: {...}}`；接受 abap-file-format 嵌套 `format.fixedValues` 与 top-level `fixedValues` 两种形态；特殊字符（引号 / 反斜杠 / Unicode）round-trip 不丢失。- **DTEL `typeRef` 第三种 category 支持**：wire `typeRef: { typeName, referencedTypeName? }` ↔ local `dataTypeInformation: { category: 'typeRef', typeName, referencedTypeName? }`；接受 abap-file-format 嵌套形态与 top-level 扁平 `typeRef` 两种 local 输入。`domain` / `predefinedType` category 行为保持不变（不强制统一嵌套）。
- **DOMA `format.signFlag` / `format.lowercase` / `format.convExit` 双向落盘**：wire 字符串形态（`'X'` / `''` / `'ALPHA'`；空串保留）↔ local 嵌套 `format.{signFlag, lowercase, convExit}`（abap-file-format `doma-v1.json` 嵌套 schema）。Local top-level 扁平字段保留为 legacy fallback（向后兼容既有脚本）。Wire 类型从 `boolean` 修正为 `string`（与 SAP ICF wire 一致）。
- **PROG `PROG/I` 子类型分流**：`pull-strategy.ts` 检测 `programType: 'I'`（mock raw）或 `objectType: 'PROG/I'`（real SAP fallback）时，单一 source part 的 subtype 从 `main` 重命名为 `include`，落盘 `<name>.prog.include.abap`（不混入 `<name>.prog.abap` main 路径）；JSON 元数据 `generalInformation.programType: 'include'`（abap-file-format prog-v1 枚举值）由 `object-metadata.ts` 已有的 `programTypeOf` 派生。CLAS/INTF（共享 `sourceObjectStrategy()`）不受影响。
- **HTTP `serviceId` + `descriptionByLang[]` 双向落盘**：wire ↔ local 在嵌套 `generalInformation.serviceId` 与 `header.descriptionByLang[]` 之间 round-trip（两者均为 SAP SICF 扩展字段，不在 abap-file-format `http-v1.json` schema 内但 SAP wire 必需）。接受 abap-file-format 嵌套形态与 top-level 扁平字段两种 local 输入。空 `descriptionByLang` 数组省略；`serviceId` 缺省时省略。
- **HTTP `create` 最小骨架**：`abap create HTTP <name>` 无 `--file` 时落盘 `src/http/<name>/<name>.http.json` 最小骨架（`formatVersion` + `header{description, originalLanguage}` + `generalInformation{handlerClass, url}` 占位），`action: 'local'`（**不**调 SAP）。已有同名文件返回 `OVERWRITE_REQUIRED`（与 014 既有约定一致；可手动删除后重跑或传 `--file <other-path>`）。Help 文本更新。
- **CLAS/INTF/PROG/FUGR/TABL/STRU 文本元素多语言贯通**：`abap pull <name> --type <T> --textpool` 对 5 类对象均落盘 `<name>/<name>.<type>.{texts,selections,headings}.<lang>.properties`。无 `--type` 不再默认 PROG（强制要求显式类型 — 避免 CLAS/INTF/FUGR/TABL/STRU 拉错类型）。Mock 缺某 category 文本元素时（TEXTPOOL_OBJECT_NOT_FOUND）落 `meta.warnings[].TEXTPOOL_CATEGORY_MISSING` + `data.skipped[]`（软警告，**不**升 `failed`）— 不同对象类型自然有不同的 category 组合（CLAS 无 selections；FUGR 通常无 headings；STRU 只有 texts）。`--include-tests --textpool` 组合支持。- **FUGR create-then-pull 残留 `<group>.fugr.abap` 清理**：`runCreate` FUGR 分支走 `pullObject()`（即 standard abap-file-format 布局），不再写规范的 FUGR 不允许的单文件。
- **`SICF` → `HTTP` 类型码别名**：`pull --type SICF` / `create SICF` 内部映射到 `HTTP`；`create --help` 提示「alias: SICF, deprecated」。`schema.allowedValues` 仍严格仅 `HTTP`。
- **Mock-adt 扩字段**：`test/mock-adt/server.js` 在 `structureXml` 输出 `abapsource:abapLanguageVersion`（默认 `standard`，`MOCK_CLOUD=1` 时 `cloudDevelopment`）。

- **ICF `/mime/*` 端点（扩展 0.6.0）**：自建 ICF handler `ZCL_ABAP_VIBE_ICF` 新增 `dispatch_mime` —— `POST /mime/folder`（建 root/嵌套目录，`package`→devclass，默认 `$TMP`）、`PUT /mime/folder?recursive=&transport=`（删目录）、`POST /mime/resources`（base64 单文件上传，父目录须已存在）。底层用 `CL_MIME_REPOSITORY_API`（SE80 MIME 存储库；本 S/4HANA 2023 release 无 `SCMS_*` 函数模块）。错误 envelope + 真实 HTTP 状态（`INVALID_ARGUMENT` 400 / `NOT_FOUND` 404 / `OBJECT_EXISTS` 409 / `VALIDATION_ERROR` 422 / 其余 500）。`extension status` 期望版本 0.5.0 → 0.6.0。

### Changed
- **FUGR `fixPointArithmetic` mock fallback**：`src/abap_cli/formats/pull-fugr.ts` 在 `metaData['abapsource:fixPointArithmetic']` 缺省时默认 `false`（之前是字段缺失）。on-prem 消费者始终拿到布尔；cloud 系统明确 `true` 仍按 `true` 落盘。
- **跨类型注册表合一（US11 / T046-T052）**：`types/registry.ts` 成为 10 类对象（4 源 + 4 DDIC + HTTP + TRAN）的单一真源。`formats/type-folder.ts` 的 `TYPE_FOLDER`、`flows/edit/create-types.ts` 的 `TYPE_MAP`、`formats/{ddic,http,transport}/json.ts` 的 `*_SUPPORTED_TYPES` 常量全部迁移到 registry（保留同名 re-export 维持外部 import 兼容）。`create --schema` 的 `arguments[0].allowedValues` 从 4 个源对象升级为全 10 类。新增类型只需要编辑 `registry.ts` 一行，9 命令与 schema 自动识别。`isDdicSupportedType` / `isHttpSupportedType` / `isTranSupportedType` 收紧为 type guard（要求 uppercase 字符串）。

### Fixed
- **dumps 查询形态对齐 ADT OData 契约**（真实 SAP 验证暴露）：`AdtClientWrapper.dumps` 原实现经 `abap-adt-api` 的 feeds.dumps 把查询整串包成 `$query=...`，而真实 SAP `/sap/bc/adt/runtime/dumps` 只接受直接 OData `$top`/`$filter` 参数，对该形态回 HTTP 400（"Data is invalid and could not be converted"）→ `abap dumps` 报 SAP_ERROR/exit 6。现新增 `clients/dumps-feed.ts` 自持 raw request（直发 `$top`/`$filter`）并用 library 的 `fullParse`/`xmlArray` 镜像其 Atom 解析，`DumpsFeed` 类型不变。真实 SAP（S/4HANA 2023 FPS02）`abap dumps --limit 5 --json` exit 0 返回 5 条摘要；`--user` 过滤与默认 `--limit 20` 均通过。测试：`test/unit/dumps-feed.test.ts` 9 cases（query 构造 / 请求形态 / Atom 解析）。
- **HTTP create/push wire 形态对齐嵌套契约**（真实 SAP 验证暴露，T059）：`formats/http/json.ts#localToWire` 之前输出扁平 wire（`description`/`handlerClass`/`url` 在顶层），而自建 ICF handler `dispatch_http` 用 `/ui2/cl_json` 反序列化到嵌套 `ty_http_service_data`（`formatVersion` / `header` / `generalInformation`）→ 真实 SAP create 永远报 `HTTP_SERVICE_INVALID`（mock 无 `/http` 路由，掩盖了 wire 契约分歧）。现 wire 即嵌套 abap-file-format 形态（与 GET 响应、`http-v1.json` 一致），`package` / `transportRequest` 留在顶层信封；GET data 无 `name`（非 ABAP 结构成员），pull 由请求对象名注入。真实 SAP `create → pull → push → pull` 字节级零差异闭环通过。`serviceId` / `descriptionByLang[]`（US10）仍仅 CLI 透传 —— ABAP 0.5.0 结构不含这两字段，真实 SAP 不持久化 / 不回传（见 `wiki/objects/http.md` 已知坑）。
- **HTTP `create` 骨架补 `name`**：`abap create HTTP <name>`（无 `--file`）骨架落盘含 `name`（与 pull 布局一致）；此前缺 `name`，骨架编辑后 push 校验报 `Missing required field: name`，无法"编辑即 push"。
- **`abapLanguageVersion` namespace 读错**（真实 SAP 验证暴露，T059）：`formats/object-parts.ts` + `formats/pull-fugr.ts` 之前读 `meta['abapsource:abapLanguageVersion']`；真实 ADT 返回 `adtcore:abapLanguageVersion`（root attr，`xmlns:adtcore`），mock fixture 伪造 `abapsource:` → mock 全绿、真实 SAP 永远拿不到 → pull 落盘缺失。修复后真实 pull 落盘 `"abapLanguageVersion": "standard"`。
- **TABL/STRU push 走三件套**：`flows/edit/push.ts#pushDdicFile` 改用 `readDdicObjectForCreate`（之前直接 `readDdicJson`），TABL/STRU 三件套 `<name>.{tabl,stru}.{json,ddic,settings.json}` 在 push 路径与 create 路径行为一致（DDL 是字段定义唯一真相）。STRU 缺 `.settings.json` 不报错。DDL 解析失败 → `TABL_DDL_INVALID`（VALIDATION_ERROR/exit 7），含行号提示与三件套迁移 nextSteps。
- **TABL DDL 解析器扩展**：`formats/ddic/tabl-artifact.ts#parseTablDDic` 新增支持：① `.INCLUDE ... WITH SUFFIX <suffix>`（写入 `field.includeSuffix`）；② 多列复合 key（每列 `keyFlag: true, notNull: true`）；③ 行内 foreign key（`abap.char(3) with foreign key [dependent] check t005;` 一行式）；④ `@AbapCatalog.foreignKeys [ ... ]` 块（写入 `field.foreignKeys[]`）；⑤ `@ClientHandling.type`（驱动 `clientDependent` 显式覆盖默认启发式）。

- **`extension deploy` 捆绑源码目录解析回归**（flows/ 拆分后静默 no-op）：`bundledDir` 相对深度少一级（解析到不存在的 `dist/abap/src`），部署永远“空对象成功”、真实 SAP 收不到任何 `abap/src` 更新。改为 `bundledSourceDir()` 向上查找含 `abap/src/clas/zcl_abap_vibe_icf.clas.abap` 的包根（src/ / dist/ / npm 安装布局均适用）；找不到时抛 `CONFIG_ERROR` 而非静默成功。
- **ICF handler 类源码无法激活（8/29 后未部署暴露）**：`resolve_handler_language_version`（>30 字符方法名）、`get_language_version`（本 release RTTI 无此方法，改 `cl_abap_language_version` 官方 API 并回落 `standard`）、`read_tran_tstc`/`build_tran_payload` 误按 `RETURNING` 调用、TSTCA 错用 `low/high`（实际列 `value`）、TSTC `CINFO` 非法字面量等编译错误全部修正，类可正常激活。
- **Mock-adt `inactiveobjects` + `discovery` 端点补齐**（mock 与真实 SAP 端点对齐）：`test/mock-adt/server.js` 新增 `GET /sap/bc/adt/activation/inactiveobjects`（按真实 ADT `ioc:inactiveObjects` 形态枚举所有 `inactive:true` 对象）与 `GET /sap/bc/adt/discovery`（Atom service document，含 `/sap/bc/adt/icf/` 与各 ADT collection）。`createObject` POST handler 现在将新建对象标记为 `inactive:true`（匹配真实 SAP 后创建语义），`POST /sap/bc/adt/activation` 成功后翻转为 `false`；激活匹配的源 URL 解析扩展为 `byAnyUrl`（覆盖 method/OSI 部件源 URL，不仅 root objectUrl）。`addObject` 返回新对象供创建路径 mutate。`abap activate` 与 `abap doctor` 在 mock 上不再 404；FUGR/PROG/CLAS 创建后正确出现在 `/inactiveobjects`，`activate` 后被清除。`tests/260902001-all-commands-fugr-e2e/summary.md` 已知限制 L-5 关闭。

- **`inspect --activation` 给 OO 类 `source/main` part 加 SAP 语义注释**：`ActivationPart` 新增可选 `note` 字段；OO 类（`CLAS/OC`、`INTF/OI`）的 `source/main` 是 SAP 系统生成的 INCLUDE 程序，其 active 版本由服务端重生成（lowercase、`create private .`、合成 section 头），字节永远不与用户写入的 latest 一致——这是 SAP 端语义而非 CLI 缺陷。带 `note` 的 part 不应驱动 agent 决策（不应据此触发 `abap activate`），仍以 `ok` 字段（基于 `definitions` / `implementations` / `testclasses` / `macros` 的 active 一致性）为权威。`wiki/commands/inspect.md` 同步增补说明。

### Tests
- `test/unit/dumps-feed.test.ts` — 9 cases（`$top`/`$filter` query 构造、请求形态断言、Atom feed 解析、空 feed）。
- `test/unit/abapLanguageVersion.test.ts` — 3 cases（cloud / on-prem / standard fallback）。
- `test/unit/doma-fixedValues-roundtrip.test.ts` — 5 cases（empty / single / multi-lang / special chars / nested `format.fixedValues`）。
- `test/unit/type-alias-sicf-http.test.ts` — 5 cases（uppercase / lowercase / subtype suffix / HTTP passthrough / unknown passthrough）。
- `test/unit/fugr-fixPointArithmetic-default.test.ts` — 3 cases（mock 三态：true / false / 缺字段默认 false）。
- `test/unit/mock-activate-doctor-parity.test.ts` — 4 cases（discovery endpoint 形态 + Atom 命名空间 + `/sap/bc/adt/icf/` collection；inactiveobjects 空列表 + create 后出现 + activate 后清除；fixture `ZCL_DEMO` 默认 active 不会被误报）。
- `test/unit/deploy-bundled-source-dir.test.ts` — 2 cases（默认捆绑目录存在且含 ICF handler 源码；`extension deploy` 不再因相对深度错误而静默 no-op）。
- `test/unit/tabl-ddl-extended.test.ts` — 5 cases（`.INCLUDE WITH SUFFIX` / 复合 key / 行内 foreign key / `@ClientHandling.type` / canonical deliveryClass + inline semantics）。
- `test/unit/push-ddic.test.ts` — 新增 3 cases（TABL 三件套 push 合并 DDL / STRU 三件套 push 缺 settings 不报错 / 残缺 DDL → `TABL_DDL_INVALID`）。
- `test/unit/inspect-activation.test.ts` — 新增 2 cases（OO 类 `main` part 必带 SAP-managed INCLUDE note；PROG `main` 不带 note）。
- `test/unit/types-registry.test.ts` — 8 cases（10 类全覆盖 / ADT vs ICF 路由 / `createObjtypeFor` 4 源对象 / `folderFor` 大小写 + 子类型 suffix / legacy alias 一致性 / `TYPE_REGISTRY` 与 helpers 无漂移）。
- `test/unit/dtel-typeRef.test.ts` — 12 cases（wire `typeRef` → local `dataTypeInformation` / 保留 `referencedTypeName` / 空 `typeName` 不写 / `localToWire` 反向 / 嵌套 vs 扁平 local 输入 / round-trip 保真 / AC3 未知 category 抛 `DTEL_CATEGORY_UNSUPPORTED` + message 含 3 个合法 category / 三个合法 category 不抛错 / 旧 flat shape 兼容）。
- `test/unit/doma-format-flags.test.ts` — 13 cases（AC1 wire signFlag `'X'` → local `format.signFlag` / AC2 空串保留 / AC3 convExit 落盘 / 仅一个字段时仍写 format / localToWire 嵌套 + 扁平 fallback / 空串 round-trip / QUAN + CHAR + lowercase 三种典型组合）。
- `test/unit/prog-subtype-include.test.ts` — 6 cases（PROG/I `programType: 'I'` → `*.prog.include.abap` / JSON `generalInformation.programType: 'include'` / real-SAP `objectType: 'PROG/I'` 单独触发子路由 / PROG executable 走 main 路径回归 / module pool + subroutine pool 不走 include 路径 / CLAS 不受影响回归）。
- `test/unit/http-service-id.test.ts` — 10 cases（wire `serviceId` → nested `generalInformation.serviceId` / `descriptionByLang[]` → nested `header.descriptionByLang[]` / 空数组省略 / 老对象无字段省略 / 反向 `localToWire` 嵌套 + 扁平 fallback / 缺省省略 / round-trip 保真）。
- `test/unit/http-json-map.test.ts` — 更新（`localToWire` 输出断言改嵌套 wire；`wireToLocal` 输入改嵌套 GET 形态；新增 transport 信封 case）。
- `test/unit/http-create.test.ts` / `test/unit/http-push.test.ts` — 更新（POST body 断言改嵌套 `header` / `generalInformation`）。
- `test/unit/http-pull.test.ts` — mock GET data 改真实 SAP 嵌套形态（无 `name`，pull 注入对象名）。
- `test/unit/http-create-skeleton.test.ts` — 更新 1 case（骨架含 `name`）。
- `test/unit/http-create-skeleton.test.ts` — 5 cases（`create HTTP` 无 `--file` 落骨架 / 不调 SAP / 已有文件 `OVERWRITE_REQUIRED` / `--description` 缺省时空串 / HTTP 骨架路径 `src/http/<name>/<name>.http.json` 类型子目录）。
- `test/unit/textpool-multilang.test.ts` — 9 cases（CLAS texts + headings + selections-soft-warn / INTF texts + headings / FUGR texts + 2 warnings / TABL 三 3 类 / STRU texts + 2 warnings / `--type` 必需 / `--include-tests --textpool` 组合）。
- `test/unit/textpool-cli.test.ts` — 更新 1 case（PROG pull 显式 `--type PROG`；US12 移除 PROG 默认后回归）。
- `test/mock-adt/server.js` — 新增 ZIF_DEMO / ZFG_DEMO / ZTB_DEMO / ZST_DEMO 4 类对象 addObject + 9 个 textpoolStore fixture（CLAS: symbols+headings, INTF: symbols+headings, FUGR: symbols, TABL: 3 类, STRU: symbols）。
- `test/unit/ddic-json-map.test.ts` — 更新 3 cases（DOMA localToWire 增加「嵌套 `format.*`」 case；round-trip 改为 nested string shape）。
- `test/unit/ddic-create.test.ts` — 更新 1 case（DOMA create payload 用嵌套 `format.*` + 字符串值）。
- `test/unit/ddic-pull.test.ts` — 更新 2 case（mock wire 用字符串 `'X'`/`''`；local 断言移到 `format.*`）。
- `test/unit/schema.test.ts` — 更新 1 case（`create --schema` `allowedValues` 由 4 个源对象升级为 10 类）。
- 基线：1000 → 1089 测试，1087/1089 通过（+1 case：HTTP create 骨架含 `name`）；2 个失败均为既有（`skill-bundle` 审计与 `deploy-dryrun` ERR_DLOPEN_FAILED），不在本次范围。
- tsc: 0 错误。

### Pending (未完成)

- Phase 4（US1-US13）已全部关闭。Phase 5 收口中：
- 真实 SAP（vhcala4hci:50000，已恢复可达）T059 端到端：9 类可写对象 `create → pull → push → pull` 字节级零差异通过（CLAS/INTF/PROG/FUGR/DOMA/DTEL/TABL/STRU + 本会话补上 HTTP）；TRAN 按设计只读（GET only，`POST/PUT` 501）。
- 剩余收尾：T063 `wiki/abap-file-format-export.md`「Resolved gaps」、T064 `wiki/objects/` 已知坑补 HTTP US10 缺口、T065 `wiki/object-types.md` `allowedValues`。
- HTTP US10 `serviceId` / `descriptionByLang[]` 真实 SAP 闭环依赖 ABAP 端结构扩展（0.5.0 不含）→ 建议独立 US 跟进。

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