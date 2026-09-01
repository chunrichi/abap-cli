---
type: object-type
title: STRU — 结构（Structure）
description: STRU 对象与 TABL 同构（DDL + main + settings），但无 MANDT 注入；常被用作 type pool / 内部结构
tags: [abap-cli, object-type, stru, ddic, icf, abap-file-format, structure]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# STRU — 结构（Structure）

## 路由

**ICF 自建**（与 TABL 同链路：`/sap/zabap_vibe/ddic/STRU/<name>`）。

## 与 TABL 的差异

STRU 与 TABL **同构**（三件套文件 + DDL 字段定义 + settings）。差异：

| 维度 | TABL | STRU |
|---|---|---|
| DDL 头 | `define table` | `define structure` |
| `@AbapCatalog.tableCategory` | `#TRANSPARENT` / `#POOLED` / `#CLUSTER` | 不需要（结构无表类别） |
| `@AbapCatalog.dataClass` | 必填 | 通常缺省 |
| 自动注入 `MANDT` | ✅（cli 端 `clientDependent` 计算） | ❌（结构本身没有 client 字段） |
| `.INCLUDE` / `.INCLU--AP` | ✅ | ✅（更常用） |
| 激活后会建表 | ✅（物理表） | ❌（仅类型定义） |

## 本地文件形态

```
src/stru/zs_my_struct/
├── zs_my_struct.stru.json
├── zs_my_struct.stru.ddic
└── zs_my_struct.stru.settings.json
```

### `zs_my_struct.stru.ddic`

```
@EndUserText.label : 'My structure'
define structure zs_my_struct {
  carrid : abap.char(3);
  connid : abap.numc(4);
  price  : abap.curr(15, 2);
}
```

## 命令示例

```bash
abap create STRU ZS_MY_STRUCT --package $TMP --description "struct" --tr $TMP --json
abap pull ZS_MY_STRUCT --json
abap push src/stru/zs_my_struct/ --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 与 TABL 同链路；abap-file-format 把 TABL 与 STRU 视为同一 `tabl-v1.json` schema。

## 已知坑

- **结构中嵌 `MANDT`**：CLI 不会像 TABL 那样自动剥离；如果你想表达 client 字段，明确写在 DDL 内
- **嵌套结构引用**：跨包结构引用时 `pull` 会拉取被引结构吗？**不会**——只拉显式指定的对象

# references

- TABL 文档：[`wiki/objects/tabl.md`](tabl.md)
- 类型索引：[`wiki/objects/index.md`](index.md)
