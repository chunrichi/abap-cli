---
type: object-type
title: DRTY — CDS 简单类型（CDS Type / Simple Type）
description: DRTY 的 ADT blueSource 端点、drty-v1 AFF 契约、CDS_SIMPLE_TYPES 用户参数门禁与真机证据
tags: [abap-cli, object-type, drty, cds, abap-file-format, adt]
created at: 2026-11-03 20:30:00
changed at: 2026-11-03 20:30:00
---

# DRTY — CDS 简单类型（CDS Type）

CDS 的**简单类型**（`define type <name> : abap.char(10);`），AFF 官方 `drty-v1.json`。ADT 上是 blueSource 元数据 + `source/main` 源码，布局与 DSFD 同构（元数据 + `.acds` 两件套）。

## 路由（单通道 ADT）

| 操作 | ADT 端点 |
|---|---|
| create | `POST /sap/bc/adt/ddic/drty/sources`（`application/vnd.sap.adt.blues.v1+xml`） |
| pull | `GET /sap/bc/adt/ddic/drty/sources/<name>`（blueSource）+ `…/source/main`（`text/plain`） |
| push | lock → `PUT …/source/main` → `PUT …/<name>`（描述）→ unlock → activate |
| delete | lock → `DELETE …/<name>`（非 `$` 包需 `--tr`） |

## 本地文件形态

```
src/
├── zcli_my_type.drty.json
└── zcli_my_type.drty.acds
```

## 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "my CDS type",
    "originalLanguage": "en"
  }
}
```

```cds
@EndUserText.label : 'my CDS type'
define type zcli_my_type : abap.char( 10 );
```

## 关键点：`CDS_SIMPLE_TYPES` 用户参数门禁

与 DSFD 类似，DRTY 的写路径受**用户参数 `CDS_SIMPLE_TYPES`** 控制（SAP 侧 feature switch）：

- 未启用时 create / 修改 / 删除报
  `CDS types are not yet supported`（消息类 `SD_DRTY`）。
  CLI 映射为 **`DRTY_FEATURE_NOT_ENABLED`**（exit 7），`nextSteps` 给出：
  - SAP GUI → SU3 → Parameter → ID `CDS_SIMPLE_TYPES` = `X`，保存；或
  - ABAP 会话里 `SET PARAMETER ID 'CDS_SIMPLE_TYPES' FIELD 'X'`。
- 启用后全生命周期正常（读不受影响）。
- 名称上限 **40 字符**（typestructure `OBJNAME_MAXLENGTH`）。
- AFF 元数据只有 header；正文在 `.acds`；push 同步描述，`pull → 改描述/源码 → push → pull` 一致。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- 未设参数：create 报 `CDS types are not yet supported`（复现并映射为 `DRTY_FEATURE_NOT_ENABLED`）。
- 用 `SET PARAMETER ID 'CDS_SIMPLE_TYPES' FIELD 'X'` 启用后：create → 写源码 → activate 成功。
- `pull` 写出 `.drty.json` + `.drty.acds`；`push` 更新；`delete` 成功且 TADIR 无残留。

## 同组未接入的类型

`DRAS`（CDS 方面）/ `DTIX`（字典调优索引）/ `DTSC`（字典调优静态缓存）也有官方 AFF schema，但参考 S/4HANA release 的 ADT `typestructure` 没有 CREATE 能力、`discovery` 也没有对应 REST 资源（2026-11-03 实测），因此本版本不提供这四类的 CLI 类型，等有 ADT 通道的 release 再补。
