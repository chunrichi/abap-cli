# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/)；版本号遵循 [Semantic Versioning](https://semver.org/)。
`Added` / `Changed` / `Removed` / `Fixed` / `Security` 按版本分组。Breaking 变更在 `Removed` 标记并附 Migration。
更老的展开内容归档于 `docs/CHANGELOG-history.md`。

## [0.2.6] - 2026-09-06

### Added
- **REPS / FUNC AFF schema vendor**：新增 `src/abap_cli/schema/{reps,func}-v1.json` 两份 vendored schema（与 `fugr-v1.json` 一起从 SAP 上游 `fugr/` 目录同步），覆盖 FUGR 拉取时的 `.reps.json` 与 `.func.json` 写盘校验。`aff/schema-paths.ts` 的 `SCHEMA_FILE` 表相应扩展，`router.ts` 早已识别 `.reps.json` / `.func.json` 后缀，所以二者联动后立刻生效。`scripts/sync-aff-schema.sh` 同步列表同步增加两份。
- **`aff/assert-metadata.ts`**：单一 `assertAffMetadata(type, doc, { schemaFile?, context? })` 抛 `CliError('AFF_FIXTURE_INVALID', …)`，取代此前 `pull-fugr` / `msag` / `ddls` / `ttyp` 等模块各自手写的「validate + 格式化 + throw」组合。所有 `.json` 写盘前必经此门。
- **FUNC pseudo-syntax 解析**：新建 `src/abap_cli/formats/func-pseudo.ts`：`parseFuncPseudoSyntax(content)` 同时识别 SAP 原生 `*"  IMPORTING` 注释块与 AFF canonical `IMPORTING foo TYPE i.` 形式；`toCanonicalFuncSource(content, fallbackName)` 把任意 SAP 源 round-trip 成 canonical；`componentsFromFuncSections(sections, sectionName)` 给 `.func.json` 提取 `{ name, description }` 列表。CRLF / BOM 自动规范化。
- **ObjectMetadata 抓取字段扩展**：`ObjectMetadata` interface 从 5 个字段扩到 19 个——`programStatus` / `fixPointArithmetic` / `editLocked` / `startsUsingVariant` / `authorizationGroup` / `application` / `logicalDatabase` / `selectionScreen`（PROG），`category` / `proxy` / `messageClass` / `descriptions`（CLAS / INTF），以及 `sourceOrigin` / `sourceType`（CDS）。CLAS / INTF 额外调 `client.objectStructureElements` 抓 descriptions（types / attributes / events / methods 树），老版本 client 无此方法时优雅降级。
- **Phase 3 type extensions**：新增 `src/abap_cli/schema/{srvb,srvd,bdef,dcls,ddlx,ddla}-v1.json` 六份 vendored schema，`scripts/sync-aff-schema.sh` 同步列表同步增加。配套新增 `flows/edit/pull-{bdef,cds-extension,srvd}.ts` 与 `flows/edit/push-cds-extension.ts`，让 SRVB / SRVD / BDEF / DCLS / DDLX / DDLA 走与 FUGR 一致的 child-lock + activate 通道。

### Changed
- **`renderObjectMetadataJson` 扩展支持 CLAS / INTF / PROG 扩展字段**：按 primary type 分流——
  - PROG：`generalInformation` 增加 programStatus（SAP 原始值 S/C/X/T → enum）+ fixPointArithmetic / editLocked / startsUsingVariant / authorizationGroup / application；`logicalDatabase: { name, selectionScreen }` 嵌套对象在两字段任一非空时渲染。
  - CLAS：`category`（16 enum）+ fixPointArithmetic + messageClass + descriptions。
  - INTF：`category`（7 enum）+ proxy + descriptions。
  - `header.abapLanguageVersion` 只在 CLAS / INTF 渲染；PROG 类型不再携带此字段。
