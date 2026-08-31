---
type: reference
title: ADT 前台控制器与发现矩阵 — SAP S/4HANA 2023 SP02
description: /sap/bc/adt 的前台控制器 CL_ADT_WB_RES_APP 职责，以及 SAP S/4HANA 2023 SP02（kernel 793 / NW 7.58 / HDB 2.0）discovery 暴露的 workspace × collection 矩阵
tags: [abap, adt, sadt, discovery, rest, reference, s4h, s-4hana, 2023]
created at: 2026-08-29 12:30:00
changed at: 2026-08-31 21:56:00
---

# ADT 前台控制器与发现矩阵 — SAP S/4HANA 2023 SP02

> 姊妹页：[ECC 6.0 EHP7](adt-front-controller-ecc-ehp7.md)（Oracle, kernel 753 / NW 7.40）、[S/4HANA 2022 SP01](adt-front-controller-s4h-2022.md)（kernel 789 / NW 7.57 / HDB 2.0）。ADT 路由模型一致，区别集中在 § 二 的 workspace 数与 collection 详情。

## 适用 SAP 版本

本节内容基于下述实机探测得出，写法已锁定到该版本族：

| 字段 | 值 | 解读 |
|---|---|---|
| SAP 系统 | S/4HANA 2023 (on-premise) | Application Server ABAP 7.58 之上 |
| 内核 | `KernelRelease=793`, `KernelPatchLevel=101`, 编译 `2024-08-02` | S/4HANA 2023 FPS00 通道 |
| 数据库 | HDB `2.00.075.00.x`（`x` 占位 build hash），schema `<SCHEMA>` | HANA 2.0 SPS07 patch 75 |
| 组件发布 | `S4FND 108 SP02` / `SAP_BASIS 758 SP02` / `SAP_ABA 75I SP02` / `SAP_GWFND 758 SP02` / `SAP_UI 758 SP02` / `MDG_FND 808 SP02` / `ST-PI 740 SP28` | 标砖 S/4HANA 2023 + SPS02 栈 |
| 系统标识 | SID=`<SID>`，系统号与主机名按需查 ADT `/system/information` | 开发沙盒系统 |
| 通讯客户端 | ADT HTTP, Accept `application/atomsvc+xml` | 标准 ADT discovery 流 |

**兼容性提示**：S/4HANA 2022 (NW 7.57) / S/4HANA 2021 (NW 7.56) 应当有 95% 以上一致；更老或更到 S/4HANA Cloud Public 的工作区集会有差异（Cloud 通常少 `API Management`、多 `Release Management` 类），不在此页适用范围内。

## 数据采集方式（如何复现）

```bash
# 凭据：abap CLI 走 .abap.json / OS keychain，不直接传 username:password。
# 这里用 \$ABAP_USER / \$ABAP_PASSWORD 占位，URL/host 也请用本地 profile。
# 推荐改写：  abap inspect --type CLAS --name cl_adt_wb_res_app pull  > source.abap
#                    # 或直接从 .abap.json 取 url 后手工 curl

# 1. 类源码（前台控制器本体）
USR="\${ABAP_USER:-<user>}"  PW="\${ABAP_PASSWORD:-<password>}"
HOST="\${ABAP_URL:-http://<host>:50000}"
curl -s -u "$USR:$PW" \
  "${HOST}/sap/bc/adt/oo/classes/cl_adt_wb_res_app/source/main?sap-client=001" \
  -o tmp/s4h/cls/zcl_adt_wb_res_app.prog.abap

# 2. 系统信息（kernel/release/DB）
curl -s -u "$USR:$PW" \
  -H "Accept: application/atom+xml;type=feed" \
  "${HOST}/sap/bc/adt/system/information?sap-client=001" \
  -o tmp/s4h/system-info.xml

# 3. 已装组件（SID/组件/SAP_BASIS 版本）
curl -s -u "$USR:$PW" \
  -H "Accept: application/atom+xml;type=feed" \
  "${HOST}/sap/bc/adt/system/components?sap-client=001" \
  -o tmp/s4h/components.xml

# 4. ADT 服务清单（workspace × collection 矩阵）
curl -s -u "$USR:$PW" \
  -H "Accept: application/atomsvc+xml" \
  "${HOST}/sap/bc/adt/discovery?sap-client=001" \
  -o tmp/s4h/adt-discovery.xml
```

不能在 S/4HANA 1909 之前复现，部分 endpoint（`apireleases`、`debugger` 部分次级路径）在 NW 7.51 之前不存在。

