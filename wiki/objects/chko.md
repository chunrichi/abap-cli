---
type: object-type
title: CHKO — ATC 检查（ATC Check）
description: CHKO 的 ADT 版本化 XML 端点、chko-v1 AFF 字段契约、implementingClass/参数一致性要求与真机证据
tags: [abap-cli, object-type, chko, atc, abap-file-format, adt]
created at: 2026-11-03 19:30:00
changed at: 2026-11-03 19:30:00
---

# CHKO — ATC 检查（ATC Check）

ATC 的**具体检查**：把一个实现类（implementing class）挂到某个检查类别上，并固化该类暴露的参数。上游 AFF `chko-v1.json`，本地纯 JSON、无侧车。

## 路由（单通道 ADT）

| 操作 | ADT 端点 | 说明 |
|---|---|---|
| create | `POST /sap/bc/adt/atc/checks` | 创建后 inactive；激活时 SAP 校验实现类 |
| pull | `GET /sap/bc/adt/atc/checks/<name>` | `application/vnd.sap.adt.chkov1+xml` |
| push | lock → `PUT /sap/bc/adt/atc/checks/<name>` | 随后激活 |
| delete | lock → `DELETE /sap/bc/adt/atc/checks/<name>` | 非 `$` 包需 `--tr` |

## 本地文件形态

```
src/
└── zcli_my_check.chko.json
```

## `ZCLI_MY_CHECK.chko.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "my ATC check",
    "originalLanguage": "en"
  },
  "category": "ZCLI_MY_CATEGORY",
  "implementingClass": "ZCL_MY_ATC_CHECK",
  "checkType": "local",
  "parameters": [
    { "name": "THRESHOLD", "description": "Probe threshold", "hidden": false }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `category` | ✅ | 父 `CHKC` 名（必须已激活存在） |
| `implementingClass` | ✅ | 实现 `IF_CI_TEST` 的类；必须与 CHKO **同一软件组件**、且不能已被其它 CHKO 使用 |
| `checkType` | — | `local`（默认）/ `remoteEnabled`；映射到 wire `<chko:remoteEnabled>` |
| `parameters[]` | — | `name` / `description` / `hidden`；`hidden` 是 wire `parameterModifiable` 的**反义** |
| `parameters[].name` | — | 必须等于实现类 `QUERY_ATTRIBUTES` 里注册的 attribute id（大小写敏感，SAP 原样比较） |

## wire ↔ AFF 映射

| AFF | ADT XML |
|---|---|
| `category` | `<chko:category adtcore:name="…"/>` |
| `implementingClass` | `<chko:implementingClass adtcore:name="…"/>` |
| `checkType: 'remoteEnabled'` | `<chko:remoteEnabled>true</chko:remoteEnabled>`；`local` → `false` |
| `parameters[].hidden: true` | `<chkoParameter:parameterModifiable>false</…>`（其余情况 `true`） |
| `parameters[]` 顺序 | `<chkoParameter:parameterTechnicalId>` 从 1 递增；pull 时忽略 technicalId，按顺序回填 |

## 激活前置条件（真机踩坑记录）

创建/写入本身很容易成功，**卡点在激活**。SAP 在 `POST /sap/bc/adt/activation` 时逐项校验，失败会返回 `activationExecuted="false"` 与 `chkl:messages`（CLI 转成 `ACTIVATION_FAILED`）：

1. **实现类必须已注册为「活动检查」**（表 `SCITESTS`）。仅实现 `IF_CI_TEST` 不够；需要调用 `CL_CI_TESTS=>ADD_TEST( 'ZCL_...' )`（SE80 的 check class 激活入口，ADT 不会代做）。未注册时错误：`实施类 … 未设置为活动检查`。
2. **实现类的参数表必须非空且每个参数有 id**：类里 `IF_CI_TEST~QUERY_ATTRIBUTES` 的 `SCI_ATTTAB` 行必须设置 `ID`（不是只给 `REF`/`TEXT`/`KIND`）；否则报「参数不含名称 / 未找到参数标识」。
3. **参数个数与 id 必须与 CHKO 一致**：类里 `has_attributes = abap_true`、`PUT_ATTRIBUTES`/`GET_ATTRIBUTES` 按同一结构序列化；否则报「实施类具有 N 个参数，检查对象具有 M」。
4. **实现类不能已被其它 CHKO 使用**、必须与 CHKO 在**同一软件组件**。

一个最小可激活实现类：`CLASS zcl_x DEFINITION ... INHERITING FROM cl_ci_test_root`，构造器里 `super->constructor( )` + `has_attributes = abap_true`，`QUERY_ATTRIBUTES` 里 `GET REFERENCE OF me->threshold` 并设置 `text/kind/id='THRESHOLD'`，`GET_ATTRIBUTES`/`PUT_ATTRIBUTES` 用 `EXPORT/IMPORT ... TO/FROM DATA BUFFER` 序列化同一个字段。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- 用自建 `ZCL_CLI_TC_CHECK`（继承 `cl_ci_test_root`、单参数 `THRESHOLD`）注册成活动检查后：CHKO create → activate 成功；`lock → PUT`（改描述/参数描述）→ activate 成功，GET 回读 `version="active"`。
- delete 成功（`deleted:true`，之后 GET 404）。
- 反例全部复现：未注册活动检查、参数 id 缺失、参数个数不匹配、实现类已被占用、实现类组件不一致 —— SAP 均以激活消息拒绝。

## 已知限制 / gotcha

- **`hidden` 默认省略**：wire 的 `parameterModifiable=true` 回读为「无 `hidden` 字段」，而不是 `hidden: false`；两种写法语义相同。
- **`checkType` 默认 `local`**：wire false 时 pull 会写 `"checkType": "local"`（显式），而无该字段的文档代表同一个默认值。
- **`originalLanguage`** 与 CHKC 相同：SAP 按登录/激活语言决定，pull 返回实际值。
- **没有 ICF 兜底**：`CHKO` 只在有 ADT ATC 资源的系统上可用（本仓库验证的 S/4HANA 有）。
