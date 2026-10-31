---
type: object-type
title: DCLS — CDS 访问控制（Access Control）
description: DCLS 的 ADT 路由、.dcls.json + .dcls.acds 两件套与 create → push 两步写路径
tags: [abap-cli, object-type, dcls, adt, cds, access-control, abap-file-format]
created at: 2026-11-01 00:20:00
changed at: 2026-11-01 00:20:00
---

# DCLS — CDS 访问控制（Access Control）

CDS access control 源对象（`define role ...`），ADT object URL：
`/sap/bc/adt/dcls/dc/<name>`。

## 路由（仅 ADT，无兜底）

| 操作 | 路径 |
|---|---|
| create | ADT typed `createObject`（`objtype: 'DCLS/DL'`）只注册元数据对象 |
| pull | `GET /sap/bc/adt/dcls/dc/<name>`（object structure + source） |
| push | 标准 ADT source 写（`abap push <name>.dcls.acds`） |
| delete | 通用 ADT lock → DELETE → unlock（`abap delete <name> --type DCLS --yes`） |

ICF 服务不承载 CDS 源对象，所以 DCLS 没有 ICF 兜底。

## 本地文件形态（两件套）

```
src/
├── zmy_travel_dcls.dcls.json   # AFF 元数据（dcls-v1.json）
└── zmy_travel_dcls.dcls.acds   # access control 源码
```

- `pull` 一次写两个文件。
- `push` 推的是源码侧车 `.dcls.acds`，不是 `.json`。

## `dcls.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Travel access control",
    "originalLanguage": "EN"
  }
}
```

## 写路径（两步）

```bash
# 1) 建对象：--file 必填，同名 .dcls.acds 侧车必须已存在
abap create DCLS ZMY_TRAVEL_DCLS --file src/zmy_travel_dcls.dcls.json \
  --package ZPKG --description "Travel access control" --tr DEVK900001 --yes

# 2) 把源码写进对象
abap push src/zmy_travel_dcls.dcls.acds --tr DEVK900001 --yes
```

失败面：`--file` 缺失 → `USAGE`（exit 2）；`.dcls.acds` 缺失 → `VALIDATION_ERROR`；
对象已存在 → `OBJECT_EXISTS`。

## 命令矩阵

| 操作 | 支持 | 说明 |
|---|---|---|
| `create` | ✅ | `--file` 必填 + 同名 `.dcls.acds` 侧车；`--description` 必填 |
| `pull` | ✅ | 写 `.dcls.json` + `.dcls.acds` |
| `push` | ✅ | 推 `.dcls.acds`（ADT source 路径） |
| `create local` | ❌ | `TYPE_NOT_SUPPORTED`（无本地骨架模板） |
| `delete` | 通用 ADT 删除 | 未真机验证 |

## 已知坑

- **create 只建元数据壳**：源码要再 `push` 一次；两步都成功才算闭环。
- **`.dcls.acds` 缺失时 create 直接拒绝**：避免在 SAP 侧留下没有源码的对象。
- **真机证据**：未验证（本仓库当前没有 DCLS 的 `tests/` 证据；mock/unit 见 `test/unit/create-cds-extension-srvd.test.ts`、`test/unit/pull-cds-extension.test.ts`）。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