## 一、`CL_ADT_WB_RES_APP` 本体 — 它是什么 / 不做什么

**一句话**：这是 ADT 的前台控制器（Front Controller），挂在 ICF 服务 `/sap/bc/adt` 上，实现 `IF_HTTP_EXTENSION`。**它本身不实现任何"业务"端点**，只把每个 HTTP 请求按规则分发给下游资源处理器。

### 1.1 类的关键事实

| 属性 | 值 | 含义 |
|---|---|---|
| `interfaces` | `IF_HTTP_EXTENSION`, `IF_OAUTH2_CONSUMER` | 作为 ICF handler 注册到 `/sap/bc/adt`；声明 OAuth2 资源服务器身份 |
| `co_service_path` | `/sap/bc/adt` | ICF HTTP 路径 |
| `co_service_name` | `ADT_0001` | Gateway 服务名（IWSV/IWSG），TADIR `R3TR IWSG ADT_0001` |
| `co_rfc_destination_none` | `NONE` | 默认本地处理（与跨系统 RPC 相对） |
| TADIR 锚点 | `R3TR IWSG ADT_0001` | 此对象**不是 SICF 节点**，无法用本仓库 `ZCL_ABAP_VIBE_ICF` 枚举 |
| 实例化方式 | `CLASS_CONSTRUCTOR` 一次性建 `LCL_BADI_SAFE_MODE` 与 `LCL_DEVELOP_AUTHORITY_CHECKER` | 单例 |

### 1.2 请求分发矩阵（`IF_HTTP_EXTENSION~HANDLE_REQUEST` 实际控制流）

进入分发前，先做 `suppress_content_type`（避免 ICF 默认写 `text/html`），再 `configure_session_state` 看响应头 `X-sap-adt-sessiontype` 决定是否进入 stateful 会话。

| # | 判定条件（顺序） | 命中处理 | 实现类 |
|---|---|---|---|
| 1 | URI 形如 `/sap/bc/adt;o=<alias>/...` | **跨系统路由** — RFC 转发到该 alias 对应的远程 ADT 实例；先做 `S_SERVICE` 授权（`8B7F73C6E2B8EE310117CBC0555D11` / `HT`） | `LCL_RFC_REQUEST_PROXY_FES` |
| 2 | 请求头 `sap-adt-server-instance` ≠ 本机实例名 | **调试器路由** — 把请求 forward 到目标应用服务器 | `LCL_RFC_REQUEST_PROXY_DBG` |
| 3 | 请求头 `X-adt-runtime-tracing` 非空 | **跟踪路由** — 通过 RFC 跟踪 | `LCL_RFC_REQUEST_PROXY_TRC` |
| 4 | 以上都不命中 | **本地 HTTP** — 交给 SADT REST 框架处理 | `LCL_HTTP_REQUEST_PROXY` → `CL_REST_HTTP_HANDLER` |

### 1.3 它到底"提供"哪些可观察的功能

按职责归类（与"实现哪个 endpoint"无关——它不实现 endpoint，只支撑 endpoint 注册与安全）：

| 职责 | 实现 |
|---|---|
| **请求计时** | `GET RUN TIME`；响应头 `X-CPIDEV-Profiling` 携带 `serverTime=N` |
| **会话模式切换** | 响应头 `X-sap-adt-sessiontype: stateful/stateless` 控制 ICM 会话；`sap-adt-softstate: true` 标记 transient |
| **CSRF Token** | GET + `X-CSRF-Token: fetch` 时强制 `Cache-Control: no-store / Pragma: no-cache / Expires: -1` |
| **ICM 缓存** | 请求头 `sap-cache-control: N` 允许资源自管 N 秒缓存；默认全程不缓存 |
| **开发者授权** | `CHECK_DEVELOP_AUTHORIZATION` → `S_ADT_RES` 对象，按 URI 字符串授权 |
| **资源授权** | `AUTHORITY-CHECK OBJECT 'S_ADT_RES' ID 'URI' field <uri>` |
| **Start Authorization** | `CL_START_AUTH_CHECK` —— 后台作业访问 ADT 时的对象级启动授权（按 SADT 对象类型） |
| **系统别名解析** | `SYSTEM_ALIASES_FOR_ADT_SERVICE` —— 从 Gateway 拉当前用户在 ADT 服务上注册的别名；唯一 default → 隐式路由 |
| **OAuth2 资源标识** | `IF_OAUTH2_CONSUMER~PROVIDE_TADIR_KEY_FOR_REQUEST` → `R3TR IWSG ADT_0001` |
| **服务组发现** | `FIND_SADT_SERVICE_GROUP` —— URI 前缀 → 表 `SADT_SRVC_GRP_U` 反查所属服务组 |
| **异常归一** | 任何 `CX_ADT_REST` → `LCL_EXCEPTION_RESPONSE~CREATE` 输出统一 ADT 异常 XML envelope |

