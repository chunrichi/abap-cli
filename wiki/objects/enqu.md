---
type: object-type
title: ENQU — 锁对象（Lock Object）
description: ENQU 对象的 ICF 路由、primaryTable / lockParameters / lockModules 字段契约、EZ/EY 命名规则
tags: [abap-cli, object-type, enqu, icf, abap-file-format, lock-object]
created at: 2026-09-16 00:00:00
changed at: 2026-09-16 00:00:00
---

# ENQU — 锁对象（Lock Object）

## 路由（单通道 ICF）

| 操作 | 端点 |
|---|---|
| create | `POST /sap/zabap_vibe/ddic/enqu` |
| pull | `GET /sap/zabap_vibe/ddic/enqu/<name>` |
| push | `GET`（存在性探测）→ `POST /sap/zabap_vibe/ddic/enqu` |

ENQU 与 TABL / DOMA / DTEL 同走 ICF，没有 ADT 通道：`abap-adt-api` 不暴露锁对象端点，ICF 是唯一路径。registry 里 `source: 'ICF'`，`resolveFile` 直接给出 `route: 'icf'`，`pushOne` 走 `ICF_PUSH_HANDLERS.ENQU`。

ICF handler 由 `zcl_abap_vibe_icf` 的 `/ddic/enqu` 分支 + `zcl_abap_vibe_enqu_format` 提供。

## 本地文件形态

```
src/enqu/ezmy_lock/
└── ezmy_lock.enqu.json
```

单文件，无侧车。

## `EZMY_LOCK.enqu.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My lock object",
    "originalLanguage": "en"
  },
  "primaryTable": { "name": "ZMY_TABL", "lockMode": "exclusive" },
  "secondaryTables": [
    { "name": "ZMY_TABL2", "lockMode": "shared" }
  ],
  "lockParameters": [
    { "name": "CLIENT", "table": "ZMY_TABL", "field": "CLIENT", "active": true },
    { "name": "ID", "table": "ZMY_TABL", "field": "ID", "active": true }
  ],
  "lockModules": { "allowRfc": false }
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `header.description` | string | 锁对象短文本，最长 60 |
| `header.originalLanguage` | string | 两位小写语言码（`en`）。nrob-v1.json 强制 `^[a-z]+$`，ENQU 只校验长度 ≥ 2 |
| `primaryTable.name` | string | 主表名（必填），即被锁的表——与锁对象名是两个概念 |
| `primaryTable.lockMode` | string | 锁模式枚举，默认 `exclusive` |
| `secondaryTables[]` | array | 辅表，必须与主表有外键关系；可选 |
| `lockParameters[]` | array | 锁参数，取自各表主键 |
| `lockParameters[].active` | boolean | 缺省视为 `true` |
| `lockModules.allowRfc` | boolean | 锁模块是否允许 RFC |

## 命名规则

锁对象名必须以下列前缀之一开头，否则 `create` 在本地即报 `INVALID_ARGUMENT`（exit 2），不发起 SAP 调用：

- `EZ*` — 客户命名空间
- `EY*` — 客户命名空间
- `/*` — 显式命名空间

## 当前实现状态

SAP 侧落库路径尚未实现：`zcl_abap_vibe_enqu_format#read_enqu` 与 `zcl_abap_vibe_icf#create_ddic_enqu` 直接返回 `ENQU_NOT_IMPLEMENTED`，CLI 会如实透传该错误码（category `SAP_ERROR`）。dispatch 已接通，因此错误是精确的"未实现"，而不是 `NOT_FOUND`。