- **FUGR layout 重构**：旧 `enumerateFugr` 静默丢弃所有 FUGR/I 非 TOP include；新版保留 FXX / OXX / IXX 等所有非 TOP、非 UXX 的 include 进 `layout.includes[]`，由 `pull-fugr` 自行过滤 UXX。`FugrFunc` 扩展 12 字段（rfcProperties / updateProperties / releaseState / global / exceptionClasses / application / client / activeFunctionExit / notExecutable / editLocked / parameters / exceptions）。`readFuncIncludeNumbers` 支持 CRLF 双行 `INCLUDE L<group>U01.\r\n  "FM_NAME"` 形式（真实 SAP 行为）。`enumerateFugr` 新增 `requestedFunctionModule` 参数；`fugrPushTargetFor` 同步支持 FXX / OXX / IXX 各自 child lock target。新增 `isFugrTopInclude` / `isFugrUxxInclude` / `fugrFileToken` 三个 predicate。
- **FUGR pull 写 FXX / OXX / IXX 与 FUNC canonical**：`fugrStrategy()` 现在为每个非 TOP / 非 UXX include 生成 `<name>.fugr.<include>.reps.{abap,json}` 一对；每个 function module 生成 `<name>.fugr.<fm>.func.abap`（canonical pseudo syntax）与 `<name>.fugr.<fm>.func.json`（含 parameters / exceptions / processingType / includeNumber / releaseState / rfcProperties 等）。所有 `.json` 走 `assertAffMetadata` 写盘前校验。FUNC source 走 `sourceCache` 避免对同一 `sourceUrl` 重复 `getObjectSource`（一个 FM 只调一次）。
- **FUGR push 走 child lock + parent group activate + active/latest 核验**：`pushFugrOne` 锁定 sub-object（FM 或 include）而不是函数组本身；FM push 后通过 `client.activateAll([{uri, type: 'FUGR/FF', name, parentUri}])` 单独激活父组，再 `Promise.all([getObjectSource(latest), getActiveObjectSource(active)])` 比对确保 active 与 latest 一致；不一致抛 `ACTIVATION_FAILED` 而非返回虚假 success。`.func.abap` 写盘前自动 `toCanonicalFuncSource(content, fmName)` 规范化。dry-run 仍走 stage plan 不发任何请求。

### Fixed
- **FUGR pull 静默丢弃 FXX / OXX / IXX include**：原 `enumerateFugr` 只保留 `L<group>TOP`，所有 `L<group>F01` / `O01` / `I01` 等子 include 直接被丢弃，导致 agent vibe coding FUGR 对象时 SAP 端功能丢失。FUGR layout 重构 + FUGR pull 写 FXX/OXX/IXX 修复——拉取时每个非 UXX include 落地为 `.reps.{abap,json}` 对。
- **CLAS / INTF / PROG metadata 14 个字段静默丢失**：原 `ObjectMetadata` 只抓 5 个字段，programStatus / fixPointArithmetic / category / descriptions / messageClass / proxy 等在 round-trip 时全部掉，SAP 端用默认值补全，掩盖 bug。抓取与渲染双向补齐。
- **FUNC 接口 parameters / exceptions 静默丢失**：原 pull 仅生成 `.func.abap`，没有 `.func.json` 携带 schema-required 的 interface components。FUGR pull 写 FUNC canonical 修复——`.func.json` 走 `componentsFromFuncSections` 解析 SAP 注释或 canonical 形式，提取 `{ name, description }` 列表。
- **UXX include CRLF 双行解析失败**：原 `readFuncIncludeNumbers` 只解析单行 `INCLUDE L<group>U01.  "FM_NAME`，真实 SAP 用 `INCLUDE L<group>U01.\r\n  "FM_NAME` 两行格式，解析失败导致 `includeNumber` 走兜底位置编号（潜在错配）。FUGR layout 重构修复——双行形式也支持。
- **FUGR push 返回虚假 activated**：原 `pushFugrOne` 仅调 `client.activate()` 后即返回 success，未核验 SAP 是否真的把源 commit 成 active；agent 拿到「成功」结果后发现 SAP 端仍是 inactive，需要手动重试。FUGR push child lock + verify 修复——`activateAll` 后比对 latest 与 active source，不一致抛 `ACTIVATION_FAILED`。

