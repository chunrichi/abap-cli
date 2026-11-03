---
type: object-type
title: DTEB — CDS 实体缓冲（Entity Buffer）
description: DTEB 的 ADT 元数据/源码端点、dteb-v1 AFF 契约、可缓冲 view 前置条件与真机证据
tags: [abap-cli, object-type, dteb, cds, abap-file-format, adt]
created at: 2026-11-03 20:10:00
changed at: 2026-11-03 20:10:00
---

# DTEB — CDS 实体缓冲（Entity Buffer）

CDS 的**实体缓冲定义**（`define view entity buffer on <view> layer … type …`），ADT 上是「元数据 XML + `.acds` 源码」的源对象，布局与 DDLS/DTDC 同构。上游 AFF 官方 `dteb-v1.json`。

## 路由（单通道 ADT）

| 操作 | ADT 端点 |
|---|---|
| create | `POST /sap/bc/adt/ddic/dteb/sources`（内容类型 `application/vnd.sap.adt.ddic.dteb.v1+xml`） |
| pull | `GET /sap/bc/adt/ddic/dteb/sources/<name>` + `…/source/main` |
| push | lock → `PUT …/<name>/source/main` → `PUT …/<name>`（描述）→ unlock → activate |
| delete | lock → `DELETE …/<name>`（非 `$` 包需 `--tr`） |

## 本地文件形态

```
src/
├── zcli_my_buffer.dteb.json
└── zcli_my_buffer.dteb.acds
```

## 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "single buffering for my view",
    "originalLanguage": "en"
  }
}
```

```cds
define view entity buffer on ZCLI_MY_VIEW
  layer core
  type single
```

## 关键点（真机踩坑）

- **目标 view entity 必须可缓冲**：被缓冲的 view entity 需要标注
  `@AbapCatalog.entityBuffer.definitionAllowed: true`（以及通常的 `@AccessControl.authorizationCheck: #NOT_REQUIRED`），否则激活报
  `Referred entity <NAME> is not bufferable`。
- **一个实体 + 一个 layer 只允许一个活动缓冲**：同实体同 layer 已有缓冲时激活报
  `There is already the active buffer … on the same layer`。测试/重建时先删除旧 DTEB。
- **AFF 元数据只有 header**，对象正文在 `.acds`。
- **push 同步描述**（同 DTDC）；`originalLanguage` 以 SAP 侧为准。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- 先创建带 `@AbapCatalog.entityBuffer.definitionAllowed: true` 的 view entity
  `ZCLI_TC2_DTEB_VIEW`，再 create `ZCLI_TC2_DTEB` → 激活成功。
- `pull` 写出 `.dteb.json` + `.dteb.acds`；改描述后 `push` → 激活；`pull` 与本地一致。
- `delete` 成功；反例（未标可缓冲的 view）复现 `not bufferable` 激活错误。
