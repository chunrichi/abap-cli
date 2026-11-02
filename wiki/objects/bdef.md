---
type: object-type
title: BDEF — 行为定义（Behavior Definition）
description: BDEF 的 ADT 路由、.bdef.json + .bdef.abdl 两件套与 create/pull/push/delete
tags: [abap-cli, object-type, bdef, adt, rap, behavior-definition, abap-file-format]
created at: 2026-11-01 00:20:00
changed at: 2026-11-02 21:48:00
---

# BDEF — 行为定义（Behavior Definition）

RAP behavior definition，源码是 ABAP Behavior Language（`.abdl`）。ADT object URL：
`/sap/bc/adt/bo/behaviordefinitions/<name>`。

## 路由（仅 ADT，无兜底）

| 操作 | 路径 |
|---|---|
| pull | `GET /sap/bc/adt/bo/behaviordefinitions/<name>`（object structure + source） |
| push | 标准 ADT source 写（`abap push <name>.bdef.abdl`） |
| create | `POST /sap/bc/adt/bo/behaviordefinitions`（blueSource 头）→ lock/PUT `source/main` → activate；`abap create BDEF --file <name>.bdef.json` |
| delete | 通用 ADT lock → DELETE → unlock（`abap delete <name> --type BDEF --yes`） |

`abap-adt-api` 的 `CreatableTypeIds` 不含 BDEF，因此 create 由 CLI 直接构造 blueSource 请求（`clients/bdef.ts`）。

ICF 服务不承载 CDS / RAP 源对象，所以 BDEF 没有 ICF 兜底。

## 本地文件形态（两件套）

```
src/
├── zrb_travel_bdef.bdef.json   # AFF 元数据（bdef-v1.json）
└── zrb_travel_bdef.bdef.abdl   # ABAP Behavior Language 源码
```

- `pull` 一次写两个文件。
- `push` 推的是源码侧车 `.bdef.abdl`，不是 `.json`。

## `bdef.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Travel behavior definition",
    "originalLanguage": "EN"
  }
}
```

## 命令矩阵

| 操作 | 支持 | 说明 |
|---|---|---|
| `pull` | ✅ | 写 `.bdef.json` + `.bdef.abdl` |
| `push` | ✅ | 推 `.bdef.abdl`（ADT source 路径，对象须已存在） |
| `create` | ✅ | `abap create BDEF <name> --file <name>.bdef.json --package <pkg>`；读取同目录 `.bdef.abdl`，创建头 → 写源码 → 激活 |
| `create local` | ❌ | `TYPE_NOT_SUPPORTED`；需要骨架就手写或先 pull 一份同类对象 |
| `delete` | ✅ | 通用 ADT 删除（真机验证） |

## 已知坑

- **create 需要两件套**：`.bdef.json`（AFF 元数据）+ 同目录 `.bdef.abdl`（BDEF 源码）；缺源码直接 `VALIDATION_ERROR`，不会只建空对象。
- **源码必须是可激活的 BDEF**：行为定义要指向存在的 root entity（`managed` 还需要实现类；也可以引用已存在的 `unmanaged implementation in class ...`）。源码语法错误会在 activate 阶段报 `ACTIVATION_FAILED`，对象已写入但保持 inactive。
- **`push` 不会隐式创建对象**：`push .bdef.abdl` 前对象必须已存在，否则 `OBJECT_NOT_FOUND`。
- **`pull` 读的是 blueSource 资源**：`source/main` 的 URI 是 collection-relative（`./<name>/source/main`），CLI 已在 `formats/object-parts.ts` 做绝对化。
- **真机证据（2026-11-02，S/4HANA profile `test`）**：`create BDEF`（$TMP，blueSource + `.abdl`）→ `pull` 两件套 → `delete` 全链路通过；验证对象已清理。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
