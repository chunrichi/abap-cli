---
type: object-type
title: VIEW — 数据库视图（Database View）
description: VIEW 对象的 ICF 路由、自建 view-v1 字段契约（DD25V/DD26V/DD27P/DD28J/DD28V）、写路径与 $TMP-only 删除
tags: [abap-cli, object-type, view, icf, abap-file-format, database-view]
created at: 2026-10-31 18:00:00
changed at: 2026-10-31 18:20:00
---

# VIEW — 数据库视图（Database View）

DDIC 视图（SE11 → 视图）。`VIEW` 是 abap-cli 的**本地扩展类型**：SAP 上游
`abap-file-formats` 没有 view 格式，本仓库自建 `view-v1.json`（见
[`schema/README.md`](../../src/abap_cli/schema/README.md) 的 local extension 说明），
字段来源是 DDIC 维护结构 `DD25V` / `DD26V` / `DD27P` / `DD28J` / `DD28V`。

## 路由（单通道 ICF）

| 操作 | 端点 |
|---|---|
| create | `POST /sap/abap_cli/ddic/view`（body 带 `name`；PUT 同语义） |
| pull | `GET /sap/abap_cli/ddic/view/<name>` |
| push | `GET`（存在性探测）→ `POST /sap/abap_cli/ddic/view` |
| delete | `DELETE /sap/abap_cli/ddic/view/<name>`（仅 `$TMP`） |

ADT 没有 DDIC 视图资源，所以 `registry` 里 `source: 'ICF'`：四类操作全部走自建
ICF 服务，需要先 `abap deploy`。SAP 侧 handler 在
`abap/src/zcl_abap_vibe_icf_ddic.clas.abap` 的 `/ddic/view` 分支
（`create_ddic_view` / `get_ddic_object` 的 `VIEW` 分支 / `delete_ddic_object`）。

## 本地文件形态

```
src/
└── zcli_tc_view.view.json
```

单文件，无侧车。`abap pull ZCLI_TC_VIEW --type VIEW` 写
`src/zcli_tc_view.view.json`；`abap push src/zcli_tc_view.view.json` 反向读同一文件。

