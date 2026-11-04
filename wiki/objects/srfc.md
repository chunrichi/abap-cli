---
type: object-type
title: SRFC — UCON RFC Service
description: UCON RFC service 的 ICF /srfc 端点、本地扩展 srfc-v1 契约、UCON API / Workbench 持久化读写映射与真机证据
tags: [abap-cli, object-type, srfc, ucon, rfc-service, icf, local-extension]
created at: 2026-11-04 02:15:00
changed at: 2026-11-04 02:15:00
---

# SRFC — UCON RFC Service

Unified Connectivity（UCON）里的 **RFC service**：把一个 RFC-enabled function module 暴露成 UCON 管理的 RFC 服务，可附带 call scope、默认 UCON profile 与短文本。持久化在 `UCONRFCSERVHEAD` / `UCONRFCSERVTEXT`，是 TADIR 对象（`OBJECT = 'SRFC'`）。UCON 没有 ADT 资源，上游 abap-file-format 也没有 SRFC 格式，所以本 CLI 用本地扩展格式 + 自建 ICF 端点实现。

本类型只管理 RFC service 本身；**communication assembly（UCSA）与 RFC profile 的维护仍在 UCONCOCKPIT**。同族但独立的 UCON HTTP service 尚未支持（类型码待定，见 roadmap），OAuth 2.0 profile 是另一类型 [`OA2P`](oa2p.md)。

## 路由（单通道 ICF）

| 操作 | ICF 端点 |
|---|---|
| create | `POST /sap/abap_cli/srfc/<name>` |
| pull | `GET /sap/abap_cli/srfc/<name>` |
| push | `GET`（存在性探测）→ `POST /sap/abap_cli/srfc/<name>` |
| delete | `DELETE /sap/abap_cli/srfc/<name>` |

`GET /srfc`（列表）不实现；没有 inactive/active 编辑窗口——写入即活动版本。

ABAP 侧（`abap/src/zcl_abap_vibe_icf_srfc.clas.abap`）：

- **读**：公共 API `CL_UCON_API_FACTORY=>GET_RFC_SERVICE( name )` → `IF_UCON_API_RFC_SERVICE` getter（function module / scope / profile / 短文本 / admin data），短文本按会话语言读取、为空时回退任意已有语言行。
- **建 / 改**：Workbench 持久化类 `CL_UCONRFC_OBJECT_PERSIST` + `CL_UCONRFC_OBJECT_DATA`（与 UCONCOCKPIT 保存路径一致）：lock（`ENQUEUE_E_UCON_RFC`）→（改时）读取当前 active 版本 → 覆盖 function module / scope / default profile / 短文本 → `RS_CORR_INSERT`（TADIR + package / transport）→ `save` → `COMMIT WORK` → unlock → 刷新 UCON RFC 运行时缓存（`CL_UCONRFC_RUNTIME=>SET_UCON_SERVICE_NAME_4_RT`，等价于 UCONCOCKPIT 激活）。
- **删**：公共 API `CL_UCON_API_FACTORY=>DELETE_RFC_SERVICE( name, devclass, korrnum, run_dark )`：删除 header / text 行、TADIR、CTS 记录、change document，并刷新运行时缓存。
- **前置校验**：function module 必须存在且 RFC-enabled（FMODE `R` / `X` / `K`，等价 `CL_UCONRFC_OBJECT_TOOL=>CHECK_OBJECT_DATA`）；`defaultProfile` 必须存在于 `UCONPROFHEAD`。校验失败直接返回明确错误（`SRFC_FUNCTION_NOT_FOUND` / `SRFC_FUNCTION_NOT_RFC_ENABLED` / `SRFC_PROFILE_NOT_FOUND`），不落库。

## 本地文件形态

```
src/
└── <name>.srfc.json
```

`srfc-v1.json` 是**本地扩展 schema**（`src/abap_cli/schema/srfc-v1.json`）。`name` 只出现在文件名 / 命令参数里；`pull` 写出的文件不含 `name` / `package` / admin 字段，因此可以直接作为 `create` / `push` 的模板。

```json
{
  "formatVersion": "1",
  "description": "Default RFC Service for Function-Module: Z_MY_RFC_FM",
  "functionName": "Z_MY_RFC_FM",
  "scope": "E"
}
```

| 字段 | 必填 | 规则 / 真机映射 |
|---|---|---|
| `formatVersion` | 是 | 恒为 `"1"` |
| `description` | 否 | ≤ **255** 字符（`UCONRFCSERVTEXT-SHORTTEXT`，单行）；按会话语言读写；空串允许 |
| `functionName` | 是 | 非空、≤ 30 字符（`RS38L_FNAM`）；必须存在且 RFC-enabled |
| `scope` | 否 | `E`（可从其他系统调用）/ `O`（obsolete）/ `P`（不能从 client / system 外调用）/ `S`（仅本系统、所有 client）；省略 = 空 |
| `defaultProfile` | 否 | ≤ 30 字符（`UCONHTTPSERVID`）；必须存在于 `UCONPROFHEAD` |

