---
type: object-type
title: TTYP — 表类型（Table Type）
description: TTYP 对象的双通道路由、字段契约与本地 JSON 布局
tags: [abap-cli, object-type, ttyp, ddic, adt, icf, abap-file-format, table-type]
created at: 2026-09-04 00:00:00
changed at: 2026-11-03 00:20:00
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

预定义行类型（`table of char10`、`table of dec15(2)`）走 `predefinedAbapType`：`typeKind` 为 `predefinedAbapType`，`typeName` 为空，数据类型/长度/小数都在 `<ttyp:builtInType>` 里，且后两者是 6 位补零字符串（真实 S/4HANA 返回 `000010` / `000002`）：

```xml
<ttyp:rowType>
  <ttyp:typeKind>predefinedAbapType</ttyp:typeKind>
  <ttyp:typeName/>
  <ttyp:builtInType><ttyp:dataType>CHAR</ttyp:dataType><ttyp:length>000010</ttyp:length><ttyp:decimals>000000</ttyp:decimals></ttyp:builtInType>
  <ttyp:rangeType/>
</ttyp:rowType>
```

`ttyp:dataType` 是 **DDIC 数据类型名**（`CHAR` / `NUMC` / `DEC` / `DATS` / `TIMN` / `INT4` / `STRING` …），不是 ABAP 类型码：往 wire 里写 `C` / `I` / `P` 会在激活时报「数据类型 … 不存在」。长度/小数只对预定义行类型有意义；字典行类型由 SAP 从被引用对象推导，wire 里的 `builtInType` 只是占位（`STRU/0/0`）。

ADT 的创建分两步：`POST /sap/bc/adt/ddic/tabletypes` 只注册对象（默认内容），行类型/访问方式/主键随后经 lock → `PUT ?lockHandle=`（vendor media type `application/vnd.sap.adt.tabletype.v1+xml`）→ unlock → activate 写入。PUT 不接受 `application/xml`（415）。`adtcore:language`/`masterLanguage` 必须等于登录语言，否则 DDIC 描述不会落库（SAP 侧行为）。

## 本地文件形态

```
src/
└── zmy_ttyp.ttyp.json    # AFF 嵌套元数据（唯一本地文件）
```

表类型是**纯 DDIC 元数据**：abapGit 也只序列化为一个 XML 文件，没有 ABAP 源码副本。早期版本 pull 会额外生成只读的 `.type.abap` 伪 DDL 侧车，该侧车已移除（`.type.abap` 是 AFF type pool 的源码文件名，与 `TYPE` 冲突）；旧文件会被忽略，push 始终只读 `.ttyp.json`。

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

预定义行类型把长度/小数放在行类型旁边（`table of char10`）：

```json
{
  "formatVersion": "1",
  "header": { "description": "char10 rows", "originalLanguage": "EN" },
  "accessType": "standard",
  "lineType": { "rowType": "CHAR", "rowTypeLength": 10 }
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `accessType` | enum | `standard` / `sorted` / `hashed`（对应 DD40V-ACCESSMODE `T` / `S` / `H`） |
| `lineType.rowType` | string | 行类型名：repository 类型（DTEL / STRU / TABL / 表类型）或 DDIC 预定义数据类型名（`CHAR` / `NUMC` / `DEC` / `DATS` / `INT4` / `STRING` …）。ABAP 类型码 `C` / `I` / `P` 不是 DDIC 名，会被当作字典类型引用 |
| `lineType.rowTypeLength` | integer | 可选，仅预定义行类型：长度（ADT `ttyp:length`，0–999999） |
| `lineType.rowTypeDecimals` | integer | 可选，仅预定义行类型：小数位（ADT `ttyp:decimals`） |
| `lineType.rowStructure` | object | 内联行结构（无 DDIC 表类型表示），`create` / `push` 报 `TTYP_ROW_STRUCTURE_UNSUPPORTED`（exit 7） |
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

- **内联行结构不支持**：`lineType.rowStructure` 没有 DDIC 表类型的表示（行类型必须是 repository 类型），`create` / `push` 在本地报 `TTYP_ROW_STRUCTURE_UNSUPPORTED`（exit 7），提示在 SE11 / ADT 维护内联行结构或改用 `lineType.rowType`；ICF 兜底同样要求 `lineType.rowType`
- **预定义行类型用 DDIC 数据类型名**：`table of char10` 在本地是 `lineType: { rowType: "CHAR", rowTypeLength: 10 }`。写成 ABAP 类型码（`C` / `I` / `P` …）不会被当作预定义类型，会被当成字典类型引用并在激活时报错；迁移时按 `C→CHAR`、`N→NUMC`、`P→DEC`、`D→DATS`、`T→TIMS`、`F→FLTP`、`X→RAW`、`I→INT4` 转换
- **长度/小数只在预定义行类型上生效**：字典行类型的 `rowTypeLength` / `rowTypeDecimals` 在写 wire 时被忽略（SAP 从被引用对象推导）；`rowTypeLength` / `rowTypeDecimals` 必须与 `rowType` 同时出现（schema `dependentRequired`）
- **同名的 DTEL 会被预定义类型覆盖**：`rowType` 命中预定义数据类型名（如 `CHAR`）时按预定义行类型写出；确实要引用同名数据元素只能在 SE11 里维护该表类型
- **描述语言 = 登录语言**：ADT 只在 `adtcore:language`/`masterLanguage` 等于登录语言时持久化 DDIC 描述；CLI 写入统一用 profile 语言，pull 的 `originalLanguage` 因此通常是登录语言
- **`accessType: standard` 忽略 `keyDefinition`**：SAP 侧标准表不存键序，pull 回来会是空数组
- **通道缓存**：`detectChannel` 在进程生命周期内缓存决策；单测需调 `clearChannelCache()`

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 真实 SAP 回归：本地 `tests/260904001-ttyp-real-sap/`、`tests/261102014-quality-debt/`（gitignored，本地执行证据，不入库）
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