更详细内容阅读 `CL_ADT_WB_RES_APP` 源码（641 行，仓库临时目录 `tmp/s4h/cls/`，非 git 资产——需本地按上文 curl 拉取）。

## 二、它"挂"了什么 — 本系统 ADT discovery 全清单

通过 `GET /sap/bc/adt/discovery`（标准 `application/atomsvc+xml` 服务文档）拿到 **80 个 workspace / 763 个 collection**。按主题分簇后：

### 2.1 核心开发（CLI 已经覆盖的）

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| ABAP Source | 12 | `/sap/bc/adt/programs/...`, `/sap/bc/adt/oo/...` |
| Programs | 5 | `/sap/bc/adt/programs/programs/<...>` |
| Classes and Interfaces | 4 | `/sap/bc/adt/oo/classes/<...>` & `/interfaces/<...>` |
| Function Groups; Functions; Function Group Includes | 2 | `/sap/bc/adt/fugr/...` |
| Message Classes | 2 | `/sap/bc/adt/mess/...` |
| Function Groups / Includes | 2 | （同 Function Groups） |
| Texts | 6 | `/sap/bc/adt/texts/...` |
| Text Elements | 3 | `/sap/bc/adt/programs/textelements/...` |
| ABAP Source Based Dictionary | 2 | `/sap/bc/adt/sbds/...` |
| Refactorings | 2 | `/sap/bc/adt/refactorings/...` |
| Quickfixes | 1 | `/sap/bc/adt/quickfixes` |
| Enhancements (SPDD / SPAU) | 11 | `/sap/bc/adt/enhancements/...` |

### 2.2 DDIC 与 CDS（ICF 三件套已覆盖 TABL/STRU/DOMA/DTEL）

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| Dictionary | 64 | `/sap/bc/adt/dictionary/<entity>/<name>`，覆盖表/结构/视图/域/数据元素等 |
| ABAP DDL Sources | 18 | `/sap/bc/adt/ddl/...` —— CDS 视图 |
| ABAP DCL Sources | 6 | `/sap/bc/adt/dcl/...` —— CDS 访问控制 |
| CDS Annotation Definitions | 5 | `/sap/bc/adt/cdsannotationdef/...` |
| CDS Metadata Extensions | 4 | `/sap/bc/adt/cdsmetadatadextension/...` |
| Service Definitions | 6 | `/sap/bc/adt/srvd/...` |
| Service Binding Types | 3 | `/sap/bc/adt/srvb/...` |
| Schema Definitions | 2 | `/sap/bc/adt/schemadef/...` |
| Type Groups | 2 | `/sap/bc/adt/typegroups/...` |
| Lock Objects | 4 | `/sap/bc/adt/locks/...` |
| Entity Buffers | 6 | `/sap/bc/adt/dictionary/entitybuffers/...` |
| ABAP Database Procedure Proxies | 2 | `/sap/bc/adt/amdpproxy/...` |
| ABAP External Views | 2 | `/sap/bc/adt/externalview/...` |
| Scalar Functions | 1 | `/sap/bc/adt/dictionary/scalarfunctions/...` |

### 2.3 包 / 传输 / 对象元数据

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| Package | 3 | `/sap/bc/adt/packages/...` |
| Repository Information | 33 | `/sap/bc/adt/repository/informationsystem/...`（搜索、对象类型、where-used、命名映射等） |
| Relation Explorer | 4 | `/sap/bc/adt/relationexplorer/...` |
| Object Type Administration | 9 | `/sap/bc/adt/objecttypes/...` |
| SAP Object Type Management | 10 | `/sap/bc/adt/sapobjecttypes/...` |
| URI Fragment Mapper | 1 | `/sap/bc/adt/urifragment/...` |
| Basic Object Properties | 1 | `/sap/bc/adt/properties/...` |
| Activation | 6 | `/sap/bc/adt/activation/...` |
| Deletion | 2 | `/sap/bc/adt/deletion/...` |
| Switch Framework | 8 | `/sap/bc/adt/switch/...` |
| Number Range Management | 5 | `/sap/bc/adt/numberranges/...` |
| Lifecycle Management | 3 | `/sap/bc/adt/lifecycle_management/...` |
| Function Groups ... | 2 | — |

