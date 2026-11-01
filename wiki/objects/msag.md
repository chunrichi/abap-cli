---
type: object-type
title: MSAG — 消息类（Message Class）
description: MSAG 对象的双通道路由、messages[] 字段契约、占位符转义
tags: [abap-cli, object-type, msag, adt, icf, abap-file-format, message-class]
created at: 2026-09-04 00:00:00
changed at: 2026-11-01 23:05:00
---

# MSAG — 消息类（Message Class）

## 路由（双通道）

| 系统 | 通道 | 端点 |
|---|---|---|
| S/4HANA、ECC EHP7+（kernel ≥ 753） | ADT | `/sap/bc/adt/messageclass/<name>` |
| ECC EHP5 / EHP6（kernel < 753） | ICF 兜底 | `/sap/abap_cli/ddic/msag/<name>` |
| 现代内核但 ADT 端点未路由（SAP 答 `No URI-Mapping defined for URI`） | ICF 运行时兜底 | `/sap/abap_cli/ddic/msag/<name>` |

通道由 `flows/edit/channel-detect.ts` 判定，结果写入 `data.channel`；走兜底时写 `data.fallbackReason`——ECC 旧内核为 `"ECC_EHP6_NO_ADT_MESSAGECLASS"`，现代内核缺 ADT 端点时为 `"ADT_ENDPOINT_UNAVAILABLE"`（内核版本预测不了 SICF 节点是否存在，只能在 ADT 调用失败后判定）。

ICF 兜底由 `zcl_abap_vibe_msag_format`（读，T100A 头 + T100 文本）与 `zcl_abap_vibe_icf` 的 `/ddic/msag` handler（写，T100A/T100 `MODIFY` + `ENQUEUE_E_TABLEE` 锁）提供。

## ADT wire 形态

`/sap/bc/adt/messageclass/<name>` 的 GET / PUT 使用 ADT EMF 文档：头信息在 `adtcore` 属性里，每条消息是一个 `<mc:messages>` 元素（元素名是复数，文本放在属性上）：

```xml
<mc:messageClass xmlns:mc="http://www.sap.com/adt/MessageClass"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:name="ZMY_MSAG" adtcore:type="MSAG/N"
                 adtcore:description="My message class" adtcore:language="EN">
  <mc:messages mc:msgno="001" mc:msgtext="Object &amp;1 created"/>
</mc:messageClass>
```

ADT 的创建分两步：`POST /sap/bc/adt/messageclass` 只建头（name / description / language / package），消息文本随后经 lock → `PUT ?lockHandle=` → unlock 写入——创建请求体里带的 `mc:messages` 会被静默丢弃。

## 本地文件形态

```
src/
└── zmy_msag.msag.json
```

单文件，无侧车——消息文本本身就是数据，没有源码形态。

## `<name>.msag.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "My message class",
    "originalLanguage": "EN"
  },
  "messages": [
    { "number": "001", "text": "Object &1 created" },
    { "number": "002", "text": "Object &1 not found in &2" },
    { "number": "003", "text": "Operation completed" }
  ]
}
```

## 关键字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `header.description` | string | 消息类短文本（T100A-STEXT） |
| `messages[].number` | string | 三位消息号（必填），前导零保留（`"001"`，不是 `1`） |
| `messages[].text` | string | 消息文本，最多 4 个占位符 `&1`–`&4` |

## 占位符与 XML 转义

ADT 通道的 wire body 是 XML，`&1` 在传输中编码为 `&amp;1`。CLI 的 `wireToLocal` / `localToWire` 负责双向转义（`& < > " '` 五个预定义实体），本地 JSON 里始终是**未转义的原文** `&1`。

## 命令示例

```bash
abap create MSAG ZMY_MSAG --file src/zmy_msag.msag.json --package $TMP --yes --json
abap pull SADT_TOOLS_CORE --type MSAG --json
abap push src/zmy_msag.msag.json --yes --json
```

## abap-file-format 合规性

复用上游 `msag/msag-v1.json` schema。`messages` 为必填字段，且每条消息的 `number` 也是必填（上游加严）——缺失会被 `validate:aff` 拒绝（`AFF_FIXTURE_INVALID`）。

## 已知坑

- **消息号必须是字符串**：`"001"` 而非 `1`；数字形态会丢前导零，SAP 侧查不到
- **语言回退**：ICF 读取先按登录语言查 T100，无译文时回退英语；跨语言系统上 pull 结果可能与 SE91 显示不同
- **push 是全量覆盖**：本地 `messages[]` 就是最终态；SAP 上多出的消息号不会被删除（`MODIFY` 语义），删消息需在 SE91 手工做
- **创建不是一次 POST**：ADT 创建只建头，消息文本要再走一次 lock → PUT；只在创建请求里带 `mc:messages` 会得到空消息类
- **ADT 端点不一定存在**：部分内核（含 S/4HANA）没有注册 messageclass 的创建/路由端点，SAP 答 `No URI-Mapping defined for URI`；CLI 在运行时识别该签名并切 ICF，`data.fallbackReason` 为 `"ADT_ENDPOINT_UNAVAILABLE"`
- **通道缓存**：`detectChannel` 在进程内缓存；单测需调 `clearChannelCache()`

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 真实 SAP 回归：本地 `tests/260904002-msag-real-sap/`（gitignored，本地执行证据，不入库）
- abap-file-format 规范来源（vendored schema）：[`src/abap_cli/schema/README.md`](../../src/abap_cli/schema/README.md)
