---
type: object-type
title: DTEL — 数据元素（Data Element）
description: DTEL 对象的字段契约、单 JSON 嵌套结构、长文本伴生文件、与 DOMA 的关系
tags: [abap-cli, object-type, dtel, ddic, icf, abap-file-format, data-element]
created at: 2026-09-01 00:00:00
changed at: 2026-10-31 17:05:00
---

# DTEL — 数据元素（Data Element）

## 路由

**ICF 自建**：对象读写 `/sap/abap_cli/ddic/DTEL/<name>`，长文本 `/sap/abap_cli/ddic/DTEL/<name>/docu`。

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
src/
├── zmy_dtel.dtel.json        # 对象定义（必需）
└── zmy_dtel.dtel.docu.json   # 长文本（0..1，可选）
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

## 长文本伴生文件（`<name>.dtel.docu.json`）

数据元素的长文本（SAP 端 DOKIL/DOKTL 文档）是 0..1 伴生文件，规则与 DOMA 完全相同：

```json
{
  "formatVersion": "1",
  "lines": [
    { "format": "H1", "line": "Customer number" },
    { "format": "", "line": "Unique customer identifier" }
  ]
}
```

- `line` ≤ 72 字符、`format` ≤ 2 字符（SAPscript 段落格式，`""` = 纯文本）；超限 push 前被 CLI 以 `AFF_FIXTURE_INVALID` 拒绝。
- 单语言：服务端按对象 TADIR 主语言读写；SAPscript 标记原样保留。
- `lines: []`（或省略 `lines`）= push 时删除远端长文本；伴生文件不存在 = 不碰远端长文本。
- pull 有长文本才落盘；`--overwrite` 且远端无文本时删除本地陈旧伴生（`DOCU_LOCAL_STALE_REMOVED` warning）。docu 端点失败只记 `DOCU_PULL_FAILED` warning，主对象照常拉取。

```bash
abap pull ZMY_DTEL --type DTEL --overwrite --json
abap push src/zmy_dtel.dtel.json --yes --json          # 伴生自动跟随；data.results[].docu: saved|deleted
abap validate:aff src/zmy_dtel.dtel.docu.json
```

## 命令示例

```bash
abap create DTEL ZMY_DTEL --package $TMP --description "data elem" --tr $TMP --json
abap pull ZMY_DTEL --json
abap push src/zmy_dtel.dtel.json --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 嵌套结构与 `dataelement-v1.json` 对齐；`dataTypeInformation.category` 支持 `domain` / `predefinedType` / `typeRef` 三类别。

## 已知坑

- **长文本伴生不要单独 push**：直接 `abap push src/zmy_dtel.dtel.docu.json` 会被 `INVALID_ARGUMENT`（exit 2）拒绝，推主文件即可。
- **`typeRef` 第三类别（TTYP 引用）**（commit `28235e2`）：本地 `dataTypeInformation: { category: 'typeRef', typeName, referencedTypeName? }` ↔ wire `typeRef: { typeName, referencedTypeName? }`；未知 category（如 `referenceClasIntType`）→ `DTEL_CATEGORY_UNSUPPORTED`（exit 7）
- **DTEL 的 DOMA 必须先激活**：push DTEL 时如果 `dataElement.domain` 引用的 DOMA 不存在或未激活，SAP 端会拒
- **`shortText` 是 10 字符限制**：CLI 不校验长度；超长时 SAP 端报 `TEXT_TOO_LONG`

# references

- DOMA 文档：[`wiki/objects/doma.md`](doma.md)
- 类型索引：[`wiki/objects/index.md`](index.md)
