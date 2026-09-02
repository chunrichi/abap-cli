---
type: object-type
title: TABL — 透明表（数据库表）
description: TABL 对象的三件套文件格式（main + ddic + settings）、关键字段、已知坑
tags: [abap-cli, object-type, tabl, ddic, icf, abap-file-format, transparent-table]
created at: 2026-09-01 00:00:00
changed at: 2026-09-02 22:06:00
---

# TABL — 透明表（数据库表）

## 路由

**ICF 自建**。需要先 `abap extension deploy`；走 `/sap/zabap_vibe/ddic/TABL/<name>`。原因见 [design-decisions/002](../design-decisions/002-icf-bypass-ddic.md)。

## 本地文件形态（abap-file-format 三件套）

```
src/tabl/zmy_table/
├── zmy_table.tabl.json         # main（header + formatVersion）
├── zmy_table.tabl.ddic         # DDL 源码（字段声明）
└── zmy_table.tabl.settings.json  # generalInformation（deliveryClass / sizeCategory 等）
```

### `zmy_table.tabl.json`

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My table",
    "originalLanguage": "en"
  }
}
```

### `zmy_table.tabl.ddic`

```
@EndUserText.label : 'My table'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
define table zmy_table {
  key client : abap.clnt not null;
  key carrid : abap.char(3) not null;
  connid    : abap.numc(4);
  price     : abap.curr(15, 2);
  currency  : abap.cuky;
}
```

支持的字段类型子集：`abap.clnt` / `abap.char(n)` / `abap.numc(n)` / `abap.curr(p,s)` / `abap.cuky` / `abap.quan(p,s)` / `abap.unit` / `abap.dats` / `abap.tims` / `abap.int1/2/4/8` / `abap.dec(p,s)` / `abap.fltp16/34` 等。

### `zmy_table.tabl.settings.json`

```json
{
  "formatVersion": "1",
  "generalInformation": {
    "deliveryClass": "A",
    "dataClass": "TRANSP",
    "sizeCategory": "0"
  }
}
```

`deliveryClass` 取值：`A`（应用表）/ `C`（客户表）/ `L`（存表）/ `W`（系统表）/ `E`（控制表）。`sizeCategory` 取值 `0`–`9`。

## 关键字段约定

- **`client` / `MANDT`**：CLI 自动剥掉用户声明的 CLIENT/MANDT 字段（防止与 SAP 自动注入冲突），并返回 `CLIENT_FIELD_STRIPPED` 诊断
- **`key` 关键字**：DDL 源里的 `key` 对应 abap-file-format 的 `keyFlag: true`
- **`.INCLUDE` / `.INCLU--AP`**：24 版支持；`precField` 字段保存 include 目标结构名
- **DDL 扩展解析**（commit `185252b`）：`.INCLUDE ... WITH SUFFIX <suffix>` → `field.includeSuffix`；多列复合 key；行内 foreign key 与 `@AbapCatalog.foreignKeys` 块 → `field.foreignKeys[]`；`@ClientHandling.type` → 显式覆盖 `clientDependent`

## 命令示例

```bash
# 创建（三件套齐全）
abap create TABL ZMY_TABLE --package $TMP --description "demo" --tr $TMP --json

# 拉取
abap pull ZMY_TABLE --json

# push（修改字段后）
abap push src/tabl/zmy_table/ --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 三件套完全合规；嵌套结构由 CLI 在 `formats/ddic/json.ts` 内部做 wire ↔ local 双向映射。push 与 create 同走三件套探测（`.tabl.ddic` / `.settings.json`，commit `185252b`）。

## 已知坑

- **fallback 行为**：create 时如果只给 main JSON（无 ddic/settings），CLI 自动回退到 legacy wire-flat 单文件（向后兼容）
- **append structure（`.INCLU--AP`）**：pull 时按 024 实现；写入时需要 Z 段 DDIC 后端配合
- **fixme B（pull.md）**：`<name>.tabl.json` 的 `deliveryClass`/`dataClass`/`sizeCategory` 是否要进 main 还是 settings.json？当前 main 只含 `formatVersion` + `header`，详细在 settings.json

# references

- abap-file-format TABL 规范：`https://github.com/SAP/abap-file-formats/tree/main/file-formats/tabl`
- 实现：[`src/abap_cli/formats/ddic/tabl-artifact.ts`](../../src/abap_cli/formats/ddic/tabl-artifact.ts)、[`src/abap_cli/formats/ddic/json.ts`](../../src/abap_cli/formats/ddic/json.ts)
- 类型索引：[`wiki/objects/index.md`](index.md)