### 2.4 运行 / 调试 / 质量

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| Debugger | 15 | `/sap/bc/adt/debugger/...` |
| AMDP Debugger for ADT | 1 | `/sap/bc/adt/amdp/debugger/...` |
| ABAP Profiler | 8 | `/sap/bc/adt/profiler/...` |
| Performance Trace | 2 | `/sap/bc/adt/perftrace/...` |
| ABAP Cross Trace | 5 | `/sap/bc/adt/crosstrace/...` |
| ABAP Unit | 3 | `/sap/bc/adt/abapunit/...` |
| ABAP Test Cockpit (ATC) | 25 | `/sap/bc/adt/atc/...` |
| Test Double Framework | 3 | `/sap/bc/adt/tdf/...` |
| SQLM Marker | 1 | `/sap/bc/adt/sqlm/...` |
| Dynamic Logpoints | 3 | `/sap/bc/adt/dlp/...` |
| Transformation | 1 | `/sap/bc/adt/xslt/transformations` |

### 2.5 业务建模 / 业务流程 / 服务

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| BOPF | 13 | `/sap/bc/adt/bopf/businessobjects/...` |
| Business Services | 33 | `/sap/bc/adt/businessservices/...` |
| Business Configuration Management | 10 | `/sap/bc/adt/businessconfiguration/...` |
| Application Jobs | 10 | `/sap/bc/adt/applicationjobs/...` |
| Custom Analytical Queries | 1 | `/sap/bc/adt/caq/...` |
| Enterprise Services | 20 | `/sap/bc/adt/enterprise/...` |

### 2.6 CTS / 扩展性 / API 管理

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| Change and Transport System | 7 | `/sap/bc/adt/cts/...` |
| Adaption Transport Organizer (ATO) | 2 | `/sap/bc/adt/ato/...` |
| API Management | 56 | `/sap/bc/adt/apim/...` |
| API Releases | 1 | `/sap/bc/adt/apireleases`（注：本系统该路径返回 500 / NULL deref） |
| Extensibility | 10 | `/sap/bc/adt/extensibility/...` |
| Annotation Pushdown | 4 | `/sap/bc/adt/annotationpushdown/...` |
| Annotation Pushdown: Get Meta Data Extensions | 1 | `/sap/bc/adt/annotationpushdown/metadextentions/...` |
| CDS Annotation Related ADT Resource | 2 | `/sap/bc/adt/cdsannotation/...` |

### 2.7 HANA / 数据 / 元数据

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| HANA-Integration | 6 | `/sap/bc/adt/hana/...` |
| HDI Namespace | 12 | `/sap/bc/adt/hdi/...` |
| Schema Definitions | 2 | （同 2.2） |
| Dependency Rules | 2 | `/sap/bc/adt/dependencyrules/...` |
| Dynamic View Caches | 3 | `/sap/bc/adt/dynamicviewcaches/...` |

### 2.8 UI / 报表 / 浏览器集成

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| UI Flexibility | 1 | `/sap/bc/adt/uiflex/...` |
| ABAP SAPUI5 Filestore | 3 | `/sap/bc/adt/filestore/ui5-bsp/...` |
| Web Dynpro | 27 | `/sap/bc/adt/wd/...` |
| Floor Plan Manager | 1 | `/sap/bc/adt/fpm/...` |
| Navigation | 2 | `/sap/bc/adt/navigation/...` |
| Task handler integration | 1 | `/sap/bc/adt/taskhandlers/...` |

### 2.9 系统 / 平台 / 其他

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| Connectivity | 20 | `/sap/bc/adt/connectivity/...` |
| System Information | 2 | `/sap/bc/adt/system/information`, `/components` |
| System Landscape | 1 | `/sap/bc/adt/system/landscape/servers` |
| Client | 1 | `/sap/bc/adt/system/clients` |
| User | 1 | `/sap/bc/adt/system/users` |
| Feed Repository | 3 | `/sap/bc/adt/feed/...` |
| Change Document Management | 5 | `/sap/bc/adt/changedocumentmanagement/...` |
| Object Classification System | 1 | `/sap/bc/adt/objectclassification/...` |
| Data Preview | 5 | `/sap/bc/adt/datapreview/...` |
| Reentranceticket | 1 | `/sap/bc/adt/reentranceticket/...` |
| External tools configuration | 2 | `/sap/bc/adt/externaltools/...` |
| VIT URI Mapping | 1 | `/sap/bc/adt/vituri/...` |
| ADT Resource | 2 | `/sap/bc/adt/resourcediscovery/...` |
| ADT Rest Framework Resources | 2 | `/sap/bc/adt/resdiscovery/...`（本系统未部署 resdiscovery servlet，返 404） |
| ABAP Dictionary Logs | 1 | `/sap/bc/adt/dictionary/logs` |
| Test CodeGeneration for CDS | 2 | `/sap/bc/adt/cds/testcodegen/...` |
| CDS Type | 1 | `/sap/bc/adt/cdstype/...` |
| Dummy object types (unit tests) | 5 | `/sap/bc/adt/dummyobjecttypes/...` |
| ABAP Language Help | 1 | `/sap/bc/adt/docu/abap/langu` |
| Business Logic Extensions | 2 | `/sap/bc/adt/businesslogicext/...` |
| Others（兜底） | 45 | 跨学科/产品特定 |

