---
type: object-type
title: APLO — 应用日志对象（Application Log Object）
description: APLO 的 ADT blueSource 路由、官方 AFF JSON 作为对象源码、subobjects 字段契约与真机状态
tags: [abap-cli, object-type, aplo, adt, abap-file-format, application-log]
created at: 2026-11-04 01:15:00
changed at: 2026-11-04 02:05:00
---

# APLO — 应用日志对象（Application Log Object）

## 路由（ADT blueSource）

| 操作 | 行为 |
|---|---|
| create | `POST /sap/bc/adt/applicationlog/objects` 建对象 → lock → `PUT .../<name>/source/main` → 激活 → unlock（默认随后 pull 回本地） |
| pull | `GET .../<name>/source/main`（官方 AFF JSON）+ `GET .../<name>`（元数据：包 / 描述），写 `src/<token>.aplo.json` |
| push | `GET .../<name>` 探测存在性 → lock → `PUT .../<name>/source/main` → 激活 → unlock |
| delete | `GET .../<name>` 取包 → `DELETE .../<name>?corrNr=<tr>`（不加锁） |

APLO 的 ADT 资源把**官方 AFF JSON 直接作为对象源码**（`source/main`）：lock / 保存 / 激活 / transport 都由 ADT 生命周期承担，CLI 不做字段映射。保存即激活，不存在需要额外激活的 inactive 状态。非 `$` 前缀包需要 `--tr`；`$` 前缀本地包 transport-free。

## 前置条件

- ADT 服务可用（`abap profile test`）；本类型**不需要** `abap deploy`。
- 对象通过 `abap create APLO <name> --file ... --package ...` 创建（create 默认 create-then-pull），或已存在于系统（`pull` 只读）。
- 目标包存在且可写；非 `$` 前缀包需要一个打开且可修改的 transport（`--tr`，或先 `abap transport list --open` / `transport create`）。
- 名称 ≤20 字符（SAP 的 APLO 处理器按 C(20) 寻址；`A-Z` / `0-9` / `_`，命名空间形如 `/NS/NAME`），CLI 在本地先拒绝超长名。

## 本地文件形态

```
src/
└── <token>.aplo.json
```

单文件，无侧车；命名空间用 AFF 括号 token（`/NS/OBJ` → `(ns)obj`）。

## AFF 文档形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Application Log Test Object",
    "originalLanguage": "en"
  },
  "subobjects": [
    { "name": "SUBOBJECT1", "description": "Subobject 1" },
    { "name": "SUBOBJECT2", "description": "Subobject 2" }
  ]
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `formatVersion` | string | 固定 `"1"` |
| `header.description` | string | 短文本，最长 60 |
| `header.originalLanguage` | string | 两位语言码（`en`） |
| `header.abapLanguageVersion` | string | `standard` / `cloudDevelopment`，可选 |
| `subobjects` | array | 必填（可为空数组） |
| `subobjects[].name` | string | 子对象名，必填，最长 20 |
| `subobjects[].description` | string | 子对象短文本，最长 60 |

## 实务要点

- 官方 schema 为 `src/abap_cli/schema/aplo-v1.json`；`abap validate:aff` 校验 `<token>.aplo.json`。
- 顶层 `additionalProperties: false`：`package` / `transportRequest` 是 CLI 信封字段，不属于 AFF 文档；`$schema`、对象名、包与语言由 ADT 资源元数据承载，不写进 JSON。
- 名称上限 20 字符（SAP 的 APLO 处理器按 C(20) 寻址，实测 21 字符返回 500；CLI 在本地先拒绝）。
- **`--no-activate` 被拒绝**：AFF 写是保存 + 激活一步完成，报 `VALIDATION_ERROR`（exit 7）。
- **只支持单文件**：该类型只有 1 个 AFF 文件；同前缀多文件会被显式拒绝（不会静默丢弃 companion）。
- `create` / `push` 会把 AFF `header.description` 同步到 ADT 元数据（同一 lock 内）；`pull` 原样写出 `source/main`，输出里的 `package` 取自 ADT 元数据。
- 写入后 CLI 显式触发 ADT 激活（对已激活对象是无害 no-op）；激活失败会把 SAP 消息映射为 `ACTIVATION_FAILED`（exit 7）。
- `create` 默认 create-then-pull 写本地副本（`--no-pull` 跳过）；`push` 后同样保存即激活。
- `pull` 出来的文件可直接作为 `create` / `push` 的模板。

## 当前实现状态

| 环节 | 状态 |
|---|---|
| create / pull / push / delete（ADT blueSource） | 已接入（CLI 通道） |
| `abap validate:aff` schema 校验 | 已实现（官方 `aplo-v1.json`） |
| 真机闭环 | 参考系统 757 完整通过（create → pull → push → delete） |

## 真机验证（S/4HANA profile `test`，SAP_BASIS 757，2026-11-04）

- 对象 `ZCLI_E2E_APLO022042`（`$TMP`）：`create` → `pull` → 改 `header.description` 后 `push` → `pull` 回读描述一致 → `delete` → 再 `pull` 得到 `OBJECT_NOT_FOUND`（exit 8）全部通过，删除后 TADIR 无残留。
- 保存即激活：`create`/`push` 后对象元数据 `adtcore:version=active`；CLI 不额外激活（避免 `activationExecuted=false` 的无效告警）。
- 5 类代表性对象（APLO / CHDO / EVTB / ENHO / ENHS）经 ICF 只读端点的 `pull` 也全部成功，命名空间对象 `/ATL/FORECHIST` 的 `(atl)` 文件名映射正常。
- `--check-only` 只做本地校验：不创建远端对象（随后 `pull` 得到 `OBJECT_NOT_FOUND`）。

（真机证据保存在本机 `tests/` 下，不入库；此处只记录结论与对象名。）

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- schema 来源：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
- 通道决策：[`wiki/design-decisions/016-aff-over-icf-vs-adt-bluesource.md`](../design-decisions/016-aff-over-icf-vs-adt-bluesource.md)