## `ZCLI_TC_VIEW.view.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Materials by plant",
    "originalLanguage": "en"
  },
  "name": "ZCLI_TC_VIEW",
  "package": "$TMP",
  "viewClass": "databaseView",
  "rootTable": "MARA",
  "tables": [
    { "tableName": "MARA", "tablePosition": 1 },
    { "tableName": "MAKT", "tablePosition": 2, "foreignTableName": "MARA" }
  ],
  "fields": [
    { "viewFieldName": "MANDT", "tableName": "MARA", "fieldName": "MANDT", "keyFlag": true, "rollName": "MANDT" },
    { "viewFieldName": "MATNR", "tableName": "MARA", "fieldName": "MATNR", "keyFlag": true, "rollName": "MATNR" },
    { "viewFieldName": "SPRAS", "tableName": "MAKT", "fieldName": "SPRAS", "keyFlag": true, "rollName": "SPRAS" },
    { "viewFieldName": "MAKTX", "tableName": "MAKT", "fieldName": "MAKTX", "rollName": "MAKTX" }
  ],
  "joinConditions": [
    { "leftTable": "MARA", "leftField": "MANDT", "operator": "EQ", "rightTable": "MAKT", "rightField": "MANDT", "source": "S" },
    { "leftTable": "MARA", "leftField": "MATNR", "operator": "EQ", "rightTable": "MAKT", "rightField": "MATNR", "source": "S" }
  ]
}
```

## 关键字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `formatVersion` | `"1"` | ✅ | 固定 |
| `name` | string | ✅ | 视图名，**≤16 字符**（DDIC 视图对象名上限，比 TADIR 的 30 更短） |
| `header.description` | string | ✅ | DD25V-DDTEXT，≤60 |
| `header.originalLanguage` | string | ✅ | 两位 ISO 语言码（`en` / `de` / `zh` / …） |
| `package` | string | — | 读路径写出的 TADIR 包；create/push 以命令行 `--package` 为准 |
| `viewClass` | enum | ✅ | `databaseView`(D) / `maintenanceView`(C) / `helpView`(H) / `projectionView`(P) |
| `rootTable` | string | ✅ | DD25V-ROOTTAB，必须等于 `tables[0].tableName` |
| `tables[]` | array | ✅ | DD26V，至少 1 项；`tablePosition` 缺省按数组序；`foreignTableName` 缺省为根表 |
| `fields[]` | array | ✅ | DD27P，至少 1 项；`tableName` + `fieldName` 必填，`viewFieldName` 缺省同 `fieldName` |
| `joinConditions[]` | array | 多表必填 | DD28J；`operator` 缺省 `EQ`，`source` 缺省 `S` |
| `selectionConditions[]` | array | — | DD28V；数据库视图通常为空 |

### `viewClass` ↔ `DD25V-VIEWCLASS`

| SAP | 本地枚举 |
|---|---|
| `D` | `databaseView` |
| `C` | `maintenanceView` |
| `H` | `helpView` |
| `P` | `projectionView` |

读路径输出枚举，写路径接受枚举或单字母；未知值 → `VIEW_TYPE_INVALID`（exit 7）。

## 写路径（SAP 侧）

`create` / `push` 都走同一个 upsert 语义：

1. `RS_CORR_INSERT`（`object_class='VIEW'`、`devclass`、`korrnum`、`mode='I'`、
   `global_lock='X'`、`suppress_dialog='X'`）——插入 TADIR / 绑定包与请求。
2. `DDIF_VIEW_PUT`——**四个 `TABLES` 参数必须全部命名**（`dd26v_tab` /
   `dd27p_tab` / `dd28j_tab` / `dd28v_tab`，空表也要命名；漏掉空 `dd28v_tab`
   会让 join 视图返回 `VIEW_INCONSISTENT`）。
3. `DDIF_VIEW_ACTIVATE`——`DDIF_VIEW_PUT` 只写 inactive 的 `L` 版本，不激活则
   `GET state='A'` 读不到。

写侧只要求 `fields[]` 的 `tableName` + `fieldName`：`keyflag` / `rollname` /
`rollnamevi` 由 handler 从 `DD03L` 推导（读回来的文档里会带上推导值）。
`tables[]` 的 `fortabname` 同样由 handler 推导（首表=自身，其余=根表）。

## 删除

`abap delete <name> --type VIEW` → `DELETE /ddic/view/<name>`：

- handler 先 `SELECT SINGLE FROM dd25l` 判断对象是否存在，再查 TADIR 判定包；
- 非 `$TMP` 视图 → `VIEW_DELETE_UNSUPPORTED`（exit 7）：ICF 上下文无法把删除记录进
  传输请求，请在 SE11 删除；
- `$TMP` 视图：若只有 inactive `L` 版本，先 `DDIF_VIEW_ACTIVATE` 激活，
  再 `RS_DD_DELETE_OBJ(objtype='V', no_ask='X')`（**不要**用会弹 dynpro 的
  `RS_DD_DELETE`）。对象与 TADIR 行一并清除。

## 命令示例

```bash
# 先写 view-v1 JSON（多表视图记得 joinConditions）
cat > src/zcli_tc_view.view.json <<'JSON'
{
  "formatVersion": "1",
  "header": { "description": "Materials by language", "originalLanguage": "en" },
  "name": "ZCLI_TC_VIEW",
  "viewClass": "databaseView",
  "rootTable": "MARA",
  "tables": [
    { "tableName": "MARA", "tablePosition": 1 },
    { "tableName": "MAKT", "tablePosition": 2, "foreignTableName": "MARA" }
  ],
  "fields": [
    { "tableName": "MARA", "fieldName": "MANDT", "keyFlag": true },
    { "tableName": "MARA", "fieldName": "MATNR", "keyFlag": true },
    { "tableName": "MAKT", "fieldName": "SPRAS", "keyFlag": true },
    { "tableName": "MAKT", "fieldName": "MAKTX" }
  ],
  "joinConditions": [
    { "leftTable": "MARA", "leftField": "MANDT", "rightTable": "MAKT", "rightField": "MANDT" },
    { "leftTable": "MARA", "leftField": "MATNR", "rightTable": "MAKT", "rightField": "MATNR" }
  ]
}
JSON

# create（$TMP 免 transport；非 $TMP 必须 --tr）
abap create VIEW ZCLI_TC_VIEW --file src/zcli_tc_view.view.json --package '$TMP' --yes --json

# 拉回、改描述、推回
abap pull ZCLI_TC_VIEW --type VIEW --overwrite --json
abap push src/zcli_tc_view.view.json --json