### Removed (breaking)
- **`abap extension` / `abap extension deploy` / `abap extension status` 命令组**：删除 `src/abap_cli/commands/extension.ts` 与 `wiki/commands/extension.md`；顶层命令统一为 `abap deploy` 与 `abap deploy status`（后者为 `deploy` 的子命令）。`flows/setup/command-schemas.ts` 的 schema key 同步从 `extension` 重命名为 `deploy`。**Migration**：把所有脚本 / 文档 / 命令提示里的 `abap extension deploy --yes` 改成 `abap deploy --yes`，`abap extension status` 改成 `abap deploy status`；内部 `ICF_OUTDATED_DEADLOCK` warning 的 `nextSteps` 文本已同步更新。
- **`ObjectMetadata` 字段形状扩展（breaking for 直接消费该结构的代码）**：`header.abapLanguageVersion` 在 PROG 类型不再渲染；CLAS / INTF / PROG 各自新增多个字段（见 Added 节）。**Migration**：直接 `JSON.parse` 该结构的 agent 需扩展字段白名单；以 `--json` envelope 消费的 agent 无影响。
- **`enumerateFugr` 签名变化**：新增 `requestedFunctionModule?: string` 参数；返回 `layout.includes[]` 现在包含 FXX / OXX / IXX（之前会被丢弃）。**Migration**：自定义 FUGR 处理脚本需显式过滤 `UXX` include；以 CLI 拉取为入口的 agent 无影响。


## [0.2.5] - 2026-09-04

