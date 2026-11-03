---
type: object-type
title: SAJT — 应用作业模板（Application Job Template）
description: SAJT 的 ADT applicationjob 端点、sajt-v1 AFF 契约、参数值映射与真机证据
tags: [abap-cli, object-type, sajt, application-jobs, abap-file-format, adt]
created at: 2026-11-03 21:55:00
changed at: 2026-11-03 21:55:00
---

# SAJT — 应用作业模板（Application Job Template）

SAP **应用作业**的模板：引用一个已激活的目录条目（[SAJC](sajc.md)），并预填选择屏参数值。上游 AFF 官方 `sajt-v1.json`，本地单 JSON；ADT 上是 blueSource 资源，`source/main` 就是该 JSON 文档。

## 路由（单通道 ADT）

| 操作 | ADT 端点 |
|---|---|
| create | `POST /sap/bc/adt/applicationjob/templates`（`application/vnd.sap.adt.blues.v1+xml`） |
| pull | `GET /sap/bc/adt/applicationjob/templates/<name>/source/main`（`application/json`） |
| push | lock → `PUT …/source/main` → `PUT …/<name>`（同步描述）→ unlock → activate |
| delete | lock → `DELETE …/<name>` → unlock（非 `$` 包需 `--tr`） |

## 本地文件形态

```
src/
└── zcli_daily_reminder_tpl.sajt.json
```

## 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "Daily reminder template",
    "originalLanguage": "en"
  },
  "generalInformation": {
    "catalogName": "ZCLI_DAILY_REMINDER"
  },
  "parameters": {
    "singleValueParameters": [
      { "name": "P_TEXT", "value": "Hello" }
    ],
    "valueRangesParameters": [
      {
        "name": "P_DATE",
        "valueRanges": [
          { "sign": "include", "option": "equals", "low": "2026-11-03" }
        ]
      }
    ]
  }
}
```

## 两种 JSON 模型（release 差异）

| 模型 | 参数形态 | 出现环境 |
|---|---|---|
| 扁平（legacy） | `parameters: [{ name, valueRanges: [...] }]` | 参考系统 SAP_BASIS 757（S/4HANA，2026-11 实测） |
| 嵌套（AFF v1） | `parameters.{singleValueParameters,valueRangesParameters}` | 上游 AFF 当前 `sajt-v1.json`（新 release） |

CLI 本地文件始终是嵌套 AFF v1，写前通过 `$schema` 探测目标模型：

- 扁平模型只能表达 `valueRangesParameters`（映射为扁平 `parameters` 列表）；
- 目标系统是扁平模型时，非空的 `singleValueParameters` 会报 `VALIDATION_ERROR`（exit 7），不会静默丢弃。

## 关键点

- **写入即生效**：与 SAJC 相同，`source/main` 写入即保存并激活，不存在 inactive 版本；`--no-activate` 被本地拒绝（exit 7）。
- **名称上限 40 字符**（typestructure `OBJNAME_MAXLENGTH`；通用对象名上限 30，本类型单独放宽）。
- **引用对象由 SAP 保存时校验**：`generalInformation.catalogName` 必须指向已存在且激活的 SAJC；否则 SAP 返回通用 400，CLI 报 `VALIDATION_ERROR` 并提示先创建/激活目录条目。
- **参数名必须与执行类声明匹配**：SAP 按目录条目的参数模型校验 `name`；本地 CLI 不做该语义校验，错误由 SAP 返回。
- **主语言 = 会话语言**（与 SAJC 相同）：`pull` 回写的 `originalLanguage` 是当前登录语言，`pull → push → pull` 后稳定。
- **描述同步与传输规则**同 SAJC：`push` 在同一把锁里写源码 + 描述；非 `$` 前缀包 `push` / `delete` 需 `--tr`。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- `typestructure`：`SAJT` 有 CREATE 能力，`OBJNAME_MAXLENGTH=40`。
- 先 create/activate SAJC，再 create → 写源码 → activate → pull → push → pull → delete SAJT → delete SAJC 全生命周期通过，TADIR 无残留。
- 嵌套模型用 mock ADT 覆盖。
