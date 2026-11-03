---
type: object-type
title: DSFD — CDS 标量函数定义（Scalar Function Definition）
description: DSFD 的 ADT blueSource 端点、dsfd-v1 AFF 契约、DD_CDS_DSFD 用户参数门禁与真机证据
tags: [abap-cli, object-type, dsfd, cds, abap-file-format, adt]
created at: 2026-11-03 20:10:00
changed at: 2026-11-03 20:10:00
---

# DSFD — CDS 标量函数定义（Scalar Function Definition）

CDS 的**标量函数定义**（`define scalar function …`），ADT 上使用 blueSource 元数据 + `source/main` 源码。上游 AFF 官方 `dsfd-v1.json`。

## 路由（单通道 ADT）

| 操作 | ADT 端点 |
|---|---|
| create | `POST /sap/bc/adt/ddic/dsfd/sources`（内容类型 `application/vnd.sap.adt.blues.v1+xml`） |
| pull | `GET /sap/bc/adt/ddic/dsfd/sources/<name>`（blueSource）+ `…/source/main` |
| push | lock → `PUT …/source/main` → `PUT …/<name>`（描述）→ unlock → activate |
| delete | lock → `DELETE …/<name>`（非 `$` 包需 `--tr`） |

## 本地文件形态

```
src/
├── zcli_my_func.dsfd.json
└── zcli_my_func.dsfd.acds
```

## 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "my scalar function",
    "originalLanguage": "en"
  }
}
```

```cds
define scalar function zcli_my_func
  with parameters
    p1 : abap.int1,
    p2 : abap.int2
  returns abap.int4;
```

## 关键点：`DD_CDS_DSFD` 用户参数门禁

DSFD 的 create / 修改 / 删除在 SAP 侧受**用户参数 `DD_CDS_DSFD`** 控制（feature switch，不是权限对象）：

- 未启用时，SAP 返回误导性的
  `Insufficient authorizations for modifying CDS Scalar Function <NAME>.`，
  即使 `S_DEVELOP` 权限完全正常。
- CLI 将该消息映射为 **`DSFD_FEATURE_NOT_ENABLED`**（exit 7），并在 `nextSteps` 给出启用方法：
  - SAP GUI → SU3 → Parameter 页 → 参数 ID `DD_CDS_DSFD` = `X`，保存；或
  - 在 ABAP 会话里 `SET PARAMETER ID 'DD_CDS_DSFD' FIELD 'X'`。
- 启用后 create/push/delete/activate 正常（pull 只读不受影响）。

其它要点：

- AFF 元数据只有 header；正文在 `.acds` 侧车；push 同步描述。
- 名称上限 **26 字符**（typestructure `OBJNAME_MAXLENGTH`）。
- DSFI 引用的就是 DSFD 名称（`<函数>_ANA` 去掉后缀），所以 DSFD 必须先创建并激活。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- 未设参数：create 报授权失败（复现）；用 `SET PARAMETER ID` 启用后 create → 激活成功。
- `pull` 写出 `.dsfd.json` + `.dsfd.acds`；改描述后 `push` → 激活；`pull` 与本地一致。
- `delete` 成功；`abap delete` 在已删除时返回 `OBJECT_NOT_FOUND`。