`grep '^===' tmp/s4h/discovery-summary.txt` 可得到全部 80 个 workspace 行；完整明细见 `tmp/s4h/discovery-summary.txt`（仓库临时目录，非 git 资产——按上文脚本生成）。

## 三、对本仓库 CLI 的可用 / 不可用关系

### 3.1 可经 ADT 直接走的（CLI 已用）

- CLAS / INTF / PROG / FUGR —— 通过 `abap-adt-api` 调 `/sap/bc/adt/oo/...`、`/sap/bc/adt/programs/...`、`/sap/bc/adt/fugr/...`
- FUGR includes（含 PROG includes）
- Message Class（FUGR 子资源）

### 3.2 不能直接走 ADT、要先 `abap extension deploy` 的（CLI 走 ICF）

- DDIC 三件套：TABL / STRU / DOMA / DTEL —— 自建 ICF `/sap/zabap_vibe/dictionary/...`
- textpool / text elements —— 自建 ICF `/sap/zabap_vibe/textpool/...`
- select（只读）、run（classrun）、tcode 解析 —— 自建 ICF
- HTTP (SICF node) —— 自建 ICF `/sap/zabap_vibe/http/...`，对应 `--type HTTP`

### 3.3 ADT 已暴露但 CLI 暂未覆盖（按主题列出潜在扩展）

- **DDIC 高级**：DDLS（CDS 视图源）、DCLS（CDS 访问控制）、SrvD / SrvB / Type Groups / Lock Objects / External View
- **CTS 自动化**：Workbench/运输请求完整 7 个 collection（[transport 命令已部分覆盖](commands/transport.md)）
- **质量**：ATC（25 collection），可走 ADT 直接开 run；`check atc` 也能用
- **调试**：Debugger 15 个 collection，`run` 之外可以加 `debugger` 子命令
- **搜索/Inspect 高级**：Repository Information 33 个 collection（当前只用到 `search`、`whereused`、`executableObjects` 一类）

完整 ADT 容量矩阵（CLI ↔ 系统暴露度）见 `tmp/s4h/discovery-summary.txt`（仓库临时目录，非 git 资产）。CLI 当前实际覆盖度参见 [object-types.md](object-types.md)。

# More

## todo

- [ ] 写一个 `tmp/s4h/refresh-discovery.sh` 一键拉 discovery / system / components 到本地
- [ ] 上文 "CLI 已覆盖 vs 系统暴露" 矩阵列入 roadmap，按 workspace 触发 skill 路由
- [ ] 该页 version 适用范围（仅 S/4HANA 2023 SP02）需在文首"导出体检"时提示

# references

- 服务文档 `/sap/bc/adt/discovery` —— w3c App service (`application/atomsvc+xml`)
- ICF 节点 `/sap/bc/adt`，TADIR `R3TR IWSG ADT_0001`，handler `CL_ADT_WB_RES_APP`
- `CL_ADT_WB_RES_APP` 源码：见 `tmp/s4h/cls/zcl_adt_wb_res_app.prog.abap`（仓库临时目录，非 git 资产——按上文 curl 脚本生成）
- ADT 服务清单：见 `tmp/s4h/discovery-summary.txt`（同上）
- 系统信息：见 `tmp/s4h/system-info.xml`（同上）
- 组件发布：见 `tmp/s4h/components.xml`（同上）
- 原始 service document：见 `tmp/s4h/adt-discovery.xml`（同上）
- 姊妹页 [ECC 6.0 EHP7](adt-front-controller-ecc-ehp7.md)、[S/4HANA 2022 SP01](adt-front-controller-s4h-2022.md)
