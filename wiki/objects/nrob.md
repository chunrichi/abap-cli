---
type: object-type
title: NROB — 编号范围对象（Number Range Object）
description: NROB 对象的 ADT/ICF 双通道、interval / configuration 字段契约、Z/Y 命名规则
tags: [abap-cli, object-type, nrob, adt, icf, abap-file-format, number-range]
created at: 2026-09-16 00:00:00
changed at: 2026-09-16 16:00:00
---

# NROB — 编号范围对象（Number Range Object）

## 路由（ADT 优先 / ICF 回退）

| 操作 | ADT 通道（S/4HANA / ECC EHP7+） | ICF 回退（ECC EHP5/6） |
|---|---|---|
| create | `POST /sap/bc/adt/numberranges/objects?_action=create&objtype=nrob&objname=<NAME>&corrNr=<TR>` | `POST /sap/zabap_vibe/ddic/nrob` |
| pull | `GET /sap/bc/adt/numberranges/objects/<NAME>/source/main` | `GET /sap/zabap_vibe/ddic/nrob/<NAME>` |
| push | `GET`（存在性）→ `lock` → `PUT /sap/bc/adt/numberranges/objects/<NAME>` → `unlock` | `GET`（存在性）→ `POST /sap/zabap_vibe/ddic/nrob` |

`abap-adt-api` 没有 NROB 端点，CLI 直接打 ADT（`AdtClientWrapper.createNrobSource` / `updateNrobSource`，绕过 abap-adt-api，body 是 AFF JSON，`Content-Type: application/json`）。ICF 是 `channel-detect` 在 ECC EHP5/6 上的回退（`fallbackReason: ECC_EHP6_NO_ADT_NROB`，与 TTYP / MSAG 同档）。

> **关键事实**：NROB 的源文件**本身就是** AFF JSON——`/sap/bc/adt/numberranges/objects/$schema` 端点返回的就是仓库里 vendored 的 `nrob-v1.json`。所以 NROB 不需要 ICF 侧的 SAP-side serializer（不像 TABL / DOMA / DTEL 那样要 `zcl_abap_vibe_*_format` 做 ABAP↔JSON 翻译）：SAP 自己就是 serializer。

registry 里 `source: 'ADT'` + `channel.icfFallback`，`resolveFile` 因此给出 `route: 'adt'`，`pushOne` 用 `CHANNEL_ROUTED_PUSH.NROB` 在通用源码分支**之前**拦截。

## 本地文件形态

```
src/nrob/znr_doc_id/
└── znr_doc_id.nrob.json
```

单文件，无侧车。**文件 basename（去掉 `.nrob.json`）必须与 `interval.numberLengthDomain` 一致**——`push` 在本地校验，不一致直接 `VALIDATION_ERROR`，避免静默把错误的 numberLengthDomain 写到 SAP。

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
| `numberLengthDomain` | string | 决定编号长度的域（NUMC/CHAR，1–20 位）——与编号范围对象名是两个概念；**必须等于文件名 basename** |
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

| 通道 | create | pull | push |
|---|---|---|---|
| ADT（S/4HANA / NW 7.93） | ✅ | ✅ | ✅（lock + PUT + unlock） |
| ICF（ECC EHP5/6） | ✅（`zcl_abap_vibe_nrob_format` 已删除，ICF handler 走 TNRO/TNROT/NRIV 落库；待真机 ECC EHP6 验证） | ✅ | ✅ |

`channel-detect` 在 kernelRelease < 753 时退到 ICF，否则 ADT。fallback 走完后 `data` 里带 `fallbackReason: 'ECC_EHP6_NO_ADT_NROB'`。

> **真机验证现状**：本 session 没有 SAP 可达（`vhcala4hci` 不可达）。ADT 端点的 URL 形态 (`/sap/bc/adt/numberranges/objects/...`) 与 body shape (`application/json` + AFF JSON) 是按 `clients/activation.ts` 的现成模式推断的，**等 SAP 可达后必须用一条 bootstrap create / pull round-trip 实测确认**（特别是 `?_action=create` query 参数与可能的 `Content-Type` 偏好）。当前 28 条单测覆盖本地校验 + channel-detect 决策矩阵。