名称上限 **30 字符**（`UCONRFCSERVID`），大小写不敏感（CLI 与 handler 都统一大写），只允许 `A-Z 0-9 _ /`。`--file` 文件名必须与 service 名一致：`<name>.srfc.json`。

## 命令示例

```bash
# 拉取已有 RFC service（只读）
abap pull BAPI_CTR_CREATE --type SRFC --json

# 创建 / 覆盖（TADIR 对象：$ 开头本地包免 transport，其它包需要 --tr）
abap create SRFC ZCLI_SRFC_DEMO --file src/zcli_srfc_demo.srfc.json --package '$TMP' --yes --json

# 修改文件后推回（update-only；不存在请用 create）
abap push src/zcli_srfc_demo.srfc.json --yes --json

# 删除（非本地包需要 --tr）
abap delete ZCLI_SRFC_DEMO --type SRFC --yes --json
```

`create` / `push` 的本地校验全部在写 SAP 之前完成：schema + 语义规则（functionName、scope、长度）+ 名称规则 + 文件名匹配 + package / transport 规则。`--check-only` 只做本地校验并打印计划；`push --dry-run` 不写 SAP。

## 已知限制

1. **短文本单语言**：按会话语言读写。push 覆盖当前会话语言行，其它语言行不动；pull 读会话语言行、为空时回退任意语言行。跨语言维护请仍在 UCONCOCKPIT 完成。
2. **创建时空描述有默认值**：与 UCONCOCKPIT 一致，`create` 时 description 为空会写入 `Default RFC Service for Function-Module: <functionName>`；`push` 空描述则按空写入（不生成默认值）。
3. **没有 inactive 版本编辑**：写入直接覆盖 active 版本（与 abapGit 的 SRFC handler 一致）；working-area / inactive 版本机制不在建模范围。
4. **communication assembly / RFC profile 不在范围**：`UCSA`、UCON RFC profile、RFC 场景（`UCONRFC_ATTR`）的维护仍在 UCONCOCKPIT；本类型只保证 service 自身与运行时缓存刷新。
5. **需要 UCON 组件**：依赖 `CL_UCON_API_FACTORY` / `IF_UCON_API_RFC_SERVICE` / `CL_UCONRFC_OBJECT_PERSIST` / `CL_UCONRFC_RUNTIME`（S/4HANA 757 已验证）。旧 release 缺这些类时 `abap deploy` 激活阶段失败、路由不存在，而不是运行时降级。
6. **`push` 只更新、不创建**：push 先 GET 探测，不存在时返回 NOT_FOUND（exit 8）并提示改用 `create`。
7. **`--no-activate` 不适用**：写入即活动版本并刷新缓存（`VALIDATION_ERROR`，exit 7）。

## 真机证据

S/4HANA 测试系统（profile `test`，ABAP release 757、client 100，ICF 服务发布形态 2.5.0；`abap deploy status` = current）六阶段运行 **57/57 TC PASS**（`tests/261104201-srfc-oa2p/`，本地不入库）：

- **闭环**：`create ZCLI_SRFC_TC_* → pull → validate:aff → 改 description / scope → push → re-pull → delete → pull`；re-pull 与编辑值一致，删除后 `UCONRFCSERVHEAD` / `UCONRFCSERVTEXT` / TADIR 均无 `ZCLI_SRFC_TC%` 残留。
- **只读 pull SAP 自带 service**：`BAPI_CTR_CREATE` 读到 function module / scope / 短文本（短文本走语言回退）；pull 前后系统数据未变，未 push / delete 该对象。
- **错误路径实测**：missing pull/push/delete → exit 8；不存在的 function module → `SRFC_FUNCTION_NOT_FOUND`（exit 7）；RFC-disabled FM → `SRFC_FUNCTION_NOT_RFC_ENABLED`（exit 7）；不存在的 profile → `SRFC_PROFILE_NOT_FOUND`（exit 7）；非本地包缺 `--tr` → `VALIDATION_ERROR`（exit 7）；`--no-activate` → exit 7；缺少 `--package` / 文件名不匹配 / delete 缺 `--yes` → exit 2；schema 非法 → exit 7；`--check-only` 零 SAP 写入。
- **`--json` 形状**：create / pull / push / delete / types 的 `data` 字段按契约返回（`action` / `entries` / `deleted` / `tadirObject` 等）。
- **清理**：`ZCLI_SRFC_TC%` 全命名空间 0 行（含 TADIR）；打开的 transport 列表为空。
- **未覆盖**：非 `$TMP` 传输包写路径（测试系统没有打开的 transport request）。`RS_CORR_INSERT` / package 判定 / 本地包免传输的行为由 mock 集成测试覆盖。
- **环境注意**：测试系统与并行 ticket 共享，ICF 部署是系统级的、会被其他 ticket 的 `abap deploy` 覆盖；运行脚本在测试前探测 `/srfc` 路由并在必要时重装本分支 release form。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 类型矩阵：[`wiki/object-types.md`](../object-types.md)
- `create` / `pull` / `push` / `delete`：[`wiki/commands/`](../commands/index.md)
- schema 来源说明：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
