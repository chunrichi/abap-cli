---
type: object-type
title: SRVD — 服务定义（Service Definition）
description: SRVD 的 ADT 路由、.srvd.json + .srvd.acds 两件套、create → push 两步写路径
tags: [abap-cli, object-type, srvd, adt, rap, cds, abap-file-format]
created at: 2026-11-01 00:20:00
changed at: 2026-11-01 00:20:00
---

# SRVD — 服务定义（Service Definition）

把 CDS 实体组织成 OData service 的 RAP service definition。ADT object URL：
`/sap/bc/adt/srvd/srvds/<name>`。

## 路由（仅 ADT，无兜底）

| 操作 | 路径 |
|---|---|
| create | ADT typed `createObject`（`objtype: 'SRVD/SRV'`）只注册元数据对象 |
| pull | `GET /sap/bc/adt/srvd/srvds/<name>`（object structure + source） |
| push | 标准 ADT source 写（`abap push <name>.srvd.acds`） |
| delete | 通用 ADT lock → DELETE → unlock（`abap delete <name> --type SRVD --yes`） |

ICF 服务不承载 CDS / RAP 源对象，所以 SRVD 没有 ICF 兜底。

## 本地文件形态（两件套）

```
src/
├── zmy_travel_srvd.srvd.json   # AFF 元数据（srvd-v1.json）
└── zmy_travel_srvd.srvd.acds   # service definition 源码（DDL 风格）
```

- `pull` 一次写两个文件；`.srvd.json` 的 `generalInformation.sourceOrigin`
  与 `sourceType`（`definition` / `extension`）由 SAP 元数据派生，并按
  `srvd-v1.json` 的枚举校验（sourceOrigin 共 10 个取值）。
- `push` 推的是源码侧车 `.srvd.acds`，不是 `.json`。

## `srvd.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Travel service",
    "originalLanguage": "EN"
  },
  "generalInformation": {
    "sourceOrigin": "abapDevelopmentTools",
    "sourceType": "definition"
  }
}
```

## 写路径（两步）

`create` 只注册元数据对象，源码由随后的 `push` 落库：

```bash
# 1) 建对象：--file 必填，同名 .srvd.acds 侧车必须已存在
abap create SRVD ZMY_TRAVEL_SRVD --file src/zmy_travel_srvd.srvd.json \
  --package ZPKG --description "Travel service" --tr DEVK900001 --yes

# 2) 把源码写进对象
abap push src/zmy_travel_srvd.srvd.acds --tr DEVK900001 --yes
```

失败面：`--file` 缺失 → `USAGE`（exit 2）；`.srvd.acds` 缺失 → `VALIDATION_ERROR`；
对象已存在 → `OBJECT_EXISTS`。

## 命令矩阵

| 操作 | 支持 | 说明 |
|---|---|---|
| `create` | ✅ | `--file` 必填 + 同名 `.srvd.acds` 侧车；`--description` 必填 |
| `pull` | ✅ | 写 `.srvd.json` + `.srvd.acds` |
| `push` | ✅ | 推 `.srvd.acds`（ADT source 路径） |
| `create local` | ❌ | `TYPE_NOT_SUPPORTED`（无本地骨架模板） |
| `delete` | 通用 ADT 删除 | 未真机验证 |

## 已知坑

- **create 与 push 是两步**：create 只建元数据壳，源码要再 `push` 一次。
- **`.srvd.acds` 缺失时 create 直接拒绝**：只有元数据、没有源码的对象在 SAP 侧是坏对象。
- **`sourceType` 是派生值**：pull 时按 SAP 元数据写入；改本地 JSON 不会改 SAP 侧对象。
- **真机证据**：未验证（本仓库当前没有 SRVD 的 `tests/` 证据；mock/unit 见 `test/unit/create-cds-extension-srvd.test.ts`、`test/unit/pull-cds-extension.test.ts`）。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
