---
type: reference
title: ADT 前台控制器与发现矩阵 — ECC 6.0 EHP7
description: /sap/bc/adt 的前台控制器 CL_ADT_WB_RES_APP 职责，以及 ECC 6.0 EHP7（kernel 753 / NW 7.40 / Oracle）discovery 暴露的 workspace × collection 矩阵
tags: [abap, adt, sadt, discovery, rest, reference, ecc, ehp7, nw740]
created at: 2026-08-31 21:34:00
changed at: 2026-08-31 21:56:00
---

# ADT 前台控制器与发现矩阵 — ECC 6.0 EHP7

> 姊妹页：[S/4HANA 2022 SP01](adt-front-controller-s4h-2022.md)（kernel 789 / NW 7.57 / HDB 2.0）、[S/4HANA 2023 SP02](adt-front-controller-s4h-2023.md)（kernel 793 / NW 7.58 / HDB 2.0）。ADT 路由模型一致，区别集中在 § 二 的 workspace 数与 collection 详情。

## 适用 SAP 版本

本节内容基于下述实机探测得出，写法已锁定到该版本族：

| 字段 | 值 | 解读 |
|---|---|---|
| SAP 系统 | ECC 6.0 EHP7 | `EA-APPL 617` 版本族 |
| 内核 | `KernelRelease=753`, `KernelPatchLevel=1610` | Linux optimized kernel |
| 数据库 | Oracle `19.21.0.0` | OCI database library |
| 组件发布 | `EA-APPL 617 SP26` / `SAP_BASIS 740 SP29` / `SAP_ABA 740 SP29` / `SAP_GWFND 740 SP30` / `SAP_UI 754 SP13` / `ST-PI 740 SP27` | ECC EHP7 + NW 7.40 栈 |
| 通讯客户端 | abap CLI 内置 ADT 客户端，Accept `application/atomsvc+xml` | 标准 ADT discovery 流 |
| 采集端点 | `/system/information`、`/system/components`、`/discovery` 均为 HTTP 200 | 仅调用标准只读 ADT 接口 |

**兼容性提示**：同为 ECC EHP7 的系统也会因已安装组件、support package、授权和激活状态而暴露不同 service document；不要将本页的 44/176 容量直接套用到其他系统。

## 数据采集方式（如何复现）

```bash
# 凭据：abap CLI 走 .abap.json / OS keychain，不直接传 username:password。
# 通过本地 profile 认证后，以结构化 XML 解析响应。

# 1. 前台控制器本体（source object）
abap inspect --type CLAS --name cl_adt_wb_res_app pull > source.abap

# 2. 系统信息（kernel / DB）
GET /sap/bc/adt/system/information
Accept: application/atom+xml;type=feed

# 3. 已装组件（EA-APPL / SAP_BASIS 版本）
GET /sap/bc/adt/system/components
Accept: application/atom+xml;type=feed

# 4. ADT 服务清单（workspace × collection 矩阵）
GET /sap/bc/adt/discovery
Accept: application/atomsvc+xml
```

采集时用 XML parser 解析 Atom/service document，不用正则抓取 XML；原始响应只应保存在 `tmp/`，不可提交 URL、账号、SID、client、cookie 或 token。

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
| 1 | URI 形如 `/sap/bc/adt;o=<alias>/...` | **跨系统路由** — RFC 转发到该 alias 对应的远程 ADT 实例；先做 `S_SERVICE` 授权 | `LCL_RFC_REQUEST_PROXY_FES` |
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

## 二、它"挂"了什么 — 本系统 ADT discovery 全清单

通过 `GET /sap/bc/adt/discovery`（标准 `application/atomsvc+xml` 服务文档）拿到 **44 个 workspace 节点 / 176 个 collection 节点**。其中 1 个 workspace 标题重复出现，按标题归并后为 43 个名称；以下按主题分簇，计数保持 service document 的原始 collection 数。

### 2.1 核心开发（CLI 已经覆盖的）

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| ABAP Source | 9 | `/sap/bc/adt/programs/...`, `/sap/bc/adt/oo/...` |
| Programs | 4 | `/sap/bc/adt/programs/...` |
| Classes and Interfaces | 5 | `/sap/bc/adt/oo/classes/...` & `/interfaces/...` |
| Function Groups; Functions; Function Group Includes | 2 | `/sap/bc/adt/fugr/...` |
| Message Classes | 2 | `/sap/bc/adt/mess/...` |
| Refactorings / Quickfixes | 2 | `/sap/bc/adt/refactorings/...`, `/sap/bc/adt/quickfixes` |
| ABAP Documentation / Language Help | 2 | `/sap/bc/adt/docu/...` |

### 2.2 DDIC 与 CDS（ICF 三件套已覆盖 TABL/STRU/DOMA/DTEL）

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| ABAP DDL Sources / DCL Sources | 11 | `/sap/bc/adt/ddl/...`, `/sap/bc/adt/dcl/...` |
| Type Groups | 2 | `/sap/bc/adt/typegroups/...` |
| ABAP Database Procedure Proxies | 2 | `/sap/bc/adt/amdpproxy/...` |
| ABAP External Views | 2 | `/sap/bc/adt/externalview/...` |

本系统虽然是 Oracle 上的 ECC EHP7，service document 仍广告 DDL、DCL、AMDP proxy 与 HANA-Integration collection。它们只是已注册资源；具体功能仍须按 collection、授权和后端能力验证。

