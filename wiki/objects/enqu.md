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

## `lockMode` ↔ SAP `ENQMODE`

SAP stores the lock mode as a single character (`DD26E-ENQMODE`, one row per table). The AFF `lockMode` enum is derived from DDIC domain `ENQMODE`; its fixed values and English texts map 1:1, in the same order:

| SAP | Domain text (DD07T, EN) | AFF `lockMode` |
|---|---|---|
| `E` | Write Lock | `exclusive` |
| `S` | Shared Lock | `shared` |
| `X` | Exclusive, not cumulative | `exclusiveNotCumulative` |
| `O` | Set Optimistic Lock | `setOptimistic` |
| `R` | Promote optimistic lock; transform from '0' to 'E' | `promoteOptimistic` |
| `U` | Only conflict check extended exclusive lock, as with 'X' | `conflictCheckExtendedExcl` |
| `V` | Only conflict check exclusive lock, as with 'E' | `conflictCheckExclusive` |
| `W` | Conflict check for shared lock only, as with 'S' | `conflictCheckShared` |
| `C` | Only promotion check optimized lock, as with 'R' | `promotionCheckOptimized` |
| `T` | Reserved | `reserved1` |
| `+` | Reserved | `reserved2` |
| (initial) | — | `initial` |

## SAP 侧读路径（已实现）

`read_enqu` 走 `DDIF_ENQU_GET`（函数组 `SDIF`）：

```
CALL FUNCTION 'DDIF_ENQU_GET'
  EXPORTING name = <lock object>  state = 'A'  langu = sy-langu
  IMPORTING gotstate = <state>    dd25v_wa = <header>
  TABLES    dd26e_tab = <lock modes>  dd27p_tab = <lock parameters>  ddena_tab = <>
```

- `DD25V-DDTEXT` → `header.description`；`DD25V-ROOTTAB` → `primaryTable.name`
- `DD26E` 只有 `ENQMODE` 一个字段，按参与表的位置一一对应（主表在前，其余按 `DD27P-TABNAME` 首次出现的顺序）→ 每张表的 `lockMode`
- `DD27P` 每行一个锁参数：`VIEWFIELD` → `name`，`TABNAME` → `table`，`FIELDNAME` → `field`

## 当前实现状态

| 环节 | 状态 |
|---|---|
| `GET /ddic/enqu/<name>`（pull） | **已实现**（上面的 `DDIF_ENQU_GET` 读路径） |
| `POST /ddic/enqu`（create / push） | 未实现，返回 `ENQU_NOT_IMPLEMENTED` |

`create` 走 `DDIF_ENQU_PUT`（同样在函数组 `SDIF`，参数为 `name` + `dd25v_wa` + `dd26e_tab` + `dd27p_tab`），待补。

两个字段尚未映射，均为 AFF 可选、CLI 读取时默认 `false`：

- `lockModules.allowRfc` —— 对应哪个 SAP 标志位尚未确认（`DD25V` 上没有明显匹配的 flag）。
- `lockParameters[].active` —— SAP 侧未找到对应标志，读取时固定为 `true`（AFF 默认值）。

因此 `pull → push` 往返不会保留被设置的 "allow RFC"。

