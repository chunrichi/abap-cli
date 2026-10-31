---
type: object-type
title: DDLA — CDS 注解定义（Annotation Definition）
description: DDLA 的 ADT 路由、.ddla.json + .ddla.acds 两件套与 create → push 两步写路径
tags: [abap-cli, object-type, ddla, adt, cds, annotation-definition, abap-file-format]
created at: 2026-11-01 00:20:00
changed at: 2026-11-01 00:20:00
---

# DDLA — CDS 注解定义（Annotation Definition）

自定义 CDS 注解定义的源对象，ADT object URL：
`/sap/bc/adt/ddla/annotations/<name>`。

## 路由（仅 ADT，无兜底）

| 操作 | 路径 |
|---|---|
| create | ADT typed `createObject`（`objtype: 'DDLA/ADF'`）只注册元数据对象 |
| pull | `GET /sap/bc/adt/ddla/annotations/<name>`（object structure + source） |
| push | 标准 ADT source 写（`abap push <name>.ddla.acds`） |
| delete | 通用 ADT lock → DELETE → unlock（`abap delete <name> --type DDLA --yes`） |

ICF 服务不承载 CDS 源对象，所以 DDLA 没有 ICF 兜底。

## 本地文件形态（两件套）

```
src/
├── zmy_travel_ddla.ddla.json   # AFF 元数据（ddla-v1.json）
└── zmy_travel_ddla.ddla.acds   # annotation definition 源码
```

- `pull` 一次写两个文件。
- `push` 推的是源码侧车 `.ddla.acds`，不是 `.json`。

## `ddla.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Travel annotation definition",
    "originalLanguage": "EN"
  }
}
```

## 写路径（两步）

```bash
# 1) 建对象：--file 必填，同名 .ddla.acds 侧车必须已存在
abap create DDLA ZMY_TRAVEL_DDLA --file src/zmy_travel_ddla.ddla.json \
  --package ZPKG --description "Travel annotation definition" --tr DEVK900001 --yes

# 2) 把源码写进对象
abap push src/zmy_travel_ddla.ddla.acds --tr DEVK900001 --yes
```

失败面：`--file` 缺失 → `USAGE`（exit 2）；`.ddla.acds` 缺失 → `VALIDATION_ERROR`；
对象已存在 → `OBJECT_EXISTS`。

## 命令矩阵

| 操作 | 支持 | 说明 |
|---|---|---|
| `create` | ✅ | `--file` 必填 + 同名 `.ddla.acds` 侧车；`--description` 必填 |
| `pull` | ✅ | 写 `.ddla.json` + `.ddla.acds` |
| `push` | ✅ | 推 `.ddla.acds`（ADT source 路径） |
| `create local` | ❌ | `TYPE_NOT_SUPPORTED`（无本地骨架模板） |
| `delete` | 通用 ADT 删除 | 未真机验证 |

## 已知坑

- **create 只建元数据壳**：源码要再 `push` 一次；两步都成功才算闭环。
- **`.ddla.acds` 缺失时 create 直接拒绝**：避免在 SAP 侧留下没有源码的对象。
- **真机证据**：未验证（本仓库当前没有 DDLA 的 `tests/` 证据；mock/unit 见 `test/unit/create-cds-extension-srvd.test.ts`、`test/unit/pull-cds-extension.test.ts`）。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
