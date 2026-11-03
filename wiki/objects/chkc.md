---
type: object-type
title: CHKC — ATC 检查类别（ATC Check Category）
description: CHKC 的 ADT 版本化 XML 端点、chkc-v1 AFF 字段契约与真机 create/pull/push/delete 证据
tags: [abap-cli, object-type, chkc, atc, abap-file-format, adt]
created at: 2026-11-03 19:30:00
changed at: 2026-11-03 19:30:00
---

# CHKC — ATC 检查类别（ATC Check Category）

ATC（ABAP Test Cockpit）的**检查类别**，用来把检查对象（`CHKO`）分组。上游 abap-file-formats 有官方 `chkc-v1.json`，本地是纯 JSON、无源码侧车。

## 路由（单通道 ADT）

| 操作 | ADT 端点 | 说明 |
|---|---|---|
| create | `POST /sap/bc/adt/atc/checkcategories` | 创建后是 **inactive**，必须激活 |
| pull | `GET /sap/bc/adt/atc/checkcategories/<name>` | `application/vnd.sap.adt.chkcv1+xml` |
| push | lock → `PUT /sap/bc/adt/atc/checkcategories/<name>` | 随后激活（`--no-activate` 可跳过） |
| delete | lock → `DELETE /sap/bc/adt/atc/checkcategories/<name>` | 有子类别时 SAP 拒绝；非 `$` 包需 `--tr` |

`abap-adt-api` 没有这三类 ATC 配置对象的端点，请求由 `clients/atc.ts` 手写；`abap-adt-api` 的 `deleteObject` 走通用 ADT DELETE。激活（`POST /sap/bc/adt/activation`）在 create/push 成功后由 CLI 自动执行。

## 本地文件形态

```
src/
└── zcli_my_category.chkc.json
```

单文件，无侧车。`create` / `push` 使用 `--file`；文件名 token 必须与命令里的对象名一致（否则 `VALIDATION_ERROR`，避免建错对象）。

## `ZCLI_MY_CATEGORY.chkc.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "my ATC category",
    "originalLanguage": "en"
  },
  "parentCategory": "SYCM_S4H_READINESS"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `header.description` | ✅ | 最长 60 字符 |
| `header.originalLanguage` | ✅ | pull 返回 SAP 侧实际原始语言（小写） |
| `header.abapLanguageVersion` | — | `standard` / `cloudDevelopment`；`cloudDevelopment` 写 wire 时映射为 `adtcore:abapLanguageVersion="5"` |
| `parentCategory` | — | 父类别名；缺省表示根类别 |

## wire ↔ AFF 映射

| AFF | ADT XML |
|---|---|
| `header.description` | `adtcore:description` 属性 |
| `header.originalLanguage` | `adtcore:masterLanguage`（pull 时小写） |
| `parentCategory` | `<chkc:content><chkc:category adtcore:name="…"/>`；根类别为空元素 |

wire 上还有大量 AFF 不建模的字段（responsible、createdAt/changedAt、masterSystem、atom links、abapLanguageVersion `0`/`X`），pull 一律丢弃——AFF 文档只保留可回写的子集。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- `create → activate → GET`：201 + inactive → `activationExecuted=true` → `adtcore:version="active"`。
- `lock → PUT → unlock → activate → GET`：描述与父类别修改后版本回到 active。
- `delete`：`deleted:true`、`lockReleased:true`，随后 GET 404。
- 子类别：在 `$TMP` 建 `ZCLI_TC_CHKC2`（parent=`ZCLI_TC_CHKC`）可创建、可激活；父类别仍有子类别时删除父类别会被 SAP 拒绝。

## 已知限制 / gotcha

- **`create` 后对象是 inactive**：不激活时 ATC 不认。CLI 默认自动激活；`--no-activate` 只写不激活。
- **`originalLanguage` 由 SAP 决定**：create body 里的 `masterLanguage` 不被 ATC 资源采纳，SAP 用登录语言/激活后的实际值；pull 返回的是实际值（真机上出现 `en` 输入 → `zh` 读回）。不要假设 create→pull 能保留语言字段。
- **可传输包**：`push` / `delete` 对非 `$` 前缀包要求 `--tr`；`create` 可传 `--package` 与 `--tr`，传输记录由 SAP 处理。
- **名称长度**：走通用对象名校验（最长 30 字符、`A-Z 0-9 _`）。
