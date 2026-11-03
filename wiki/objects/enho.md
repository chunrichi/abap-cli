---
type: object-type
title: ENHO — 增强实现（Enhancement Implementation）
description: ENHO 的 ICF 只读 AFF 路由（仅 pull）、BAdI 实现字段契约、官方 enho-v1 schema 与写入限制
tags: [abap-cli, object-type, enho, icf, abap-file-format, enhancement, badi, read-only]
created at: 2026-11-04 01:15:00
changed at: 2026-11-04 02:10:00
---

# ENHO — 增强实现（Enhancement Implementation）

## 路由（ICF `/aff`，只读）

| 操作 | 行为 |
|---|---|
| pull | `GET /sap/abap_cli/aff/ENHO/<name>` — 返回 `data.files[]`（官方 AFF JSON），写 `src/<token>.enho.json` |
| create | **不支持**（见「只读限制」） |
| push | **不支持** |
| delete | **不支持** |

`pull` 由 SAP 自带 AFF 框架（`CL_SEEF_AFF_OBJECTHANDLER_ENHO`）序列化，单文件；需要先 `abap deploy`（ICF 服务版本与 CLI 匹配）。读操作不需要 `--tr`。目标 release 没有该类型 handler 时返回 `AFF_UNSUPPORTED`，对象不存在返回 `AFF_NOT_FOUND`（都不是重试可解的错误）。

## 只读限制（已知限制）

SAP 的 AFF handler 对 ENHO 是**只读**的，CLI 因此不提供写入路径：

- **create 不可能**：AFF 框架的 `can_handle` 要求对象已存在 active 的 `ENHHEADER` 行（`version = 'A'` 且 `enhtooltype = 'BADI_IMPL'`），新对象在 create 前必然不满足，`DESERIALIZE_OBJECTS` 会被拒绝。
- **绕过门禁也不落库**：persistence 层的 `save_content` 是空实现（`##NEEDED`），直调 handler 的 deserialize 只返回成功、不写任何表（真机验证：0 行、`exists = false`）。
- **delete 无实现**：`delete_object` 是空方法。
- 正确的写入路径是 SEEF API（`CL_ENH_FACTORY=>CREATE_ENHANCEMENT`、`CL_ENH_ADT_ENHO_OBJ_PERSIST`、保存后 `ENH_WB_ACTIVATE` 激活）。CLI 尚未接入这套适配，作为后续独立工作排期；在此之前请在 SE80 / SE11 / SEEF 维护 ENHO。

本地 `pull` 产物仅用于阅读、比对与文档引用，**不能 `push` 回系统**。

CLI 行为：`create` / `delete` 在本地即报 `VALIDATION_ERROR`（exit 7），`push` 报 `TYPE_NOT_SUPPORTED`（exit 7）——三种写操作都不会发起 SAP 请求。

## 前置条件

- 已 `abap deploy`（ICF 服务已部署且版本匹配；`abap deploy status` 可查）。
- 对象在系统中存在；上游 AFF 格式只覆盖 BAdI 实现（source-code plug-in 等其他增强实现不在格式范围内）。

## 本地文件形态

```
src/
└── <token>.enho.json
```

单文件，无侧车；命名空间用 AFF 括号 token。

## AFF 文档形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Example ENHO for ABAP file formats",
    "originalLanguage": "en"
  },
  "generalInformation": { "enhancementSpot": "Z_AFF_EXAMPLE_ENHS" },
  "badiImplementations": [
    {
      "name": "Z_AFF_EXAMPLE_BADI_IMPL",
      "description": "This is an example BAdI Implementation",
      "badiDefinition": "Z_AFF_EXAMPLE_BADI_DEFINITION",
      "implementingClass": "Z_AFF_EXAMPLE_BADI_IMPL",
      "isDefaultImplementation": true,
      "isActiveImplementation": true,
      "customizing": "notSupported"
    }
  ]
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `header.description` | string | 短文本，最长 100 |
| `generalInformation.enhancementSpot` | string | 所属增强点，必填，最长 30 |
| `badiImplementations[].name` | string | BAdI 实现名，必填，最长 30 |
| `badiImplementations[].description` | string | 描述，必填，最长 255 |
| `badiImplementations[].badiDefinition` | string | BAdI 定义名，必填，最长 30 |
| `badiImplementations[].implementingClass` | string | 实现类，必填，最长 30 |
| `badiImplementations[].customizing` | string | `notSupported` / `supported` / `supportedNoTransport` |
| `badiImplementations[].filterValues` | object | 过滤条件：`or[]` / `and[]` / `filter` |
| `badiImplementations[].isDefaultImplementation` 等 | boolean | 默认 / 激活 / 示例实现标记 |

## 当前实现状态

| 环节 | 状态 |
|---|---|
| pull（ICF `/aff` GET） | 已接入（真机对标准对象拉取通过） |
| create / push / delete | **不支持**（AFF handler 只读；原因见上） |
| `abap validate:aff` schema 校验 | 已实现（官方 `enho-v1.json`） |

## 真机证据

- **pull**：参考系统 757 上对标准 ENHO 对象 `ZEX_HU_BASICS_PRODUCT` 拉取成功（单文件 `zex_hu_basics_product.enho.json`），ICF 服务版本 2.4.0。
- 只读拒绝：`create` / `delete` 在本地直接拒绝（`VALIDATION_ERROR`，exit 7，SAP 侧未收到请求），消息说明 AFF 参考框架无写入实现。
- **schema 版本**：参考 release 的 ENHO 文档是 2024 版格式（根级 `enhancementSpot`/`referencedObjects`、BAdI 实现字段为旧布局），vendored `enho-v1.json` 因此固定在匹配该文档的上游版本；上游 main 的新格式不适用于本 release（见 `src/abap_cli/schema/README.md`）。
- **写入**：不支持，不做真机验证。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 配套增强点：[`wiki/objects/enhs.md`](enhs.md)
- schema 来源：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
- 通道决策：[`wiki/design-decisions/016-aff-over-icf-vs-adt-bluesource.md`](../design-decisions/016-aff-over-icf-vs-adt-bluesource.md)
