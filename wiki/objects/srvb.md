---
type: object-type
title: SRVB — 服务绑定（Service Binding）
description: SRVB 对象的 ADT metadata-only create/pull/delete、srvb-v1.json 字段来源与 publish 路径
tags: [abap-cli, object-type, srvb, adt, rap, service-binding, abap-file-format]
created at: 2026-11-01 00:20:00
changed at: 2026-11-02 22:10:00
---

# SRVB — 服务绑定（Service Binding）

RAP service binding：把 service definition 暴露成 OData V2/V4 或 UI 服务。`SRVB`
**没有源码 part**，本地只有一份 AFF 元数据；create 只提交元数据 + 激活，
`--publish` 再调用 ADT publish job，push/update 不支持。

## 路由（仅 ADT，无兜底）

- **pull**：object structure 取 header（description / originalLanguage）与对象元数据，再
  `client.serviceBinding(objectUrl)`（`Accept: application/vnd.sap.adt.businessservices.servicebinding.v2+xml`）
  取 object structure 没有的 binding 载荷（services / binding type / category / version）。
- **create**：`POST /sap/bc/adt/businessservices/bindings`（AFF JSON → binding XML）→
  ADT activation；绑定在激活后才 `bindingCreated=true`。
- **publish**：`POST /sap/bc/adt/businessservices/{odatav2|odatav4}/publishjobs`
  （`servicename` = binding 名，`serviceversion` = AFF 里的 serviceVersion），响应只接受
  `application/vnd.sap.as+xml`；`--publish` 在 create 后立即调用。
- **delete**：通用 ADT lock → DELETE → unlock（真机验证）。

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
  "bindingType": "ODATA V4",
  "bindingTypeCategory": "webApi",
  "services": [
    {
      "name": "/AIF/MESSAGEMONITOR",
      "versions": [
        {
          "serviceVersion": "0001",
          "serviceDefinition": "/AIF/MESSAGEMONITOR"
        }
      ]
    }
  ]
}
```

- `bindingTypeCategory` 由 SAP 的数值 category 解码：`0` → `ui`（SAP UI5 / Fiori），`1` → `webApi`（OData web API）；create 时反向映射。
- `bindingType` 是 type + version 拼接的字符串（如 `ODATA V4`），create 时按最后一个空格拆分。
- `serviceVersion` 保留补零形式（如 `0001`）；publish job 的 `serviceversion` 直接用它。

## 命令矩阵

| 操作 | 支持 | 说明 |
|---|---|---|
| `create` | ✅ | `--file <name>.srvb.json` + `--package`；创建并激活 binding |
| `create --publish` | ✅ | 激活后调用 ADT publish job（受系统 transport 设置约束） |
| `pull` | ✅ | metadata-only，写单文件 |
| `push` | ❌ | 没有 update 路径；AFF 缺 implementation/published/version 细节 |
| `create local` | ❌ | 非源对象，无本地骨架模板 |
| `delete` | ✅ | 通用 ADT 删除（真机验证） |

## 已知坑

- **create 必须激活**：只 POST 创建时 `bindingCreated=false`；CLI 会随后调用 activation。
- **publish 受环境约束**：publish job 需要客户端允许本地发布/可用 transport request；在 auto-record 且无可用请求的系统上 SAP 返回 `Transport request not available...`，CLI 会原样报错（binding 已创建但未发布）。
- **没有 push/update**：AFF `srvb-v1` 对 ADT binding 是 lossy（缺 implementation/published/minor/patch）；改 binding 回 SAP GUI 或重新 create。
- **别把 SRVD 的字段套过来**：`sourceOrigin` / `sourceType` 属于 SRVD / DDLS 形状，SRVB 里没有。
- **真机证据（2026-11-02，S/4HANA profile `test`）**：create（$TMP，引用标准 service definition）→ activation（`bindingCreated=true`）→ pull → delete 通过；publish 在 client 100 的 auto-record 设置下返回 transport 错误（环境阻塞，非 CLI 路由错误）。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 路由矩阵：[`wiki/object-types.md`](../object-types.md)
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
