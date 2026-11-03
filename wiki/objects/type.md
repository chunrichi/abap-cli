---
type: object-type
title: TYPE — 类型池（Type Pool / TYPE-POOL）
description: TYPE 的 ADT typegroups 端点、type-v1 AFF 契约、.type.abap 源码、5 字符名称上限与真机证据
tags: [abap-cli, object-type, type, type-pool, abap-file-format, adt]
created at: 2026-11-03 21:10:00
changed at: 2026-11-03 21:10:00
---

# TYPE — 类型池（Type Pool）

经典 ABAP 的**类型池**（`TYPE-POOL <name>.` + `TYPES …`）。上游 AFF 官方 `type-v1.json`，本地是「头 JSON + `.type.abap` 源码」两件套——与 abapGit 的 `<name>.type.xml` + `<name>.type.abap` 对应（abapGit 元数据是 XML，这里是 JSON）。

## 路由（单通道 ADT）

| 操作 | ADT 端点 |
|---|---|
| create | `POST /sap/bc/adt/ddic/typegroups`（`application/vnd.sap.adt.ddic.typegroups.v3+xml`，根 `atypgr:abapTypeGroup`） |
| pull | `GET /sap/bc/adt/ddic/typegroups/<name>`（元数据）+ `…/<name>/source/main`（`text/plain`） |
| push | lock → `PUT …/<name>/source/main` → `PUT …/<name>`（同步描述）→ unlock → activate |
| delete | lock → `DELETE …/<name>` → unlock（非 `$` 包需 `--tr`） |

`create` 后对象为 **inactive**，CLI 默认自动激活（`--no-activate` 只写）。

## 本地文件形态

```
src/
├── zmyty.type.json    # AFF 元数据（仅 header）
└── zmyty.type.abap    # 经典 ABAP 源码（TYPE-POOL ... TYPES ...）
```

## 形状

`zmyty.type.json`：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "my type pool",
    "originalLanguage": "en"
  }
}
```

`zmyty.type.abap`：

```abap
TYPE-POOL ZMYTY.

TYPES zmyty_char10 TYPE c LENGTH 10.

TYPES: BEGIN OF zmyty_s,
         field TYPE zmyty_char10,
       END OF zmyty_s.
```

## 关键点

- **名称上限 5 字符**（typestructure `TYPE/DG`，经典 type pool 规则：首字符字母，后续字母/数字/下划线）。CLI 在 create 前本地校验，超长报 `VALIDATION_ERROR` 并给出改名建议。
- **AFF 元数据只有 header**：字段就是 `description` + `originalLanguage`；对象正文在 `.type.abap`。
- **push 同步描述**：AFF `header.description` 存在对象元数据里，push 在同一把锁内写源码并 PUT 元数据，`pull → 改描述/源码 → push → pull` 往返一致。
- **`.type.abap` 是 TYPE pool 专属文件名**：不要与表类型（TTYP）混淆——TTYP 是纯 DDIC 元数据，没有 ABAP 侧车（详见 [ttyp.md](ttyp.md)）。
- 该类型只在 ADT 通道可用；没有 ICF 兜底。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- 探测：POST typegroups → 写 source/main → activate 全通；删除后 GET 返回 `%_C<NAME> does not exist`。
- create `ZMYTY`（5 字符）+ `.type.abap` → 激活成功；`pull` 写出两件套。
- 改描述与源码后 `push` → 激活；再次 `pull` 与本地逐字节一致。
- 反例：6 字符名称本地即报 `VALIDATION_ERROR`；缺 `.type.abap` 不触达 SAP。
