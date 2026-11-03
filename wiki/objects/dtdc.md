---
type: object-type
title: DTDC — CDS 动态缓存（Dynamic Cache）
description: DTDC 的 ADT 元数据/源码端点、dtdc-v1 AFF 契约、.acds 侧车与真机证据
tags: [abap-cli, object-type, dtdc, cds, abap-file-format, adt]
created at: 2026-11-03 20:10:00
changed at: 2026-11-03 20:10:00
---

# DTDC — CDS 动态缓存（Dynamic Cache）

CDS 的**动态缓存**定义（`define dynamic cache … on <entity>`），在 ADT 上是一个「元数据 XML + `source/main` 源码」的源对象，和 DDLS 同构。上游 AFF 有官方 `dtdc-v1.json`，本地是「头 JSON + `.acds` 侧车」两件套。

## 路由（单通道 ADT）

| 操作 | ADT 端点 |
|---|---|
| create | `POST /sap/bc/adt/ddic/dtdc/sources`（内容类型 `application/vnd.sap.adt.ddic.dtdc.v1+xml`） |
| pull | `GET /sap/bc/adt/ddic/dtdc/sources/<name>`（元数据）+ `GET …/<name>/source/main`（`.acds`，`text/plain`） |
| push | lock → `PUT …/<name>/source/main` → `PUT …/<name>`（同步描述）→ unlock → activate |
| delete | lock → `DELETE …/<name>` → unlock（非 `$` 包需 `--tr`） |

`create` 后对象是 **inactive**，CLI 默认自动激活。

## 本地文件形态

```
src/
├── zcli_my_cache.dtdc.json      # AFF 元数据（仅 header）
└── zcli_my_cache.dtdc.acds      # CDS 源码
```

## 形状

`zcli_my_cache.dtdc.json`：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "my dynamic cache",
    "originalLanguage": "en"
  }
}
```

`zcli_my_cache.dtdc.acds`：

```cds
define dynamic cache ZCLI_MY_CACHE on spfli
{
   sum(fltime)
}

creation configurable default off
```

## 关键点

- **AFF 元数据只有 header**：字段契约就是 `dtdc-v1.json`（`description` 最长 60、`originalLanguage`、可选 `abapLanguageVersion`），对象正文在 `.acds` 侧车里。
- **push 同步描述**：AFF `header.description` 存在对象元数据里，push 会在同一把锁内写源码并 PUT 元数据，因此 `pull → 改描述/源码 → push → pull` 的 JSON 与 `.acds` 都能往返一致。
- **`originalLanguage` 由 SAP 决定**（登录/激活语言），pull 返回实际值。
- **create 必须提供 `.acds` 侧车**：缺失/空文件在本地即报 `VALIDATION_ERROR`（exit 7），不会发 SAP 请求。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- `create → activate` 成功；`pull` 写出 `.dtdc.json` + `.dtdc.acds`。
- 修改描述与源码（`sum(fltime), count(*)`）后 `push` → activate；再次 `pull` 与本地文件逐字节一致。
- `delete` 成功，之后 `pull` 返回 `OBJECT_NOT_FOUND`（exit 8）。