# 删除（仅 $TMP）
abap delete ZCLI_TC_VIEW --type VIEW --yes --json
```

## 错误码

| code | category / exit | 触发 |
|---|---|---|
| `VIEW_NAME_INVALID` | VALIDATION_ERROR / 7 | 名字为空 / >16 字符 / 含空白 / payload 与 URL 名字不一致 |
| `VIEW_TYPE_INVALID` | VALIDATION_ERROR / 7 | `viewClass` 不在枚举内 |
| `VIEW_REQUIRED_FIELD` | VALIDATION_ERROR / 7 | 缺 `header.description` / `tables[]` / `fields[]` / join 四字段 |
| `VIEW_TABLE_NOT_FOUND` | NOT_FOUND / 8 | `tables[]` 引用的表在 DD02L 不存在 |
| `VIEW_FIELD_INVALID` | VALIDATION_ERROR / 7 | 字段不在其表中，或 join 引用未声明的表 |
| `VIEW_INVALID_PAYLOAD` | VALIDATION_ERROR / 7 | body 不是合法 view-v1 JSON |
| `VIEW_INCONSISTENT` / `VIEW_WRITE_REFUSED` | VALIDATION_ERROR / 7 | `DDIF_VIEW_PUT` 的 `view_inconsistent` / `put_refused` |
| `VIEW_WRITE_FAILED` / `VIEW_ACTIVATION_FAILED` | SAP_ERROR / 6 | PUT / ACTIVATE 失败 |
| `VIEW_TRANSPORT_REQUIRED` | VALIDATION_ERROR / 7 | 非 `$TMP` 写未给有效 transport |
| `VIEW_NOT_AUTHORIZED` | AUTH_ERROR / 5 | `RS_CORR_INSERT` 权限不足 |
| `VIEW_DELETE_UNSUPPORTED` | VALIDATION_ERROR / 7 | 删除可传输视图 |
| `VIEW_DELETE_FAILED` | SAP_ERROR / 6 | `RS_DD_DELETE_OBJ` 失败 |

对象不存在统一返回 `DDIC_OBJECT_NOT_FOUND`（`pull`/`delete` 由 CLI 映射为
`OBJECT_NOT_FOUND`，exit 8）。

## 真机验证

在 S/4HANA 8.134.214.7:44300（profile `test`，client 100，sap103）按
`abap-testing` 六阶段跑通（2026-10-31）：

- **create** 两表 join 视图（MARA + MAKT，$TMP）→ `action=created`；
  **pull** 回来 2 表 / 4 字段 / 2 join 条件 / `package=$TMP` 一致。
- **DDIC 落库校验**：`DD25L` 1 行（`AS4LOCAL=A`、`VIEWCLASS=D`、`ROOTTAB=MARA`）；
  `DD26S` 2 行（`FORTABNAME=MARA`）；`DD27S` 4 行（OBJPOS 1..4，`KEYFLAG`/`ROLLNAME`
  按底层字段推导正确）；`DD28S` 4 行（两条 join 条件的两侧）。
- **视图本身可查**：`abap select --table ZCLI_TC_VIEW --fields MANDT,MATNR,SPRAS,MAKTX`
  返回 MARA+MAKT 的真实 join 数据。
- **push** 修改（description v2 + 追加 `MAKTG`）→ 复拉一致（5 字段）；
  **delete** → `deleted=true, lockReleased=true`，删除后 DD25L/DD26S/DD27S/DD28S
  与 TADIR 的 `ZCLI_TC_*` 视图 0 残留。
- 单表视图 create→pull→delete、错误路径（17 字符名 / 不存在字段 / 非 $TMP 无
  `--tr` / 可传输视图删除 / pull 不存在对象）均返回预期错误码。

证据（本地，不入库）：`tests/261031006-realsap-view/`（17 TC 全 PASS，含
`evidence/TC-R1..R10`、`TC-E1..E5`、`summary.md`）。

## Gotcha

- **视图名 ≤16 字符**：`DDIF_VIEW_PUT` 对超长名返回 `PUT_REFUSED`（AD 102），且
  TADIR 行可能残留；CLI 在入口就拦（`VIEW_NAME_INVALID`），不要依赖 SAP 兜底。
- **四个 `TABLES` 参数必须全部命名**：单表视图也要命名空的 `dd28j_tab` /
  `dd28v_tab`；join 视图漏命名空 `dd28v_tab` 会 `VIEW_INCONSISTENT`。
- **PUT 不激活**：写成功但没 activate 时 `GET state='A'` 返回空（`gotstate=''`），
  别误判为“对象不存在”。
- **`VIEWCLASS` 之外还有 `AGGTYPE`/`READONLY` 等头字段**：handler 固定写
  `AGGTYPE='V'`、`AUTHCLASS='00'`、`READONLY='X'`、`VIEWGRANT='R'`，与 SE11
  建数据库视图一致；维护视图/帮助视图的额外属性（TDDAT、维护生成器）不在
  view-v1 覆盖范围。
- **删除只支持 `$TMP`**：可传输视图请在 SE11 删，否则删除无法记录到传输请求。
- **pull 只返回 active 版本**：`DDIF_VIEW_GET state='A'`；inactive 版本需先
  `DDIF_VIEW_ACTIVATE`（`push` 会自动激活，`delete` 也会先激活）。
- **语言文本**：`header.originalLanguage` 来自 `DD25V-DDLANGUAGE`；字段短文本
  `DD27P-DDTEXT` 不在 view-v1 里（由数据元素/表字段承载）。

# references

- 本地 schema：[`src/abap_cli/schema/view-v1.json`](../../src/abap_cli/schema/view-v1.json)
- 格式映射：`src/abap_cli/formats/view/json.ts`
- SAP 侧 handler：`abap/src/zcl_abap_vibe_icf_ddic.clas.abap`（`create_ddic_view`）
- 类型矩阵：[`wiki/object-types.md`](../object-types.md)
- 命令文档：[create](../commands/create.md) / [pull](../commands/pull.md) / [push](../commands/push.md) / [delete](../commands/delete.md)