### Added
- **TTYP / MSAG / DDLS 三类型支持（`specs/036-ttyp-msag-ddls/`）**：`create` / `pull` / `push` 三个命令一次性接入表类型、消息类与 CDS 视图源，支持类型总数 10 → 13。TTYP 与 MSAG 走双通道（S/4HANA 与 ECC EHP7+ 用 ADT，ECC EHP5/6 自动降级 ICF）；DDLS 仅 ADT，旧内核直接硬错而不静默降级。新增 `flows/edit/channel-detect.ts`（纯函数通道判定 + `isEccOldRelease` + 进程内缓存 + `clearChannelCache()` 供测试）、`formats/{ttyp,msag,ddls}/json.ts` 三个 wire ↔ local 映射、`formats/ddls/acds.ts`（识别 `viewEntity` / `projectionView` / `tableFunction` / `viewEntityExtend` / `viewExtend` / `ddicBasedView` 等 CDS 形态）、`flows/edit/{pull,push}-{ttyp,msag,ddls}.ts` 六个流程模块。
- **envelope 新增 `data.channel` 与 `data.fallbackReason`**：三类型的 `pull` / `push` / `create` 都报告实际使用的通道（`"adt"` / `"icf"`）；走兜底时附 `ECC_EHP6_NO_ADT_TABLETYPE` 或 `ECC_EHP6_NO_ADT_MESSAGECLASS`，让 agent 无需猜测路径。
- **两个新错误码 + 保留区间退出码**：`DDLS_NOT_SUPPORTED_ON_ECC`（exit 64）与 `CHANNEL_DETECTION_FAILED`（exit 65）。两者都落在退出码保留区间（≥10）并在 `specs/012-unify-cli-output-contract/contracts/cli-output.md` §4 显式登记，CI 可直接按数值 grep 失败类型。
- **ICF 兜底 ABAP 实现**：新增 `zcl_abap_vibe_ttyp_format`（DD40V + DD42V → AFF JSON + `define type ...` DDL 侧车）与 `zcl_abap_vibe_msag_format`（T100A + T100 → AFF JSON，登录语言无译文时回退英语）；`zcl_abap_vibe_icf` 扩展 `/ddic/ttyp` 与 `/ddic/msag` 的 GET/POST/PUT handler，写路径走 SAP 标准 LUW（enqueue → 写 → activate → dequeue，dequeue 在所有退出路径都执行）。
- **自维护 `ttyp-v1.json` schema**：上游 abap-file-formats 没有 table-type schema（`type/type-v1.json` 是 type-pool），本项目手写并在文件头标注 handcrafted；MSAG / DDLS 复用上游 `msag-v1.json` / `ddls-v1.json`。
- **`profile test` 能力矩阵**：输出 `data.capabilities.{ttyp,msag,ddls}.{adt,icf,supported}` 与顶层 `data.ddlSourceSupported`，让 agent 在动手前就知道目标系统支持哪些类型。
- **三类型 fixture 与测试**：`test/fixtures/{ttyp,msag,ddls}/` 三份 canonical fixture 纳入 `npm run validate:aff` 门禁；新增 `channel-detect` 决策矩阵、三类型 round-trip、`.acds` 形态解析、pull/push 协调器路由与 ICF 兜底共 40+ vitest case。
- **GitHub Actions 自动发布 npm**（`.github/workflows/publish.yml`）：push `v*` tag 或 GitHub Release published 触发；`npm run verify`（build + 全量单测）通过后 `npm publish` 到官方源。走 npm Trusted Publishing（OIDC，免 token secret，需在 npmjs.com 把该 repo/workflow 登记为 trusted publisher；Node 24）。发布前用 `npm view` 探测目标版本，重复触发（tag + Release 同版本）自动跳过，不会重复发布。
- **AFF schema vendor 进仓库（`src/abap_cli/schema/`）**：把 0.2.4 依赖 `tmp/abap-file-formats/` 的 10 类 schema（11 个 JSON）+ 上游 MIT LICENSE 静态纳入仓库；`schema-paths.ts` 解析优先级改为 env (`ABAP_CLI_AFF_MIRROR`) → bundled → 遗留 `tmp/` 镜像。新增 `scripts/sync-aff-schema.sh [<sha>]` 升级脚本（只复制 `router.ts` 命中的 10 类型 + `tabt-v1.json`，自动重写 README 的上游 SHA 引用），以及 `scripts/copy-bundled-schema.mjs` 在 `npm run build` 末尾把 `src/abap_cli/schema/` 镜像到 `dist/`（确保 dist 与 published npm tarball 都自带 schema，不依赖 clone/postinstall）。CI 不再隐式依赖 `tmp/` 或 `postinstall` 网络克隆。

### Changed
- **`types/registry.ts` 增 3 类型**：TTYP / MSAG / DDLS 三条 `ObjectTypeEntry`，每条带 `channel: {icfFallback, eccSupported, fallbackReason?}`；随之 `folderFor()` 新增 `ttyp` / `msag` / `ddls` 三个子目录，`allSupportedTypes()` 与 `create --schema` 的 `allowedValues` 从 10 项变 13 项。
- **`push` 协调器路由顺序**：`.ttyp.json` / `.msag.json` / `.ddls.json` 与 DDIC 共用 `.json` 扩展名，因此在 `route === 'icf'` 分支**之前**被拦截并交给 `channel-detect`；`--atomic` 结构校验同样对这三类走各自的 AFF 校验函数而非 `readDdicJson`。
- **`PushStage` 增两个阶段值**：`channel-adt` 与 `channel-icf`，用于区分三类型实际落到哪条通道。
- **ICF 错误码透传**：TTYP / MSAG 的 ICF 兜底写路径不再把所有失败压成 `DDIC_CREATE_FAILED`，改为原样透传 handler 返回的错误码（`LOCK_FAILED` / `VALIDATION_ERROR` 等），退出码因此能正确反映失败类别。
- **`validate-aff` 对不存在目标的处理**：`collectJsonFiles` 遇到不存在的路径返回空列表而非抛 `ENOENT`，与「无文件可校验即通过」的门禁语义一致。

