---
type: object-type
title: NROB — 编号范围对象（Number Range Object）
description: NROB 对象的 ICF 路由、interval / configuration 字段契约、Z/Y 命名规则
tags: [abap-cli, object-type, nrob, icf, abap-file-format, number-range]
created at: 2026-09-16 00:00:00
changed at: 2026-09-16 00:00:00
---

# NROB — 编号范围对象（Number Range Object）

## 路由（单通道 ICF）

| 操作 | 端点 |
|---|---|
| create | `POST /sap/zabap_vibe/ddic/nrob` |
| pull | `GET /sap/zabap_vibe/ddic/nrob/<name>` |
| push | `GET`（存在性探测）→ `POST /sap/zabap_vibe/ddic/nrob` |

`abap-adt-api` 没有 NROB 端点，ICF 是唯一路径。registry 里标 `source: 'ADT'` 只是因为 NROB 不属于 `DDIC_TYPES`（后者驱动 `ICF_PUSH_HANDLERS` 的自动展开）；`resolveFile` 因此给出 `route: 'adt'`，`pushOne` 用 `CHANNEL_ROUTED_PUSH.NROB` 在通用源码分支**之前**拦截，实际通道固定为 `icf`。

ICF handler 由 `zcl_abap_vibe_icf` 的 `/ddic/nrob` 分支 + `zcl_abap_vibe_nrob_format` 提供。

## 本地文件形态

```
src/nrob/znr_doc_id/
└── znr_doc_id.nrob.json
```

单文件，无侧车。

## `ZNR_DOC_ID.nrob.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Document ID",
    "originalLanguage": "en"
  },
  "interval": {
    "numberLengthDomain": "ZNR_DOC_ID",
    "percentWarning": 10,
    "subType": "ZDE_DOC_ID",
    "untilYear": false,
    "rolling": true,
    "prefix": false
  },
  "configuration": {
    "buffering": "mainBuffer",
    "bufferedNumbers": 10
  }
}
```

## 关键字段

### `interval`（全部必填）

| 字段 | 类型 | 说明 |
|---|---|---|
| `numberLengthDomain` | string | 决定编号长度的域（NUMC/CHAR，1–20 位）——与编号范围对象名是两个概念 |
| `percentWarning` | number | 剩余编号告警阈值，0.1–99.9，步长 0.1 |
| `subType` | string | 子对象绑定用的数据元素（需有检查表，域长 1–6） |
| `untilYear` | boolean | 是否按会计年度区分区间 |
| `rolling` | boolean | 区间用尽后是否回卷 |
| `prefix` | boolean | 编号是否带子对象前缀 |

### `configuration`

| 字段 | 类型 | 说明 |
|---|---|---|
| `buffering` | string | 缓冲模式枚举：`mainBuffer` / `parallel` / `none`，默认 `mainBuffer` |
| `bufferedNumbers` | integer | 缓冲区预留编号数，0–99999999，默认 10 |
| `transactionId` | string | 可选，应用专用事务码（≤ 20 字符） |

## 命名规则

编号范围对象名必须以 `Z` / `Y` / `/` 开头，否则 `create` 在本地即报 `INVALID_ARGUMENT`（exit 2），不发起 SAP 调用。

## 当前实现状态

SAP 侧落库路径尚未实现：`zcl_abap_vibe_nrob_format#read_nrob` 与 `zcl_abap_vibe_icf#create_ddic_nrob` 直接返回 `NROB_NOT_IMPLEMENTED`，CLI 会如实透传该错误码（category `SAP_ERROR`）。dispatch 已接通，因此错误是精确的"未实现"，而不是 `NOT_FOUND`。
