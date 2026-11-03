---
type: object-type
title: DSFI — CDS 标量函数实现引用（Scalar Function Implementation Reference）
description: DSFI 的 ADT blueSource + JSON source 端点、dsfi-v1 AFF 契约、_ANA 命名与引擎规则、真机证据
tags: [abap-cli, object-type, dsfi, cds, abap-file-format, adt]
created at: 2026-11-03 20:10:00
changed at: 2026-11-03 20:10:00
---

# DSFI — CDS 标量函数实现引用（Scalar Function Implementation Reference）

CDS 标量函数的**实现引用**。与 DTDC/DTEB/DSFD 不同，DSFI **没有 `.acds` 侧车**：其 ADT `source/main` 就是 AFF JSON 文档本身，本地是单个 `<name>.dsfi.json`。

## 路由（单通道 ADT）

| 操作 | ADT 端点 |
|---|---|
| create | `POST /sap/bc/adt/ddic/dsfi`（`application/vnd.sap.adt.blues.v1+xml`） |
| pull | `GET /sap/bc/adt/ddic/dsfi/<name>`（blueSource 元数据）+ `GET …/<name>/source/main`（`application/json` = AFF JSON） |
| push | lock → `PUT …/source/main`（JSON）→ `PUT …/<name>`（描述）→ unlock → activate |
| delete | lock → `DELETE …/<name>`（非 `$` 包需 `--tr`） |

## 本地文件形态

```
src/
└── zcli_my_func_ana.dsfi.json
```

## 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "analytical implementation of scalar function ZCLI_MY_FUNC",
    "originalLanguage": "en"
  },
  "scalarFunctionName": "ZCLI_MY_FUNC",
  "engine": "analyticalEngine"
}
```

SQL 引擎形态（schema 允许）：

```json
{
  "formatVersion": "1",
  "header": { "description": "sql implementation", "originalLanguage": "en" },
  "scalarFunctionName": "ZCLI_MY_FUNC",
  "engine": "sqlEngine",
  "sqlProperties": {
    "amdpReference": "ZCL_MY_AMDP=>EXECUTE",
    "autoExposedInSqlServices": true
  }
}
```

## 命名与引擎规则（真机实测）

- 对象名必须是 `<scalarFunctionName>_ANA`：ADT 的 WB handler 只接受 **analytical engine** 后缀；
  `_SQL` 等后缀在本版本直接报 `Impl. ref. name must end with supported engine suffix, e.g. '_ANA'`。
  AFF schema 虽列出 `sqlEngine`，但本版本 SAP 层拒绝，CLI 在本地即按 `_ANA` 校验（`VALIDATION_ERROR`，exit 7）。
- `scalarFunctionName` 必须等于对象名去掉 `_ANA` 后缀；引用的 DSFD 必须**已存在并激活**，否则 create 前预检即报
  `OBJECT_NOT_FOUND`（exit 8），提示先创建 DSFD。
- `engine` 可省略（默认为 analytialEngine）；若填写必须与后缀推导结果一致。

## wire ↔ AFF 归一化

- SAP 在 `source/main` 里会写入 `"abapLanguageVersion": ""`（空串）——AFF schema 不接受空串，pull 会丢弃该字段。
- `originalLanguage` 由 SAP 按登录/激活语言回写（本地 `en` 可能读回 `zh`），pull 返回实际值。
- `push` 会在同一把锁内写 JSON 源并 PUT 元数据描述，`pull → 改描述/引擎字段 → push → pull` 一致。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- 先 create+activate DSFD `ZCLI_TC2_FUNC`，再 create `ZCLI_TC2_FUNC_ANA` → 激活成功。
- `pull` 写出单个 `.dsfi.json`（`abapLanguageVersion` 空串已归一化掉）。
- 改描述后 `push` → 激活；再次 `pull` 与本地一致。
- 反例：`_SQL` 后缀被拒；缺少被引用 DSFD 时预检报 `OBJECT_NOT_FOUND`。
- `delete` 成功，之后 `pull` 返回 `OBJECT_NOT_FOUND`。
