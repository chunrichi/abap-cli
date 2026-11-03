---
type: object-type
title: EVTB — 事件绑定（Event Binding）
description: EVTB 的 ADT blueSource 路由、官方 AFF JSON 作为对象源码、producer / boName / events 字段契约
tags: [abap-cli, object-type, evtb, adt, abap-file-format, event-binding]
created at: 2026-11-04 01:15:00
changed at: 2026-11-04 02:05:00
---

# EVTB — 事件绑定（Event Binding）

## 路由（ADT blueSource）

| 操作 | 行为 |
|---|---|
| create | `POST /sap/bc/adt/businessservices/evtbevb` 建对象 → lock → `PUT .../<name>/source/main` → 激活 → unlock（默认随后 pull 回本地） |
| pull | `GET .../<name>/source/main`（官方 AFF JSON）+ `GET .../<name>`（元数据：包 / 描述），写 `src/<token>.evtb.json` |
| push | `GET .../<name>` 探测存在性 → lock → `PUT .../<name>/source/main` → 激活 → unlock |
| delete | `GET .../<name>` 取包 → `DELETE .../<name>?corrNr=<tr>`（不加锁） |

EVTB 的 ADT 资源把**官方 AFF JSON 直接作为对象源码**（`source/main`）：lock / 保存 / 激活 / transport 都由 ADT 生命周期承担，CLI 不做字段映射。保存即激活。非 `$` 前缀包需要 `--tr`；`$` 前缀本地包 transport-free。

## 前置条件

- ADT 服务可用（`abap profile test`）；本类型**不需要** `abap deploy`。
- 对象通过 `abap create EVTB <name> --file ... --package ...` 创建（create 默认 create-then-pull），或已存在于系统（`pull` 只读）。
- 目标包存在且可写；非 `$` 前缀包需要一个打开且可修改的 transport（`--tr`，或先 `abap transport list --open` / `transport create`）。
- 名称 ≤40 字符（`A-Z` / `0-9` / `_`，命名空间形如 `/NS/NAME`）。

## 本地文件形态

```
src/
└── <token>.evtb.json
```

单文件，无侧车。

## AFF 文档形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Event binding example",
    "originalLanguage": "en"
  },
  "producerNamespace": "sap.s4",
  "producer": "PC59C0E46A5E8B597EB82CB1AA2890FE8",
  "producerVersion": "0001",
  "boName": "BusinessUser",
  "boOperation": "Deleted",
  "producerType": "sap.s4.BusinessUser.Deleted.v*",
  "events": [
    {
      "eventVersion": "0001",
      "entityName": "I_SBOI_RAP_ATC",
      "entityEventName": "DELETED"
    }
  ]
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `producerNamespace` | string | 生产者命名空间，必填，最长 15 |
| `producer` | string | 生产者标识，可选，最长 36 |
| `producerVersion` | string | 生产者版本，1–4 位数字 |
| `producerLegacy` | boolean | 是否旧式生产者，可选 |
| `boName` | string | 业务对象名，必填，最长 30 |
| `boOperation` | string | 业务对象操作，必填，最长 30 |
| `producerType` | string | 生产者类型模板，可选，最长 83 |
| `events` | array | 必填，事件列表 |
| `events[].entityName` | string | 实体名，必填，最长 30 |
| `events[].entityEventName` | string | 实体事件名，必填，最长 30 |
| `events[].eventVersion` | string | 事件版本，1–4 位数字 |

## 实务要点

- 官方 schema 为 `src/abap_cli/schema/evtb-v1.json`；`abap validate:aff` 校验 `<token>.evtb.json`。
- `producerVersion` / `eventVersion` 是数字字符串（`"0001"`），写数字会被 schema 拒绝。
- 顶层 `additionalProperties: false`：不要手加 CLI 信封字段；`$schema`、对象名、包与语言由 ADT 资源元数据承载。
- 事件绑定的语义校验（生产者 / 实体 / BAdI 是否存在）在 SAP 保存时执行，CLI 只做本地 schema 校验。
- 名称上限 40 字符（`A-Z` / `0-9` / `_`，命名空间形如 `/NS/NAME`）。
- **`--no-activate` 被拒绝**：AFF 写是保存 + 激活一步完成，报 `VALIDATION_ERROR`（exit 7）。
- **只支持单文件**：该类型只有 1 个 AFF 文件；同前缀多文件会被显式拒绝。
- `create` / `push` 会把 AFF `header.description` 同步到 ADT 元数据（同一 lock 内）。
- 写入后 CLI 显式触发 ADT 激活（对已激活对象是 no-op）；激活失败映射为 `ACTIVATION_FAILED`（exit 7）。

## 当前实现状态

| 环节 | 状态 |
|---|---|
| create / pull / push / delete（ADT blueSource） | 已接入（CLI 通道） |
| `abap validate:aff` schema 校验 | 已实现（官方 `evtb-v1.json`） |
| 真机闭环 | 通道 create / pull / push / delete 通过；内容激活受 SAP 校验约束（见下） |

## 真机验证（S/4HANA profile `test`，SAP_BASIS 757，2026-11-04）

- 对象 `ZCLI_E2E_EVTB022042`（`$TMP`）：`create` 的 POST 与 `source/main` 写入成功，但激活被 SAP 拒绝——复制自标准对象的事件绑定引用了已被占用的 BO 事件（SAP 消息："Entity Event 'CREATED' of Entity '…' is already used in Event Binding 'S_FLDLOGSHPTCONTAINER_CREATE'"），CLI 原样返回 `ACTIVATION_FAILED`（exit 7）。
- 该对象仍可 `pull`（读回官方 AFF JSON）与 `delete`，两者通过；删除后 TADIR 无残留。
- 结论：EVTB 的 ADT 通道（create/pull/push/delete）可用；**内容能否激活取决于引用的 BO/事件是否可用**，参考系统上难以构造一个不与标准对象冲突的绑定，故内容级激活未在真机闭环，mock 测试覆盖了成功与失败路径。
- schema 与参考 release 一致（`evtb-v1.json` 直接取自上游，序列化文档可校验）。

（真机证据保存在本机 `tests/` 下，不入库；此处只记录结论与对象名。）

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- schema 来源：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
- 通道决策：[`wiki/design-decisions/016-aff-over-icf-vs-adt-bluesource.md`](../design-decisions/016-aff-over-icf-vs-adt-bluesource.md)
