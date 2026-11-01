---
type: object-type
title: TTYP — 表类型（Table Type）
description: TTYP 对象的双通道路由、字段契约、可选 .type.abap 侧车文件
tags: [abap-cli, object-type, ttyp, ddic, adt, icf, abap-file-format, table-type]
created at: 2026-09-04 00:00:00
changed at: 2026-11-02 00:05:00
---

# TTYP — 表类型（Table Type）

## 路由（双通道）

| 系统 | 通道 | 端点 |
|---|---|---|
| S/4HANA、ECC EHP7+（kernel ≥ 753） | ADT | `/sap/bc/adt/ddic/tabletypes/<name>` |
| ECC EHP5 / EHP6（kernel < 753） | ICF 兜底 | `/sap/abap_cli/ddic/ttyp/<name>` |
| 现代内核但 ADT 端点未路由（SAP 答 `No URI-Mapping defined for URI`） | ICF 运行时兜底 | `/sap/abap_cli/ddic/ttyp/<name>` |

通道由 `flows/edit/channel-detect.ts` 在任何 SAP 调用之前判定，判定结果写入 envelope 的 `data.channel`；走兜底时同时写 `data.fallbackReason`——ECC 旧内核为 `"ECC_EHP6_NO_ADT_TABLETYPE"`，现代内核缺 ADT 端点时为 `"ADT_ENDPOINT_UNAVAILABLE"`。

ICF 兜底由 `zcl_abap_vibe_ttyp_format`（读，DD40L/DD40V + DD42V）与 `zcl_abap_vibe_icf` 的 `/ddic/ttyp` handler（写，`DDIF_TTYP_PUT` + `DDIF_TTYP_ACTIVATE`，lock/unlock 包裹）提供。

## ADT wire 形态

`/sap/bc/adt/ddic/tabletypes/<name>` 使用 ADT DDIC 模型（真实 S/4HANA 形态）：头信息在 `adtcore` 属性里，行类型/访问方式/主键是子元素：

```xml
<ttyp:tableType xmlns:ttyp="http://www.sap.com/dictionary/tabletype"
                xmlns:adtcore="http://www.sap.com/adt/core"
                adtcore:name="ZMY_TTYP" adtcore:type="TTYP/DA"
                adtcore:description="My table type" adtcore:language="EN">
  <adtcore:packageRef adtcore:name="$TMP"/>
  <ttyp:rowType>
    <ttyp:typeKind>dictionaryType</ttyp:typeKind>
    <ttyp:typeName>LVC_S_TABL</ttyp:typeName>
    <ttyp:builtInType><ttyp:dataType>STRU</ttyp:dataType><ttyp:length>000000</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType>
    <ttyp:rangeType/>
  </ttyp:rowType>
  <ttyp:accessType>standard</ttyp:accessType>
  <ttyp:primaryKey>
    <ttyp:definition>standard</ttyp:definition>
    <ttyp:kind>nonUnique</ttyp:kind>
    <ttyp:components/>
    <ttyp:alias/>
  </ttyp:primaryKey>
</ttyp:tableType>
```

ADT 的创建分两步：`POST /sap/bc/adt/ddic/tabletypes` 只注册对象（默认内容），行类型/访问方式/主键随后经 lock → `PUT ?lockHandle=`（vendor media type `application/vnd.sap.adt.tabletype.v1+xml`）→ unlock → activate 写入。PUT 不接受 `application/xml`（415）。`adtcore:language`/`masterLanguage` 必须等于登录语言，否则 DDIC 描述不会落库（SAP 侧行为）。

## 本地文件形态

```
src/
├── zmy_ttyp.ttyp.json    # AFF 嵌套元数据
└── zmy_ttyp.type.abap    # 可选侧车：define type ... DDL 形式
```

`.type.abap` 是**只读派生产物**——push 只读 `.ttyp.json`，侧车仅供人阅读与 diff。`pull --skip-type-abap` 可跳过生成。

## `<name>.ttyp.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My table type",
    "originalLanguage": "EN"
  },
  "accessType": "standard",
  "lineType": { "rowType": "ZMY_STRUCT" },
  "keyDefinition": [
    { "keyField": "CARRID", "descending": false },
    { "keyField": "CONNID", "descending": true }
  ],
  "keyKind": "unique"
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `accessType` | enum | `standard` / `sorted` / `hashed`（对应 DD40V-ACCESSMODE `T` / `S` / `H`） |
| `lineType.rowType` | string | 行类型引用（DTEL / STRU / TABL / 内建类型如 `STRING`） |
| `lineType.rowStructure` | object | 内联行结构（仅 ADT 通道；ICF 兜底不支持，会返回 `DDIC_TTYP_FORMAT_UNSUPPORTED`） |
| `keyDefinition` | array | 键定义（`sorted` / `hashed` 必需；`standard` 可省）；来自 ADT `ttyp:primaryKey/definition=keyComponents` |
| `keyKind` | enum | 可选，`unique` / `nonUnique`（ADT `ttyp:primaryKey/kind`）；push 缺省时 `hashed` 按 `unique`、其它按 `nonUnique` |

## 命令示例

```bash
abap create TTYP ZMY_TTYP --file src/zmy_ttyp.ttyp.json --package $TMP --yes --json
abap pull LVC_T_TABL --type TTYP --json
abap push src/zmy_ttyp.ttyp.json --yes --json
```

## abap-file-format 合规性

上游 abap-file-formats **没有** table-type schema（`type/type-v1.json` 是 type-pool，不是表类型）。本项目自维护 `ttyp-v1.json`，文件头标注 `handcrafted`。若上游后续发布官方 schema，以官方为准并迁移 fixture。

## 已知坑

- **内联行结构不支持**：`lineType.rowStructure`（`ROWTYPE` 为空）没有 ADT DDIC 表示，`create` / `push` 在本地报 `VALIDATION_ERROR`；ICF 兜底同样要求 `lineType.rowType`
- **预定义行类型有损**：ADT 的 `predefinedAbapType`（如 `table of char10`）只保留数据类型名（`lineType.rowType: "CHAR"`），长度/小数位不进本地 JSON；DDIC 表类型实践中都用字典行类型（ROWKIND S/E/L）
- **描述语言 = 登录语言**：ADT 只在 `adtcore:language`/`masterLanguage` 等于登录语言时持久化 DDIC 描述；CLI 写入统一用 profile 语言，pull 的 `originalLanguage` 因此通常是登录语言
- **`accessType: standard` 忽略 `keyDefinition`**：SAP 侧标准表不存键序，pull 回来会是空数组
- **通道缓存**：`detectChannel` 在进程生命周期内缓存决策；单测需调 `clearChannelCache()`

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 真实 SAP 回归：本地 `tests/260904001-ttyp-real-sap/`（gitignored，本地执行证据，不入库）
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
