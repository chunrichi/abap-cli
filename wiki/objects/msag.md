---
type: object-type
title: MSAG — 消息类（Message Class）
description: MSAG 对象的双通道路由、messages[] 字段契约、占位符转义
tags: [abap-cli, object-type, msag, adt, icf, abap-file-format, message-class]
created at: 2026-09-04 00:00:00
changed at: 2026-09-04 00:00:00
---

# MSAG — 消息类（Message Class）

## 路由（双通道）

| 系统 | 通道 | 端点 |
|---|---|---|
| S/4HANA、ECC EHP7+（kernel ≥ 753） | ADT | `/sap/bc/adt/messageclass/<name>` |
| ECC EHP5 / EHP6（kernel < 753） | ICF 兜底 | `/sap/zabap_vibe/ddic/msag/<name>` |

通道由 `flows/edit/channel-detect.ts` 判定，结果写入 `data.channel`；走兜底时写 `data.fallbackReason: "ECC_EHP6_NO_ADT_MESSAGECLASS"`。

ICF 兜底由 `zcl_abap_vibe_msag_format`（读，T100A 头 + T100 文本）与 `zcl_abap_vibe_icf` 的 `/ddic/msag` handler（写，T100A/T100 `MODIFY` + `ENQUEUE_E_TABLEE` 锁）提供。

## 本地文件形态

```
src/msag/zmy_msag/
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
| `messages[].number` | string | 三位消息号，前导零保留（`"001"`，不是 `1`） |
| `messages[].text` | string | 消息文本，最多 4 个占位符 `&1`–`&4` |

## 占位符与 XML 转义

ADT 通道的 wire body 是 XML，`&1` 在传输中编码为 `&amp;1`。CLI 的 `wireToLocal` / `localToWire` 负责双向转义（`& < > " '` 五个预定义实体），本地 JSON 里始终是**未转义的原文** `&1`。

## 命令示例

```bash
abap create MSAG ZMY_MSAG --file src/msag/zmy_msag/zmy_msag.msag.json --package $TMP --json
abap pull SADT_TOOLS_CORE --type MSAG --json
abap push src/msag/zmy_msag/zmy_msag.msag.json --tr DEVK900001 --json
```

## abap-file-format 合规性

复用上游 `msag/msag-v1.json` schema。`messages` 为必填字段——缺失会被 `validate:aff` 拒绝（`AFF_FIXTURE_INVALID`）。

## 已知坑

- **消息号必须是字符串**：`"001"` 而非 `1`；数字形态会丢前导零，SAP 侧查不到
- **语言回退**：ICF 读取先按登录语言查 T100，无译文时回退英语；跨语言系统上 pull 结果可能与 SE91 显示不同
- **push 是全量覆盖**：本地 `messages[]` 就是最终态；SAP 上多出的消息号不会被删除（`MODIFY` 语义），删消息需在 SE91 手工做
- **通道缓存**：`detectChannel` 在进程内缓存；单测需调 `clearChannelCache()`

# references

- 类型索引：[`wiki/objects/index.md`](index.md)
- 真实 SAP 回归：[`tests/260904002-msag-real-sap/`](../../tests/260904002-msag-real-sap/)
- abap-file-format 导出约定：[`wiki/abap-file-format-export.md`](../abap-file-format-export.md)
