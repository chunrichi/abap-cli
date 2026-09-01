---
type: object-type
title: DOMA — 域（Domain）
description: DOMA 对象的字段契约、单 JSON 嵌套结构、关键字段
tags: [abap-cli, object-type, doma, ddic, icf, abap-file-format, domain]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# DOMA — 域（Domain）

## 路由

**ICF 自建**（`/sap/zabap_vibe/ddic/DOMA/<name>`）。

## 本地文件形态（嵌套结构）

```
src/doma/zmy_doma/
└── zmy_doma.doma.json
```

DOMA / DTEL 用**单文件 + 嵌套结构**（而非 TABL/STRU 的三件套）。这与 abap-file-format `domain-v1.json` / `dataelement-v1.json` 对齐。

## `<name>.doma.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My domain",
    "originalLanguage": "en"
  },
  "format": {
    "dataType": "CHAR",
    "length": 10,
    "decimals": 0
  },
  "fixedValues": [
    { "value": "01", "description": "Draft" },
    { "value": "02", "description": "Active" },
    { "value": "03", "description": "Closed" }
  ]
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `format.dataType` | enum | `CHAR` / `NUMC` / `DEC` / `CURR` / `QUAN` / `CUKY` / `DATS` / `TIMS` / `INT1/2/4/8` / `FLTP16/34` / `RAW` / `LANG` / `CLNT` 等 |
| `format.length` | number | 主长度 |
| `format.decimals` | number | 小数位（CURR/QUAN/DEC 时） |
| `signFlag` | boolean | 是否带正负号（仅 `DEC`/`CURR`/`QUAN`） |
| `lowercase` | boolean | 是否小写转换（仅 `CHAR`） |
| `convExit` | string | 转换例程（如 `ALPHA`） |
| `fixedValues` | array | 固定值清单（value + description） |

## 命令示例

```bash
abap create DOMA ZMY_DOMA --package $TMP --description "domain" --tr $TMP --json
abap pull ZMY_DOMA --json
abap push src/doma/zmy_doma/ --tr DEVK900001 --json
```

## abap-file-format 合规性

✅ 嵌套结构与 `domain-v1.json` 对齐；fixedValues 在 CLI 与 ICF 双向映射。

## 已知坑

- **没有 `create local` 骨架**：DDIC 子集仅 `create` + `pull` + `push`，没有离线骨架生成（DDIC 需要 SAP 端激活）
- **`fixedValues` 重复值**：SAP 端会拒绝；CLI 不做去重校验（依赖 SAP 错误码）

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
