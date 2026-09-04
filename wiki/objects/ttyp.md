---
type: object-type
title: TTYP — 表类型（Table Type）
description: TTYP 对象的双通道路由、字段契约、可选 .type.abap 侧车文件
tags: [abap-cli, object-type, ttyp, ddic, adt, icf, abap-file-format, table-type]
created at: 2026-09-04 00:00:00
changed at: 2026-09-04 00:00:00
---

# TTYP — 表类型（Table Type）

## 路由（双通道）

| 系统 | 通道 | 端点 |
|---|---|---|
| S/4HANA、ECC EHP7+（kernel ≥ 753） | ADT | `/sap/bc/adt/ddic/tabletypes/<name>` |
| ECC EHP5 / EHP6（kernel < 753） | ICF 兜底 | `/sap/zabap_vibe/ddic/ttyp/<name>` |

通道由 `flows/edit/channel-detect.ts` 在任何 SAP 调用之前判定，判定结果写入 envelope 的 `data.channel`；走兜底时同时写 `data.fallbackReason: "ECC_EHP6_NO_ADT_TABLETYPE"`。

ICF 兜底由 `zcl_abap_vibe_ttyp_format`（读，DD40L/DD40V + DD42V）与 `zcl_abap_vibe_icf` 的 `/ddic/ttyp` handler（写，`DDIF_TTYP_PUT` + `DDIF_TTYP_ACTIVATE`，lock/unlock 包裹）提供。

## 本地文件形态

```
src/ttyp/zmy_ttyp/
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
  ]
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `accessType` | enum | `standard` / `sorted` / `hashed`（对应 DD40V-ACCESSMODE `T` / `S` / `H`） |
| `lineType.rowType` | string | 行类型引用（DTEL / STRU / TABL / 内建类型如 `STRING`） |
| `lineType.rowStructure` | object | 内联行结构（仅 ADT 通道；ICF 兜底不支持，会返回 `DDIC_TTYP_FORMAT_UNSUPPORTED`） |
| `keyDefinition` | array | 键定义（`sorted` / `hashed` 必需；`standard` 可省） |

## 命令示例

```bash
abap create TTYP ZMY_TTYP --file src/ttyp/zmy_ttyp/zmy_ttyp.ttyp.json --package $TMP --json
abap pull LVC_T_TABL --type TTYP --json
abap push src/ttyp/zmy_ttyp/zmy_ttyp.ttyp.json --tr DEVK900001 --json
```

## abap-file-format 合规性

上游 abap-file-formats **没有** table-type schema（`type/type-v1.json` 是 type-pool，不是表类型）。本项目自维护 `ttyp-v1.json`，文件头标注 `handcrafted`。若上游后续发布官方 schema，以官方为准并迁移 fixture。

## 已知坑

- **内联行结构无法 round-trip**：`lineType.rowStructure`（`ROWTYPE` 为空）在 ICF 兜底通道下报 `DDIC_TTYP_FORMAT_UNSUPPORTED`；ADT 通道可读但 push 会丢失字段文本
- **`accessType: standard` 忽略 `keyDefinition`**：SAP 侧标准表不存键序，pull 回来会是空数组
- **通道缓存**：`detectChannel` 在进程生命周期内缓存决策；单测需调 `clearChannelCache()`

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 真实 SAP 回归：[`tests/260904001-ttyp-real-sap/`](../../tests/260904001-ttyp-real-sap/)
- abap-file-format 导出约定：[`wiki/abap-file-format-export.md`](../abap-file-format-export.md)
