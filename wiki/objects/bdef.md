---
type: object-type
title: BDEF — 行为定义（Behavior Definition）
description: BDEF 的 ADT 路由、.bdef.json + .bdef.abdl 两件套与 create 缺口
tags: [abap-cli, object-type, bdef, adt, rap, behavior-definition, abap-file-format]
created at: 2026-11-01 00:20:00
changed at: 2026-11-02 21:25:00
---

# BDEF — 行为定义（Behavior Definition）

RAP behavior definition，源码是 ABAP Behavior Language（`.abdl`）。ADT object URL：
`/sap/bc/adt/bdef/bdefs/<name>`。

## 路由（仅 ADT，无兜底）

| 操作 | 路径 |
|---|---|
| pull | `GET /sap/bc/adt/bdef/bdefs/<name>`（object structure + source） |
| push | 标准 ADT source 写（`abap push <name>.bdef.abdl`） |
| create | ❌ CLI 未接入；ADT 侧有 `POST /sap/bc/adt/bo/behaviordefinitions`（blueSource），`abap-adt-api` 的 `CreatableTypeIds` 不含 BDEF |
| delete | 通用 ADT lock → DELETE → unlock（`abap delete <name> --type BDEF --yes`） |

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
| `create` | ❌ | `TYPE_NOT_SUPPORTED`（exit 7）：CLI 尚未接入 create（ADT 已有 create 端点） |
| `create local` | ❌ | `TYPE_NOT_SUPPORTED`；需要骨架就手写或先 pull 一份同类对象 |
| `delete` | 通用 ADT 删除 | 未真机验证 |

## 已知坑

- **当前没有 CLI create**：要在 SAP 侧新建，先在 ADT / SAP GUI 建好，再 `abap pull` 下来迭代；CLI 的 `create` 只在 schema 的 `allowedValues` 里暴露类型码，实跑报 `TYPE_NOT_SUPPORTED`。ADT 侧存在 `POST /sap/bc/adt/bo/behaviordefinitions`，接入 create 属于下一阶段工作。
- **pull URL 待复核**：当前 `pull` 使用 `/sap/bc/adt/bdef/bdefs/<name>`（历史路径）；ADT discovery 暴露的是 `/sap/bc/adt/bo/behaviordefinitions`，两者差异需在真机上确认后统一。
- **`push` 不会隐式创建对象**：`push .bdef.abdl` 前对象必须已存在，否则 `OBJECT_NOT_FOUND`。
- **真机证据**：未验证（本仓库当前没有 BDEF 的 `tests/` 证据；mock/unit 见 `test/unit/pull-bdef.test.ts`）。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
