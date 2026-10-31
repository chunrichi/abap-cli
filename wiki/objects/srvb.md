---
type: object-type
title: SRVB — 服务绑定（Service Binding）
description: SRVB 对象的 ADT metadata-only pull、srvb-v1.json 字段来源与"仅 pull"边界
tags: [abap-cli, object-type, srvb, adt, rap, service-binding, abap-file-format]
created at: 2026-11-01 00:20:00
changed at: 2026-11-01 00:20:00
---

# SRVB — 服务绑定（Service Binding）

RAP service binding：把 service definition 暴露成 OData V2/V4 或 UI 服务。`SRVB`
**没有源码 part**，本地只有一份 AFF 元数据，因此它是本仓库唯一"仅 pull"的类型。

## 路由（仅 ADT，无兜底）

`abap pull` 走两次只读调用：

1. object structure 取 header（description / originalLanguage）与对象元数据；
2. `client.serviceBinding(objectUrl)`（`Accept: application/vnd.sap.adt.businessservices.servicebinding.v2+xml`）取 object structure 里没有的 binding 载荷（services / binding type / category / version）。

binding 由 SAP GUI（或 RAP 工具链）管理，CLI **没有** create / push 路径：
`types/registry.ts` 没有 `createObjtype`，`flows/edit/routing.ts` 只为 SRVB 注册了 pull。

## 本地文件形态

```
src/
└── zmy_service_binding.srvb.json
```

单文件，无侧车。`abap pull ZMY_SERVICE_BINDING --type SRVB` 写
`src/zmy_service_binding.srvb.json`，符合
[`schema/srvb-v1.json`](../../src/abap_cli/schema/srvb-v1.json)。

## `srvb.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Travel service binding",
    "originalLanguage": "EN"
  },
  "bindingType": "odataV4 0001",
  "bindingTypeCategory": "webApi",
  "services": ["ZMY_TRAVEL_SRV"]
}
```

- `bindingTypeCategory` 由 SAP 的数值 category 解码：`0` → `ui`（SAP UI5 / Fiori），`1` → `webApi`（OData web API）。
- `bindingType` 是 type + version 拼接的字符串，version 的补零（如 `0001`）原样保留。

## 命令矩阵

| 操作 | 支持 | 说明 |
|---|---|---|
| `pull` | ✅ | metadata-only，写单文件 |
| `create` / `push` | ❌ | binding 由 SAP GUI 管理；CLI 不提供写路径 |
| `create local` | ❌ | 非源对象，无本地骨架模板 |
| `delete` | 通用 ADT 删除 | lock → DELETE → unlock，未真机验证 |

## 已知坑

- **pull 不是"拉源码"**：SRVB 没有 source part，`pull` 只落元数据快照；改 binding 回 SAP GUI。
- **别把 SRVD 的字段套过来**：`sourceOrigin` / `sourceType` 属于 SRVD / DDLS 形状，SRVB 里没有。
- **真机证据**：未验证（本仓库当前没有 SRVB 的 `tests/` 证据；mock/unit 见 `test/unit/pull-srvb-strategy.test.ts`）。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
