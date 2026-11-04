---
type: object-type
title: ENHS — 增强点（Enhancement Spot）
description: ENHS 的 ICF 只读 AFF 路由（仅 pull）、BAdI 定义字段契约、官方 enhs-v1 schema 与写入限制
tags: [abap-cli, object-type, enhs, icf, abap-file-format, enhancement, badi, read-only]
created at: 2026-11-04 01:15:00
changed at: 2026-11-04 02:10:00
---

# ENHS — 增强点（Enhancement Spot）

## 路由（ICF `/aff`，只读）

| 操作 | 行为 |
|---|---|
| pull | `GET /sap/abap_cli/aff/ENHS/<name>` — 返回 `data.files[]`（官方 AFF JSON），写 `src/<token>.enhs.json` |
| create | **不支持**（见「只读限制」） |
| push | **不支持** |
| delete | **不支持** |

`pull` 由 SAP 自带 AFF 框架（`CL_SEEF_AFF_OBJECTHANDLER_ENHS`）序列化，单文件；需要先 `abap deploy`（ICF 服务版本与 CLI 匹配）。读操作不需要 `--tr`。目标 release 没有该类型 handler 时返回 `AFF_UNSUPPORTED`，对象不存在返回 `AFF_NOT_FOUND`（都不是重试可解的错误）。

## 只读限制（已知限制）

SAP 的 AFF handler 对 ENHS 是**只读**的，CLI 因此不提供写入路径：

- **create 不可能**：AFF 框架的 `can_handle` 要求对象已存在 active 的 `ENHSPOTHEADER` 行（`version = 'A'` 且 `tool_type = 'BADI_DEF'`），新对象在 create 前必然不满足，`DESERIALIZE_OBJECTS` 会被拒绝。
- **绕过门禁也不落库**：persistence 层的 `save_content` 是空实现（`##NEEDED`），直调 handler 的 deserialize 不写任何表。
- **delete 会 dump**：`delete_object` 的实现是 `ASSERT 1 = 2`，不是 no-op——禁止对 ENHS 调 AFF 删除路径。
- 正确的写入路径是 SEEF API（`CL_ENH_FACTORY=>CREATE_ENHANCEMENT_SPOT`、`CL_ENH_ADT_BADI_DEF_CONT_SVC`、保存后 `ENH_WB_ACTIVATE` 激活）。CLI 尚未接入这套适配，作为后续独立工作排期；在此之前请在 SE80 / SE11 / SEEF 维护 ENHS。

本地 `pull` 产物仅用于阅读、比对与文档引用，**不能 `push` 回系统**。

CLI 行为：`create` / `delete` 在本地即报 `VALIDATION_ERROR`（exit 7），`push` 报 `TYPE_NOT_SUPPORTED`（exit 7）——三种写操作都不会发起 SAP 请求。

## 前置条件

- 已 `abap deploy`（ICF 服务已部署且版本匹配；`abap deploy status` 可查）。
- 对象在系统中存在；上游 AFF 格式只覆盖 BAdI 定义（`configuration.tool` 当前只有 `badiDefinition`），其他增强工具类型不在格式范围内。

## 本地文件形态

```
src/
└── <token>.enhs.json
```

单文件，无侧车；命名空间用 AFF 括号 token。

## AFF 文档形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Example ENHS for ABAP file formats",
    "originalLanguage": "en"
  },
  "configuration": { "tool": "badiDefinition" },
  "badiDefinitions": [
    {
      "name": "Z_AFF_EXAMPLE_BADI_DEFINITION",
      "description": "This is an example Badi Definition",
      "interface": "Z_AFF_EXAMPLE_BADI_INTF",
      "instantiation": "creatingNewInstances",
      "multipleUse": true,
      "filters": [
        { "name": "EXAMPLE_FILTER", "description": "This is an example Filter", "type": "string" }
      ]
    }
  ]
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `header.description` | string | 短文本，最长 100 |
| `configuration.tool` | string | 必填，当前枚举只有 `badiDefinition` |
| `configuration.sapInternal` | boolean | 是否 SAP 内部增强点 |
| `badiDefinitions[].name` | string | BAdI 定义名，必填，最长 30 |
| `badiDefinitions[].description` | string | 描述，必填，最长 255 |
| `badiDefinitions[].interface` | string | BAdI 接口，必填，最长 30 |
| `badiDefinitions[].instantiation` | string | `creatingNewInstances` / `reuseInstances` / `contextSpecificInstances`，必填 |
| `badiDefinitions[].multipleUse` / `sapInternal` / `amdp` | boolean | 使用方式标记 |
| `badiDefinitions[].fallbackClass` | string | fallback 实现类，最长 30 |
| `badiDefinitions[].filterLimitation` | boolean | 过滤限制标记 |
| `badiDefinitions[].filters[]` | array | 过滤定义，每项必填 `name` / `description` / `type` |

## 当前实现状态

| 环节 | 状态 |
|---|---|
| pull（ICF `/aff` GET） | 已接入（真机对标准对象拉取通过） |
| create / push / delete | **不支持**（AFF handler 只读；原因见上） |
| `abap validate:aff` schema 校验 | 已实现（官方 `enhs-v1.json`） |

## 真机证据

- **pull**：参考系统 757 上对标准 ENHS 对象 `ARC_MM_EBAN_CHECK` 拉取成功（单文件 `arc_mm_eban_check.enhs.json`），ICF 服务版本 2.4.0。
- 只读拒绝：`push` 在本地直接拒绝（`VALIDATION_ERROR`，exit 7，SAP 侧未收到请求），消息说明 AFF 参考框架无更新实现。
- 与参考 release 一致：`enhs-v1.json` 直接取自上游，序列化文档可校验。
- **写入**：不支持，不做真机验证。

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 配套增强实现：[`wiki/objects/enho.md`](enho.md)
- schema 来源：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
- 通道决策：[`wiki/design-decisions/016-aff-over-icf-vs-adt-bluesource.md`](../design-decisions/016-aff-over-icf-vs-adt-bluesource.md)