### 2.3 包 / 传输 / 对象元数据

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| Packages | 1 | `/sap/bc/adt/packages/...` |
| Repository Information | 15 | `/sap/bc/adt/repository/informationsystem/...` |
| Generic WB repository object types | 4 | `/sap/bc/adt/wb/...` |
| Change and Transport System | 4 | `/sap/bc/adt/cts/...` |
| Activation | 4 | `/sap/bc/adt/activation/...` |
| URI Fragment Mapper | 1 | `/sap/bc/adt/urifragment/...` |

### 2.4 运行 / 调试 / 质量

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| Debugger | 7 | `/sap/bc/adt/debugger/...` |
| ABAP Profiler | 3 | `/sap/bc/adt/runtime/traces/...` |
| ABAP Unit | 1 | `/sap/bc/adt/abapunit/...` |
| ABAP Test Cockpit (ATC) | 8 | `/sap/bc/adt/atc/...` |
| SQLM Marker | 1 | `/sap/bc/adt/sqlm/...` |

### 2.5 业务建模 / 业务流程 / 服务

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| BOPF | 8 | `/sap/bc/adt/bopf/businessobjects/...` |
| Enterprise Services | 20 | `/sap/bc/adt/enterprise/...` |
| SAP Solution Manager Change Control Management | 4 | 产品特定 collection |
| Software Registration | 3 | 产品特定 collection |

### 2.6 CTS / 扩展性 / API 管理

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| Change and Transport System | 4 | `/sap/bc/adt/cts/...` |
| Generic WB repository object types（两节点） | 4 | `/sap/bc/adt/wb/...` |

与 S/4HANA sister pages 相比，本系统的 discovery 中没有 Dictionary、Service Definitions / Bindings、CDS metadata extensions、Extensibility、API Releases、ATO 或 Application Jobs workspace。

### 2.7 HANA / 数据 / 元数据

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| HANA-Integration | 4 | `/sap/bc/adt/hana/...` |
| Data Preview | 3 | `/sap/bc/adt/datapreview/...` |

### 2.8 UI / 报表 / 浏览器集成

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| UI Flexibility | 1 | `/sap/bc/adt/uiflex/...` |
| ABAP SAPUI5 Filestore | 3 | `/sap/bc/adt/filestore/ui5-bsp/...` |
| Web Dynpro | 27 | `/sap/bc/adt/wd/...` |
| Floor Plan Manager | 1 | `/sap/bc/adt/fpm/...` |
| Navigation | 1 | `/sap/bc/adt/navigation/...` |

### 2.9 系统 / 平台 / 其他

| Workspace | Collection 数 | 关键 path |
|---|---|---|
| System Information / Client / User | 4 | `/sap/bc/adt/system/...` |
| Feed Repository | 2 | `/sap/bc/adt/feed/...` |
| ADT Rest Framework Resources | 1 | `/sap/bc/adt/resdiscovery/...` |
| Reentranceticket | 1 | `/sap/bc/adt/reentranceticket/...` |

## 三、对本仓库 CLI 的可用 / 不可用关系

### 3.1 可经 ADT 直接走的（CLI 已用）

- CLAS / INTF / PROG / FUGR —— 通过 `abap-adt-api` 调 `/sap/bc/adt/oo/...`、`/sap/bc/adt/programs/...`、`/sap/bc/adt/fugr/...`
- FUGR includes（含 PROG includes）与 Message Class
- search / where-used / inspect / transport 所需的 Repository Information、对象结构与 CTS 资源

### 3.2 不能直接走 ADT、要先 `abap deploy` 的（CLI 走 ICF）

- DDIC 三件套：TABL / STRU / DOMA / DTEL —— 自建 ICF `/sap/zabap_vibe/dictionary/...`
- textpool / text elements —— 自建 ICF `/sap/zabap_vibe/textpool/...`
- select（只读）、run（classrun）、tcode 解析 —— 自建 ICF
- HTTP (SICF node) —— 自建 ICF `/sap/zabap_vibe/http/...`，对应 `--type HTTP`

### 3.3 ADT 已暴露但 CLI 暂未覆盖（按主题列出潜在扩展）

- **DDIC 高级**：DDLS、DCLS、Type Groups、AMDP Proxy、External View
- **质量**：ATC、ABAP Unit、Profiler、Debugger、SQLM Marker
- **搜索/Inspect 高级**：Repository Information 与 Generic WB object types
- **UI 与业务建模**：Web Dynpro、BOPF、Enterprise Services

# More

## todo

- [ ] 将 discovery 采集封装为 profile 可选的只读 CLI 辅助能力
- [ ] 以 workspace 主题补全 CLI ↔ ADT 覆盖度矩阵
- [ ] 在 ECC EHP7 系统变更组件栈后重新采集并更新本页

# references

- 服务文档 `/sap/bc/adt/discovery` —— W3C App service (`application/atomsvc+xml`)
- ICF 节点 `/sap/bc/adt`，TADIR `R3TR IWSG ADT_0001`，handler `CL_ADT_WB_RES_APP`
- 版本姊妹页：[S/4HANA 2022 SP01](adt-front-controller-s4h-2022.md)、[S/4HANA 2023 SP02](adt-front-controller-s4h-2023.md)
- 采集证据仅保存在 `tmp/<profile>/` 下（仓库临时目录，非 git 资产）