### Fixed
- **`profile test` 不持久化 `systemVersion`**（`src/abap_cli/clients/probe.ts`）：`probeCapabilities` 走 `readKernelRelease` 但返回值被丢弃，导致后续 `channel-detect` 永远拿不到 release 触发 `CHANNEL_DETECTION_FAILED`；改为把 release 透传到 `upsertSystem(name, { systemVersion })`，profile 自此首跑即可路由。
- **`readKernelRelease` 端点错**（同文件）：`/sap/bc/adt/discovery` 已经没有 `<app:release>` 标签；改读 `/sap/bc/adt/system/information`（Atom feed）的 `<atom:id>KernelRelease</atom:id>`，并补上必需的 `type=feed` Accept 修饰。
- **ADT DDIC 端点 `Accept: application/xml` 报 406**（`src/abap_cli/clients/adt-client.ts`）：TTYP / MSAG / DDLS 的 GET 与 PUT 端点 SAP 端不收 narrow content type，统一改为 `application/*` 通配，避开 content negotiation 失败。
- **DDLS `getDdls` 只返回 metadata envelope**（同文件）：`/sap/bc/adt/ddic/ddl/sources/<name>` 实际不带 inline `<ddl:ddlSourceString>`，显式补一次 `${baseUrl}/source/main` 拿真正的 DDL 源（`Accept: text/plain`）。
- **`validateLocalFile` 把 TTYP / MSAG / DDLS 误判为 `DDIC_NOT_SUPPORTED`**（`src/abap_cli/core/resolve.ts`）：`ICF_ROUTED_TYPES` 仅含 DOMA/DTEL/TABL/STRU + HTTP/TRAN，三类型没在内；新增 `VALIDATED_ROUTE_TYPES` = `ICF_ROUTED_TYPES ∪ ADT_ROUTED_TYPES`，让 `validateLocalFile` 通过、留给 `pushChannelRoutedFile` 路由。
- **`pull-{ttyp,msag,ddls}.ts#resolveRoot` 只认 `rootDir`**（3 文件）：`runPull` 协调器传的 `PullOptions.dir` 被忽略，pull 永远写到 workspace root 而非 `--dir` 指定路径；重载为 `(opts: { rootDir?; dir? })` 优先取 `rootDir` → `dir`。
- **`http-error.ts` 不解析 SAP `<exc:exception>` 信封**（同文件）：之前 `body?.message` 只匹配 JSON，遇到 SAP XML 异常时全部退化成固定字符串「Resource …: wrong input data for processing」；新增 `extractExcMessage` 从 `<message lang="EN">…</message>` 抽出真实文案，并把完整 body（截 400 字符）附到 `details.sapErrorBody`，让 agent 一眼看到 SAP 端究竟在报什么。
- **SAP 服务端 cookie 过期被误报 400 权限错误**（`src/abap_cli/clients/http-error.ts`）：reused cookie jar 的 `SAP_SESSIONID` 在 SAP 端被服务端踢下线后，SAP 返回 `400 Session Timed Out`（**不是** 401，也不是 XML envelope），abap-adt-api fallback 成 `AdtHttpException` 时把 body 丢光；CLI 看上去是 `Request failed with status code 400`，但其实是 session 失效。检测 `400 + /session\s+timed\s+out/i` → 改分类为 `AUTH_ERROR`，触发 `_call` 的 re-login fallback；非-Axios 分支同时把 body 从 `parent.response.body` 链上挖出来写入 `details.sapErrorBody`，避免后续真·SAP 异常也被误报为权限问题。

### Removed (breaking)
- **TTYP 不再报 `DDIC_NOT_SUPPORTED` / `TYPE_NOT_SUPPORTED`**：`pull ZX --type TTYP` 与 `create TTYP ZX --file ...` 以前被 DDIC 路由当作未支持类型拒绝，现在走 `channel-detect` 正常执行。迁移：依赖旧错误码做分支的脚本改为检查 `data.channel` 与新错误码（`DDLS_NOT_SUPPORTED_ON_ECC` / `CHANNEL_DETECTION_FAILED`）。


## [0.2.4] - 2026-09-03