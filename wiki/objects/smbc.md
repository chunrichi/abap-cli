---
type: object-type
title: SMBC — 业务配置维护对象（Business Configuration Maintenance Object）
description: SMBC 的 ADT blueSource 路由、serviceConfiguration / appConfiguration 字段契约与参考系统真机限制
tags: [abap-cli, object-type, smbc, adt, abap-file-format, business-configuration]
created at: 2026-11-04 01:15:00
changed at: 2026-11-04 02:05:00
---

# SMBC — 业务配置维护对象（Business Configuration Maintenance Object）

## 路由（ADT blueSource）

| 操作 | 行为 |
|---|---|
| create | `POST /sap/bc/adt/bct/smbctyp` 建对象 → lock → `PUT .../<name>/source/main` → 激活 → unlock（默认随后 pull 回本地） |
| pull | `GET .../<name>/source/main`（官方 AFF JSON）+ `GET .../<name>`（元数据：包 / 描述），写 `src/<token>.smbc.json` |
| push | `GET .../<name>` 探测存在性 → lock → `PUT .../<name>/source/main` → 激活 → unlock |
| delete | `GET .../<name>` 取包 → `DELETE .../<name>?corrNr=<tr>`（不加锁） |

SMBC 的 ADT 资源把**官方 AFF JSON 直接作为对象源码**（`source/main`）：lock / 保存 / 激活 / transport 都由 ADT 生命周期承担，CLI 不做字段映射。保存即激活。非 `$` 前缀包需要 `--tr`；`$` 前缀本地包 transport-free。

## 前置条件

- ADT 服务可用（`abap profile test`）；本类型**不需要** `abap deploy`。
- **硬前置：已存在的 service binding（`SRVB`）**——`serviceConfiguration.serviceBinding` / `serviceName` 必须在系统里存在，SAP 保存时做 MBC 语法检查。可先用 `abap create SRVB ...` 造 `$TMP` binding。
- 对象通过 `abap create SMBC <name> --file ... --package ...` 创建（create 默认 create-then-pull），或已存在于系统（`pull` 只读）。
- 目标包存在且可写；非 `$` 前缀包需要一个打开且可修改的 transport（`--tr`，或先 `abap transport list --open` / `transport create`）。
- 名称 ≤40 字符（`A-Z` / `0-9` / `_`，命名空间形如 `/NS/NAME`）。

## 本地文件形态

```
src/
└── <token>.smbc.json
```

单文件，无侧车。

## AFF 文档形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "AFF Example Object for SMBC",
    "originalLanguage": "en"
  },
  "serviceConfiguration": {
    "serviceBinding": "/DMO/SB_CUSTOMER_MSSK_O4",
    "serviceName": "/DMO/SD_CUSTOMER_MSSK",
    "serviceVersion": "0001",
    "rootEntitySet": "Customer",
    "name": "Maintain customer",
    "configurationGroup": "/DMO/ADMIN_GROUP",
    "skipRootEntity": false
  },
  "appConfiguration": {
    "listReport": { "variantManagement": "none" },
    "objectPages": [{ "entitySet": "Customer", "sectionLayout": "tabs" }],
    "tableSettings": [{ "entitySet": "Customer", "tableType": "gridTable" }]
  }
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `header.description` | string | 短文本，最长 50（比同类对象短） |
| `serviceConfiguration.serviceBinding` | string | RAP service binding，必填，最长 40 |
| `serviceConfiguration.serviceName` | string | service definition，必填，最长 40 |
| `serviceConfiguration.serviceVersion` | string | 版本，必填，1–4 位数字 |
| `serviceConfiguration.rootEntitySet` | string | 根实体集，必填，最长 30 |
| `serviceConfiguration.name` | string | 配置对象名，必填，最长 50 |
| `serviceConfiguration.transportObject` | string | 传输对象，可选，最长 31 |
| `serviceConfiguration.configurationGroup` | string | 配置组，最长 30 |
| `serviceConfiguration.skipRootEntity` | boolean | 跳过根实体 |
| `appConfiguration` | object | Fiori Elements 应用配置，可选：`fioriElementsApp` / `listReport` / `objectPages[]` / `tableSettings[]` |

## 实务要点

- 官方 schema 为 `src/abap_cli/schema/smbc-v1.json`；`abap validate:aff` 校验 `<token>.smbc.json`。
- **硬前置是已存在的 service binding（`SRVB`）**：`serviceConfiguration` 的 serviceBinding / serviceName 必须在系统里存在；SAP 保存时做 MBC 语法检查。
- 参考系统（757）上 **TADIR 里没有 SMBC 对象**，无法做真机 `pull` / `create` / `push` / `delete` 验证；通道按与其他三类相同的方式接入，本地 schema 校验完整。造前置对象（`abap create SRVB`）后可补真机验证。
- `header.description` 上限 50，写超长字符串会 schema FAIL。
- 顶层 `additionalProperties: false`：不要手加 CLI 信封字段；`$schema`、对象名、包与语言由 ADT 资源元数据承载。
- **`--no-activate` 被拒绝**：AFF 写是保存 + 激活一步完成，报 `VALIDATION_ERROR`（exit 7）。
- **只支持单文件**：该类型只有 1 个 AFF 文件；同前缀多文件会被显式拒绝。
- `create` / `push` 会把 AFF `header.description` 同步到 ADT 元数据（同一 lock 内）；写入后 CLI 显式触发 ADT 激活，激活失败映射为 `ACTIVATION_FAILED`（exit 7）。

## 当前实现状态

| 环节 | 状态 |
|---|---|
| create / pull / push / delete（ADT blueSource） | 已接入（CLI 通道） |
| `abap validate:aff` schema 校验 | 已实现（官方 `smbc-v1.json`） |
| 真机闭环 | 参考系统无 SMBC 对象，未验证（需先有 SRVB service binding 等前置对象） |

## 真机验证（S/4HANA profile `test`，SAP_BASIS 757，2026-11-04）

- 参考系统 TADIR 中 SMBC 0 行，无对象可序列化；`pull` 只能得到 `OBJECT_NOT_FOUND`。
- 自建 `ZCLI_E2E_SMBC022042`（`$TMP`）：`create` 的 POST 与 `source/main` 写入成功，激活被 SAP 拒绝——`serviceConfiguration.serviceBinding` 指向的服务绑定不存在（SAP 消息："服务绑定 ZCLI_E2E_SB 不存在。选择现有服务绑定"），CLI 原样返回 `ACTIVATION_FAILED`（exit 7）。
- 该对象可 `pull`（读回 SAP 的默认 AFF JSON）与 `delete`，两者通过；删除后 TADIR 无残留。
- 结论：通道与 schema 已接入；**内容级闭环需要目标系统先有可用的 `SRVB` 服务绑定**，参考系统无此样本，留待具备前置对象的系统验证。

（真机证据保存在本机 `tests/` 下，不入库；此处只记录结论与对象名。）

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- schema 来源：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
- 通道决策：[`wiki/design-decisions/016-aff-over-icf-vs-adt-bluesource.md`](../design-decisions/016-aff-over-icf-vs-adt-bluesource.md)
