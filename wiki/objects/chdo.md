---
type: object-type
title: CHDO — 更改凭证对象（Change Document Object）
description: CHDO 的 ADT blueSource 路由、官方 AFF JSON 作为对象源码、tablesAndStructures / errorMessage 字段契约
tags: [abap-cli, object-type, chdo, adt, abap-file-format, change-documents]
created at: 2026-11-04 01:15:00
changed at: 2026-11-04 02:05:00
---

# CHDO — 更改凭证对象（Change Document Object）

## 路由（ADT blueSource）

| 操作 | 行为 |
|---|---|
| create | `POST /sap/bc/adt/changedocuments/objects` 建对象 → lock → `PUT .../<name>/source/main` → 激活 → unlock（默认随后 pull 回本地） |
| pull | `GET .../<name>/source/main`（官方 AFF JSON）+ `GET .../<name>`（元数据：包 / 描述），写 `src/<token>.chdo.json` |
| push | `GET .../<name>` 探测存在性 → lock → `PUT .../<name>/source/main` → 激活 → unlock |
| delete | `GET .../<name>` 取包 → `DELETE .../<name>?corrNr=<tr>`（不加锁） |

CHDO 的 ADT 资源把**官方 AFF JSON 直接作为对象源码**（`source/main`）：lock / 保存 / 激活 / transport 都由 ADT 生命周期承担，CLI 不做字段映射。保存即激活，不存在需要额外激活的 inactive 状态。非 `$` 前缀包需要 `--tr`；`$` 前缀本地包 transport-free。

## 前置条件

- ADT 服务可用（`abap profile test`）；本类型**不需要** `abap deploy`。
- 对象通过 `abap create CHDO <name> --file ... --package ...` 创建（create 默认 create-then-pull），或已存在于系统（`pull` 只读）。
- 目标包存在且可写；非 `$` 前缀包需要一个打开且可修改的 transport（`--tr`，或先 `abap transport list --open` / `transport create`）。
- **名称 ≤16 字符**（参考系统实测 SAP 拒绝 17 字符，不是通用的 40）；`A-Z` / `0-9` / `_`，命名空间形如 `/NS/NAME`；`tablesAndStructures[]` 引用的表 / 结构需已存在。

## 本地文件形态

```
src/
└── <token>.chdo.json
```

单文件，无侧车。

## AFF 文档形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "CHDO example",
    "originalLanguage": "de"
  },
  "generalInformation": {
    "generatedObject": "ZCL_Z_AFF_EXAM_CHDO_CHDO"
  },
  "tablesAndStructures": [
    {
      "name": "SZD_TABL_TAB",
      "referenceTable": "",
      "multipleChanges": false,
      "databaseInsertions": { "logValues": true, "logInitialValues": true },
      "databaseDeletions": { "logValues": true, "logInitialValues": false }
    }
  ],
  "errorMessage": { "id": "CD", "number": "600" }
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `header.description` | string | 短文本，最长 60 |
| `generalInformation.category` | string | `standard` / `behaviorDefiniton`（上游枚举拼写如此），可选 |
| `generalInformation.generatedObject` | string | 生成对象名，可选，最长 30 |
| `tablesAndStructures[].name` | string | 被记录的表 / 结构名，必填，最长 30 |
| `tablesAndStructures[].referenceTable` | string | 参考表，可选 |
| `tablesAndStructures[].multipleChanges` | boolean | 是否记录多次变更 |
| `tablesAndStructures[].databaseInsertions` | object | `logValues` / `logInitialValues` 两个布尔开关 |
| `tablesAndStructures[].databaseDeletions` | object | 同上；删除侧开关 |
| `errorMessage.id` | string | 消息类，必填，最长 20 |
| `errorMessage.number` | string | 消息号，必填，1–3 位数字（schema `pattern: ^[0-9]+$`） |

## 实务要点

- 官方 schema 为 `src/abap_cli/schema/chdo-v1.json`；`abap validate:aff` 校验 `<token>.chdo.json`。
- `generalInformation.category` 的 `behaviorDefiniton` 是上游 schema 的既有拼写（缺 `i`），照抄才能通过校验。
- 顶层 `additionalProperties: false`：不要手加 CLI 信封字段；`$schema`、对象名、包与语言由 ADT 资源元数据承载。
- **名称上限 16 字符**（不是通用的 40）：参考系统实测 17 字符名称被 SAP 拒绝（`syntax cannot be used for object name`），13 字符可用。
- **`--no-activate` 被拒绝**：AFF 写是保存 + 激活一步完成，报 `VALIDATION_ERROR`（exit 7）。
- **只支持单文件**：该类型只有 1 个 AFF 文件；同前缀多文件会被显式拒绝。
- `create` / `push` 会把 AFF `header.description` 同步到 ADT 元数据（同一 lock 内）。
- 写入后 CLI 显式触发 ADT 激活（APLO 自动 active，CHDO 等可能保留 inactive 版本；对已激活对象是 no-op）；激活失败映射为 `ACTIVATION_FAILED`（exit 7）。
- 表 / 结构必须先存在；`pull` 出来可直接作为 `create` / `push` 模板。

## 当前实现状态

| 环节 | 状态 |
|---|---|
| create / pull / push / delete（ADT blueSource） | 已接入（CLI 通道） |
| `abap validate:aff` schema 校验 | 已实现（官方 `chdo-v1.json`） |
| 真机闭环 | 参考系统 757 完整通过（create → pull → push → delete） |

## 真机验证（S/4HANA profile `test`，SAP_BASIS 757，2026-11-04）

- 对象 `ZE2E_CHDO022042`（`$TMP`）：`create`（字段取模板引用标准表 `/ATL/FORECLOSURE`）→ `pull` → `push` → `delete` 全部通过，删除后 TADIR 无残留。
- 写入后对象为 `inactive`，CLI 在解锁后显式激活并将其结果反映为 `activated`；激活失败时 SAP 消息原样返回（`ACTIVATION_FAILED`，exit 7）。
- **schema 版本**：参考 release 序列化的是 2022 版 CHDO 文档（`generatedObject` 在根、表项用 `deleteLogValues`/`insertLogValues` 系列字段），vendored `chdo-v1.json` 因此固定在匹配该文档的上游版本；上游 main 的新格式不适用于本 release（见 `src/abap_cli/schema/README.md`）。
- 名称上限 16 字符：17 字符名被 SAP 拒绝（"语法不能用于对象名称"），CLI 在本地先报校验错误。

（真机证据保存在本机 `tests/` 下，不入库；此处只记录结论与对象名。）

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- schema 来源：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
- 通道决策：[`wiki/design-decisions/016-aff-over-icf-vs-adt-bluesource.md`](../design-decisions/016-aff-over-icf-vs-adt-bluesource.md)
