---
type: object-type
title: DTEL — 数据元素（Data Element）
description: DTEL 对象的字段契约、单 JSON 嵌套结构、与 DOMA 的关系
tags: [abap-cli, object-type, dtel, ddic, icf, abap-file-format, data-element]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# DTEL — 数据元素（Data Element）

## 路由

**ICF 自建**（`/sap/zabap_vibe/ddic/DTEL/<name>`）。

## 与 DOMA 的关系

DTEL 是「语义层」，DOMA 是「技术层」：

| DOMA | DTEL |
|---|---|
| 纯数据类型 + 长度 + 固定值 | 业务语义 + 标签 + 引用 DOMA |
| `CHAR(10)` | 「客户编号」(引用 ZCUSTOMER_DOMA) |
| 可独立存在 | 必须引用一个 DOMA（除非内联类型） |

> DTEL 可以**不**引用 DOMA（直接声明内联 type），CLI 支持；SAP GUI 也允许。

## 本地文件形态

```
src/dtel/zmy_dtel/
└── zmy_dtel.dtel.json
```

## `<name>.dtel.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Customer number",
    "originalLanguage": "en"
  },
  "dataElement": {
    "domain": "ZCUSTOMER_DOMA",
    "shortText": "Customer",
    "mediumText": "Customer number",
    "longText": "Unique customer identifier",
    "headerText": "Customer"
  }
}
```

或者内联（无 domain）：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Inline element",
    "originalLanguage": "en"
  },
  "format": {
    "dataType": "CHAR",
    "length": 4
  },
  "dataElement": {
    "shortText": "Status code"
  }
}
```

## 命令示例

```bash
abap create DTEL ZMY_DTEL --package $TMP --description "data elem" --tr $TMP --json
abap pull ZMY_DTEL --json
abap push src/dtel/zmy_dtel/ --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 嵌套结构与 `dataelement-v1.json` 对齐。

## 已知坑

- **DTEL 的 DOMA 必须先激活**：push DTEL 时如果 `dataElement.domain` 引用的 DOMA 不存在或未激活，SAP 端会拒
- **`shortText` 是 10 字符限制**：CLI 不校验长度；超长时 SAP 端报 `TEXT_TOO_LONG`

# references

- DOMA 文档：[`wiki/objects/doma.md`](doma.md)
- 类型索引：[`wiki/objects/index.md`](index.md)
