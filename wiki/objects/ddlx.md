---
type: object-type
title: DDLX — CDS 元数据扩展（Metadata Extension）
description: DDLX 的 ADT 路由、.ddlx.json + .ddlx.acds 两件套与 create → push 两步写路径
tags: [abap-cli, object-type, ddlx, adt, cds, metadata-extension, abap-file-format]
created at: 2026-11-01 00:20:00
changed at: 2026-11-01 00:20:00
---

# DDLX — CDS 元数据扩展（Metadata Extension）

CDS metadata extension（`@Metadata.layer` 注解源），ADT object URL：
`/sap/bc/adt/ddlx/extensions/<name>`。

## 路由（仅 ADT，无兜底）

| 操作 | 路径 |
|---|---|
| create | ADT typed `createObject`（`objtype: 'DDLX/EX'`）只注册元数据对象 |
| pull | `GET /sap/bc/adt/ddlx/extensions/<name>`（object structure + source） |
| push | 标准 ADT source 写（`abap push <name>.ddlx.acds`） |
| delete | 通用 ADT lock → DELETE → unlock（`abap delete <name> --type DDLX --yes`） |

ICF 服务不承载 CDS 源对象，所以 DDLX 没有 ICF 兜底。

## 本地文件形态（两件套）

```
src/
├── zmy_travel_ddlx.ddlx.json   # AFF 元数据（ddlx-v1.json）
└── zmy_travel_ddlx.ddlx.acds   # metadata extension 源码
```

- `pull` 一次写两个文件。
- `push` 推的是源码侧车 `.ddlx.acds`，不是 `.json`。

## `ddlx.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Travel metadata extension",
    "originalLanguage": "EN"
  }
}
```

## 写路径（两步）

```bash
# 1) 建对象：--file 必填，同名 .ddlx.acds 侧车必须已存在
abap create DDLX ZMY_TRAVEL_DDLX --file src/zmy_travel_ddlx.ddlx.json \
  --package ZPKG --description "Travel metadata extension" --tr DEVK900001 --yes

# 2) 把源码写进对象
abap push src/zmy_travel_ddlx.ddlx.acds --tr DEVK900001 --yes
```

失败面：`--file` 缺失 → `USAGE`（exit 2）；`.ddlx.acds` 缺失 → `VALIDATION_ERROR`；
对象已存在 → `OBJECT_EXISTS`。

## 命令矩阵

| 操作 | 支持 | 说明 |
|---|---|---|
| `create` | ✅ | `--file` 必填 + 同名 `.ddlx.acds` 侧车；`--description` 必填 |
| `pull` | ✅ | 写 `.ddlx.json` + `.ddlx.acds` |
| `push` | ✅ | 推 `.ddlx.acds`（ADT source 路径） |
| `create local` | ❌ | `TYPE_NOT_SUPPORTED`（无本地骨架模板） |
| `delete` | 通用 ADT 删除 | 未真机验证 |

## 已知坑

- **create 只建元数据壳**：源码要再 `push` 一次；两步都成功才算闭环。
- **`.ddlx.acds` 缺失时 create 直接拒绝**：避免在 SAP 侧留下没有源码的对象。
- **真机证据**：未验证（本仓库当前没有 DDLX 的 `tests/` 证据；mock/unit 见 `test/unit/create-cds-extension-srvd.test.ts`、`test/unit/pull-cds-extension.test.ts`）。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
