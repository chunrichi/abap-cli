---
type: object-type
title: UCON_HTTP — UCON HTTP Service
description: UCON HTTP service 的 ICF /ucon_http 端点、本地扩展 ucon_http-v1 契约、handler 列表与 ICF 节点关联的读写映射
tags: [abap-cli, object-type, ucon_http, ucon, http-service, icf, local-extension]
created at: 2026-11-12 23:15:00
changed at: 2026-11-12 23:15:00
---

# UCON_HTTP — UCON HTTP Service

Unified Connectivity（UCON）里的 **HTTP service**：把一到多个按顺序排列的 ABAP handler 类暴露成 UCON 管理的 HTTP 服务，可附带短文本与一个可选的 SICF 节点关联。持久化在 `UCONHTTPSERVHEAD` / `UCONHTTPSERVTEXT` / `UCONHTTPSERVHANDL`，是 TADIR 对象（`OBJECT = 'HTTP'`，即 CLI 的 `HTTP` 类型码无法复用的那个 SAP 对象类型）。UCON 没有 ADT 资源，上游 abap-file-format 也没有对应格式，所以本 CLI 用本地扩展格式 + 自建 ICF 端点实现。

本类型只管理 HTTP service 本身；**UCON profile、运行时缓存维护与 handler 逻辑仍在 UCONCOCKPIT**。同族类型见 [`SRFC`](srfc.md)（UCON RFC service）与 [`OA2P`](oa2p.md)（OAuth 2.0 client profile）。

## 路由（单通道 ICF）

| 操作 | ICF 端点 |
|---|---|
| create | `POST /sap/abap_cli/ucon_http/<name>` |
| pull | `GET /sap/abap_cli/ucon_http/<name>` |
| push | `GET`（存在性探测）→ `POST /sap/abap_cli/ucon_http/<name>` |
| delete | `DELETE /sap/abap_cli/ucon_http/<name>` |

`GET /ucon_http`（列表）不实现；没有 inactive/active 编辑窗口——写入即活动版本。

ABAP 侧（`abap/src/zcl_abap_vibe_icf_ucon_http.clas.abap`）：

- **读**：公共 API `CL_UCON_API_FACTORY=>GET_HTTP_SERVICE( name )` → `IF_UCON_API_HTTP_SERVICE` 的 `GET_HANDLER` / `GET_DESCRIPTION` / `GET_ICF_SERVICE` / `GET_NAME` getter；短文本按会话语言读取、为空时回退任意已有语言行。
- **建 / 改**：`NEW_HTTP_SERVICE`（不存在时）或 `GET_HTTP_SERVICE`（已存在时）→ `SET_HANDLER`（有序 handler 列表）→ `SET_LANGUAGE_VERSION`（从第一个 handler 类继承）→ `SET_DESCRIPTION`（会话语言短文本）→ `SET_ICF_SERVICE`（可选的 SICF 节点关联）→ `ACTIVATE` → `SAVE( run_dark, dev_class, korrnum )` → `FREE`。`SAVE` 负责 TADIR / package / transport 记录，因此 CLI 侧只做 package / transport 的前置校验。
- **删**：公共 API `CL_UCON_API_FACTORY=>DELETE_HTTP_SERVICE( name, devclass, korrnum, run_dark )`：删除服务并记录 transport。
- **前置校验**：`handlers` 至少一个；每个 handler 类必须在 `SEOCLASS` 中存在；服务序号唯一（`SERVICEORDER` 是 N2 键，`02` 与 `2` 视为同一个）；短文本单行且 ≤ 255 字符。校验失败直接返回明确错误（`UCON_HTTP_INVALID_PAYLOAD` / `UCON_HTTP_HANDLER_NOT_FOUND`），不落库。
- **API 可用性**：路由启动时动态探测 `UCONHTTPSERVHEAD`；缺表的老 release 返回 `UCON_HTTP_API_UNAVAILABLE`（exit 7），而不是让整个 ICF 部署失败。UCON API 调用使用动态 `CALL METHOD`，因此该类在所有支持的 release 上都能编译。

## 本地文件形态

```
src/
└── <name>.ucon_http.json
```

`ucon_http-v1.json` 是**本地扩展 schema**（`src/abap_cli/schema/ucon_http-v1.json`）。`name` 只出现在文件名 / 命令参数里；`pull` 写出的文件不含 `name` / `package`，因此可以直接作为 `create` / `push` 的模板。

```json
{
  "formatVersion": "1",
  "description": "Sales order HTTP service",
  "handlers": [
    { "order": "01", "handlerClass": "ZCL_MY_HTTP_HANDLER" }
  ],
  "icfService": { "icfName": "ZMY_NODE", "icfParGuid": "..." }
}
```

