---
type: object-type
title: DDLS — CDS 视图源（Data Definition Language Source）
description: DDLS 对象的 ADT-only 路由、三件套形态、5 种 CDS 形态识别、ECC 硬错
tags: [abap-cli, object-type, ddls, cds, adt, abap-file-format, view-entity]
created at: 2026-09-04 00:00:00
changed at: 2026-09-04 00:00:00
---

# DDLS — CDS 视图源（DDL Source）

## 路由（仅 ADT，无兜底）

| 系统 | 通道 | 端点 |
|---|---|---|
| S/4HANA、ECC EHP7+（kernel ≥ 753） | ADT | `/sap/bc/adt/ddic/ddl/sources/<name>` |
| ECC EHP5 / EHP6（kernel < 753） | **硬错** | 无调用，直接 `DDLS_NOT_SUPPORTED_ON_ECC`（exit 64） |

DDL source 是 SAP 内核能力，**没有 ICF 兜底的可能**——旧内核根本不存在 DDL 解析器。因此 `channel-detect` 在任何 SAP 调用之前抛错，而不是静默降级：

```json
{
  "status": "error",
  "error": {
    "code": "DDLS_NOT_SUPPORTED_ON_ECC",
    "message": "CDS view source (DDLS) is not supported by this SAP release (kernel 731). Upgrade to ECC EHP7+ or S/4HANA to use 'abap pull --type DDLS'."
  }
}
```

若某台旧内核系统确实装了 DDL 支持，可在 profile 上显式设 `ddlsSupported: true` 覆盖判定。

## 本地文件形态（三件套）

```
src/ddls/zmy_view/
├── zmy_view.ddls.json    # AFF 嵌套元数据
└── zmy_view.ddls.acds    # CDS 源码（原文，不转义）
```

两个文件**必须成对**：push 时缺 `.ddls.acds` 报 `VALIDATION_ERROR`；`.ddls.json` 的 `sourceType` 与 `.ddls.acds` 顶部 `define ...` 关键字不一致同样报 `VALIDATION_ERROR`（防止元数据与源码漂移）。

## `<name>.ddls.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My CDS view",
    "originalLanguage": "EN"
  },
  "sourceOrigin": "abapDevelopmentTools",
  "sourceType": "viewEntity"
}
```

## `sourceType` 与 CDS 形态映射

`.ddls.acds` 顶部的 `define` 关键字决定 `sourceType`，由 `formats/ddls/acds.ts#parseAcds` 识别：

| `.acds` 顶部写法 | `sourceType` | 附加字段 |
|---|---|---|
| `define view entity X as select from ...` | `viewEntity` | — |
| `define projection view X as projection on ...` | `projectionView` | — |
| `define table function X returns { ... }` | `tableFunction` | — |
| `define view entity X extend [Y]` | `viewEntityExtend` | `parentName: "Y"` |
| `define view X extend [Y]` | `viewExtend` | `parentName: "Y"` |
| `@AbapCatalog.sqlViewName` + `define view X as select` | `ddicBasedView` | — |

`tableEntity` / `abstractEntity` / `customEntity` / `hierarchy` / `externalEntity` 亦可识别；无法归类时落 `unknown`。

## 命令示例

```bash
abap create DDLS ZMY_VIEW --file src/ddls/zmy_view/zmy_view.ddls.json --package $TMP --json
abap pull I_ABAPAPPLICATIONCOMPONENT --type DDLS --json
abap push src/ddls/zmy_view/zmy_view.ddls.json --tr DEVK900001 --json
```

## abap-file-format 合规性

复用上游 `ddls/ddls-v1.json` schema。源码不进 JSON——AFF 约定源码走同名侧车文件（与 CLAS 的 `.clas.abap`、TABL 的 `.tabl.ddic` 同构）。

## 已知坑

- **ECC 上无法 fallback**：这是设计决策，不是缺陷；exit 64 是稳定契约值，CI 可直接 grep
- **`sourceType` 是派生值**：pull 时从 `.acds` 反推；手改 JSON 而不改 `.acds` 会在 push 时被拒
- **注解不参与 schema 校验**：`@AccessControl` / `@Metadata` 等纯文本保留在 `.acds` 里，CLI 不解析语义
- **`create` 要求两个文件都在**：只给 JSON 会报 `VALIDATION_ERROR`，提示补 `.ddls.acds`

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 真实 SAP 回归：[`tests/260904003-ddls-real-sap/`](../../tests/260904003-ddls-real-sap/)
- abap-file-format 导出约定：[`wiki/abap-file-format-export.md`](../abap-file-format-export.md)
