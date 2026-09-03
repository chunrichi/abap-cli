---
type: object-type
title: TRAN — 事务码（SE93 Transaction Code）
description: TRAN 对象的字段契约、5 种 transactionType、嵌套结构
tags: [abap-cli, object-type, tran, icf, abap-file-format, transaction, se93]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# TRAN — 事务码（SE93 Transaction Code）

## 路由

**ICF 自建**（`/sap/zabap_vibe/tran/<name>`）。SE93 没有 ADT 端点；走 ICF 自托管。

## 本地文件形态

```
src/trans/<code>/
└── <code>.tran.json
```

## `<code>.tran.json` 形状（abap-file-format）

事务码有 5 种 `transactionType`，每种有自己的字段块：

### Dialog 事务（最常见）

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My dialog transaction",
    "originalLanguage": "en"
  },
  "generalInformation": {
    "transactionType": "dialogTransaction",
    "lockStatus": "notLocked",
    "dialogTransaction": {
      "programName": "SAPMZMY_DIALOG",
      "programDynnr": "0100",
      "stvMaintenanceMode": "allowed"
    }
  }
}
```

### OO 事务（调类方法）

```json
{
  "formatVersion": "1",
  "header": { "description": "OO transaction", "originalLanguage": "en" },
  "generalInformation": {
    "transactionType": "ooTransaction",
    "ooTransaction": {
      "className": "ZCL_MY_TRANS",
      "methodName": "MAIN"
    }
  }
}
```

### Parameter 事务（参数化调用）

```json
{
  "formatVersion": "1",
  "header": { "description": "Parameter transaction", "originalLanguage": "en" },
  "generalInformation": {
    "transactionType": "parameterTransaction",
    "parameterTransaction": {
      "parParentTransactionCode": "SE80",
      "skipInitialScreenMode": "skip",
      "parameterValues": [
        { "parameterName": "OBJECT_NAME", "parameterValue": "ZMY_OBJ" },
        { "parameterName": "OBJECT_TYPE", "parameterValue": "CLAS" }
      ]
    }
  }
}
```

### Report 事务（报表）

```json
{
  "formatVersion": "1",
  "header": { "description": "Report transaction", "originalLanguage": "en" },
  "generalInformation": {
    "transactionType": "reportTransaction",
    "reportTransaction": {
      "reportName": "ZMY_REPORT",
      "reportDynnr": "1000",
      "reportVariantName": "DEFAULT"
    }
  }
}
```

### Variant 事务

```json
{
  "formatVersion": "1",
  "header": { "description": "Variant transaction", "originalLanguage": "en" },
  "generalInformation": {
    "transactionType": "variantTransaction",
    "variantTransaction": {
      "varParentTransactionCode": "SE38",
      "transactionVariantName": "ZMY_VAR"
    }
  }
}
```

## 关键字段（事务级别）

| 字段 | 说明 |
|---|---|
| `name` | 事务码（≤20 字符） |
| `transactionType` | 5 种之一 |
| `lockStatus` | `locked` / `notLocked` |
| `abapLanguageVersion` | `standard` / `keyUser` / `cloudDevelopment` |

各 transactionType 块见上面的 5 个示例。

## 命令示例

```bash
# 解析事务码（只读 → 不需要 ICF 部署？TODO：核对）
abap tcode SE93 --json

# 拉取
abap pull SE93 --type TRAN --json

# 创建
abap create TRAN ZMY_TCODE --file src/trans/zmy_tcode/zmy_tcode.tran.json \
  --package $TMP --description "demo" --tr $TMP --json
```

## abap-file-format 合规性

✅ 与 `transaction-v1.json` 对齐；嵌套结构完整。

## 已知坑

- **`programDynnr` 必须是 4 位**：如 `0100`、`1000`
- **`transactionType` 与对应块必须一致**：填 `dialogTransaction` 但没 `dialogTransaction` 块 → SAP 端拒
- **Pull 时 ICF 服务必须已部署**：TRAN 走 ICF 通道，与 HTTP/DDIC 同依赖

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- `abap tcode` 命令：[`wiki/commands/tcode.md`](../commands/tcode.md)