| 字段 | 必填 | 规则 / 真机映射 |
|---|---|---|
| `formatVersion` | 是 | 恒为 `"1"` |
| `description` | 否 | ≤ **255** 字符（`UCONHTTPSERVTEXT-SHORTTEXT`，单行）；按会话语言读写；空串允许 |
| `handlers[]` | 是 | 至少一个；最多 100 个 |
| `handlers[].handlerClass` | 是 | 非空、≤ 30 字符（`SERVICEHANDLER`）；只允许 `A-Z 0-9 _ /`；必须存在于目标系统 |
| `handlers[].order` | 否 | 1-2 位数字（`SERVICEORDER`）；省略时按列表位置；同一服务内唯一 |
| `icfService` | 否 | 可选关联已有 SICF 节点：`icfName`（≤ 15，`ICFNAME`）+ `icfParGuid`（≤ 25，`ICFPARGUID`）；`pull` 在有链接时带回 |

名称上限 **30 字符**（`UCONHTTPSERVID`），大小写不敏感（CLI 与 handler 都统一大写），只允许 `A-Z 0-9 _ /`。`--file` 文件名必须与 service 名一致：`<name>.ucon_http.json`。

## 命令示例

```bash
# 拉取已有 HTTP service（只读）
abap pull ZMY_HTTP_SERVICE --type UCON_HTTP --json

# 创建 / 覆盖（TADIR 对象：$ 开头本地包免 transport，其它包需要 --tr）
abap create UCON_HTTP ZCLI_HTTP_DEMO --file src/zcli_http_demo.ucon_http.json --package '$TMP' --yes --json

# 修改文件后推回（update-only；不存在请用 create）
abap push src/zcli_http_demo.ucon_http.json --yes --json

# 删除（非本地包需要 --tr）
abap delete ZCLI_HTTP_DEMO --type UCON_HTTP --yes --json
```

`create` / `push` 的本地校验全部在写 SAP 之前完成：schema + 语义规则（handler 数量 / 类名 / 序号唯一 / 长度）+ 名称规则 + 文件名匹配 + package / transport 规则。`--check-only` 只做本地校验并打印计划。

## 已知限制

1. **短文本单语言**：按会话语言读写。push 覆盖当前会话语言行，其它语言行不动；pull 读会话语言行、为空时回退任意语言行。跨语言维护请仍在 UCONCOCKPIT 完成。
2. **没有 inactive 版本编辑**：写入直接激活并覆盖活动版本；working-area / inactive 版本机制不在建模范围。
3. **handler 的接口形态不本地校验**：只检查类存在（`SEOCLASS`）；handler 是否实现 UCON 期望的 HTTP handler 接口由 `ACTIVATE` / `SAVE` 判定，SAP 的错误原样返回。
4. **ICF 节点关联是不透明键**：`icfService` 直接对应 `ICFNAME` / `ICFPARGUID`，通常由 `pull` 带回；手工填写时需从 SICF 侧取得父节点 GUID。757 及更早的 release 可能需要该关联服务才能生效，独立服务可以省略。
5. **API 可用性**：依赖 `CL_UCON_API_FACTORY` / `IF_UCON_API_HTTP_SERVICE` 与 `UCONHTTPSERV*` 表；老 release 缺表时路由返回 `UCON_HTTP_API_UNAVAILABLE`（exit 7）。服务版本 2.7.0 起包含该路由，升级后需要一次 `abap deploy --yes`。
6. **`push` 只更新、不创建**：push 先 GET 探测，不存在时返回 `OBJECT_NOT_FOUND`（exit 8）并提示改用 `create`。
7. **`--no-activate` 不适用**：写入即活动版本（`VALIDATION_ERROR`，exit 7）。

## 验证状态

mock ICF 集成闭环与单元测试已覆盖：`create → pull → push → re-pull → delete`、ICF 节点关联往返、handler 类不存在、空 handler 列表、transportable 包缺 `--tr`、缺失目标 push、`--check-only` 零 SAP 写入。**真机验证未完成**：本次会话默认系统 profile `test` 返回 401（凭据失效），无法执行 `abap deploy --yes` 与真机六阶段回归；因此本页不声称真机通过，ICF 2.7.0 的真机部署与 `/ucon_http` 闭环需要在凭据恢复后补跑。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 类型矩阵：[`wiki/object-types.md`](../object-types.md)
- `create` / `pull` / `push` / `delete`：[`wiki/commands/`](../commands/index.md)
- schema 来源说明：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
