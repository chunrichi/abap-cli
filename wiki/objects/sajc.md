---
type: object-type
title: SAJC — 应用作业目录条目（Application Job Catalog Entry）
description: SAJC 的 ADT applicationjob 端点、sajc-v1 AFF 契约、扁平/嵌套两种 JSON 模型与真机证据
tags: [abap-cli, object-type, sajc, application-jobs, abap-file-format, adt]
created at: 2026-11-03 21:55:00
changed at: 2026-11-03 21:55:00
---

# SAJC — 应用作业目录条目（Application Job Catalog Entry）

SAP **应用作业**（Application Jobs，SM36 的新作业模型）的目录条目：描述一个可调度作业——执行类或报表、选择屏参数分组/参数、检查与值帮助退出类。上游 AFF 官方 `sajc-v1.json`，本地单 JSON 文件；ADT 上是 blueSource 资源，`source/main` 就是该 JSON 文档。

配套类型是模板 [SAJT](sajt.md)（`<name>.sajt.json`）：模板引用一个已激活的目录条目并填好参数值。

## 路由（单通道 ADT）

| 操作 | ADT 端点 |
|---|---|
| create | `POST /sap/bc/adt/applicationjob/catalogs`（`application/vnd.sap.adt.blues.v1+xml`） |
| pull | `GET /sap/bc/adt/applicationjob/catalogs/<name>/source/main`（`application/json`） |
| push | lock → `PUT …/source/main` → `PUT …/<name>`（同步描述）→ unlock → activate |
| delete | lock → `DELETE …/<name>` → unlock（非 `$` 包需 `--tr`） |

**写入即生效**：ADT 的 application-job JSON 资源没有 inactive 版本——`source/main` 一写入就是已保存并激活的状态，SAP 侧不会再出现待激活版本。因此 `create` / `push` 都直接成功返回，`--no-activate` 会被本地拒绝（exit 7，提示该类型无法"只写不激活"）。`create --check-only` 只做本地 schema/名称校验，不写 SAP。

## 本地文件形态

```
src/
└── zcli_daily_reminder.sajc.json
```

## 形状

当前 AFF v1 文档（嵌套模型）：

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Daily reminder job",
    "originalLanguage": "en"
  },
  "generalInformation": {
    "className": "ZCL_MY_JOB"
  },
  "exitClasses": {
    "check": "ZCL_MY_JOB_CHECK"
  },
  "parameters": [
    {
      "name": "P_DATE",
      "title": "Reminder date"
    }
  ]
}
```

用报表而非类的目录条目把 `className` 留空、改用 `generalInformation.programName`（对应旧模型的 `reportName`）。

## 两种 JSON 模型（release 差异）

ADT 应用作业资源的 JSON 文档模型随 SAP release 变化：

| 模型 | 特征字段 | 出现环境 |
|---|---|---|
| 扁平（legacy） | `className` / `reportName` / `checkExitClass` / `valueHelpExitClass` | 参考系统 SAP_BASIS 757（S/4HANA，2026-11 实测） |
| 嵌套（AFF v1） | `generalInformation` / `exitClasses` / `sections` / `groups` / `parameters` | 上游 AFF 当前 `sajc-v1.json`（新 release） |

CLI 的本地文件始终是嵌套 AFF v1。写之前先读 ADT 的 `…/catalogs/$schema` 判断目标模型，再做转换：

- 扁平模型只能表达 `generalInformation.className` / `programName`、`exitClasses.check` / `valueHelp`；
- 目标系统是扁平模型时，`sections` / `groups` / `parameters` 与非空的 `exitClasses.notification` 会按字段名报 `VALIDATION_ERROR`（exit 7），**不会静默丢弃**；
- `pull` 从扁平模型读回时生成等价的嵌套 AFF 文档（上述字段为空/省略）。

## 关键点

- **名称上限 40 字符**（typestructure `OBJNAME_MAXLENGTH`，本地在建前拒绝；通用对象名上限是 30，本类型单独放宽）。
- **主语言 = 会话语言**：SAP 在保存 JSON 文档时把对象主语言/`header.originalLanguage` 归一到当前登录语言（CLI profile 的 `language`）。因此 CLI 创建后用同 profile 拉回的 `originalLanguage` 可能是 `zh` 而不是本地文件的 `en`；`pull → push → pull` 之后保持稳定。
- **引用对象由 SAP 保存时校验**：catalog entry 的 `generalInformation.className` 必须是存在且实现应用作业执行接口的类（或用 `programName` 指向报表）。SAP 用一条通用消息「… contains errors and therefore cannot be saved」拒绝，CLI 把它映射成指向被引用对象的可操作提示。
- **模板依赖目录条目**：先 create 并激活 SAJC，再 create SAJT；删除时先删模板。
- **描述同步**：AFF `header.description` 同时落在对象元数据上；`push` 在同一把锁里写源码 + 描述，`pull → 改 → push → pull` 一致。
- **传输规则**：`push` / `delete` 非 `$` 前缀包需要 `--tr`；`$` 前缀本地包不需要。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- `typestructure`：`SAJC` 有 CREATE 能力，`OBJNAME_MAXLENGTH=40`。
- create → 写源码 → activate → pull → push（改描述）→ pull → delete 全生命周期通过；TADIR 无残留。
- 失败路径：引用不存在的类时 SAP 返回通用 400；CLI 报 `VALIDATION_ERROR` 并提示检查 `generalInformation.className`。
- 扁平模型 = 参考系统实测模型；嵌套模型用 mock ADT 覆盖（同一套 CLI 转换代码）。

## 同族未接入 / 相关

- `JOBD`（Technical Job Definition）：abapGit 有 handler，但没有官方 AFF 格式，参考 release 也没有 ADT 资源，需自建 schema + ICF 端点，独立评估。
- SM37 的运行时监控、作业调度不在 CLI 范围内（本类型只覆盖目录条目的版本化管理）。
