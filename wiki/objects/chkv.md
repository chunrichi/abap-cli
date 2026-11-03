---
type: object-type
title: CHKV — ATC 检查变体（ATC Check Variant）
description: CHKV 的 ADT 版本化 XML 端点、chkv-v1 AFF 字段契约、parameterValueXml 内嵌 JSON 与真机证据
tags: [abap-cli, object-type, chkv, atc, abap-file-format, adt]
created at: 2026-11-03 19:30:00
changed at: 2026-11-03 19:30:00
---

# CHKV — ATC 检查变体（ATC Check Variant）

ATC 的**检查变体**：选择一组 `CHKO` 检查并给出每个检查的参数值，供 `abap check atc --variant <name>` / ATC run 使用。上游 AFF `chkv-v1.json`，本地纯 JSON、无侧车。

## 路由（单通道 ADT）

| 操作 | ADT 端点 | 说明 |
|---|---|---|
| create | `POST /sap/bc/adt/atc/checkvariants` | 创建后 inactive；激活时 SAP 校验每个检查的参数 |
| pull | `GET /sap/bc/adt/atc/checkvariants/<name>` | `application/vnd.sap.adt.chkvv4+xml`（注意是 **v4**） |
| push | lock → `PUT /sap/bc/adt/atc/checkvariants/<name>` | 随后激活 |
| delete | lock → `DELETE /sap/bc/adt/atc/checkvariants/<name>` | 非 `$` 包需 `--tr` |

## 本地文件形态

```
src/
└── zcli_my_variant.chkv.json
```

## `ZCLI_MY_VARIANT.chkv.json` 形状

```json
{
  "formatVersion": "1",
  "header": {
    "description": "my check variant",
    "originalLanguage": "en"
  },
  "remoteEnabled": false,
  "selectedChecks": [
    {
      "checkName": "ZCLI_MY_CHECK",
      "parameters": [
        { "name": "THRESHOLD", "value": "10" }
      ]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `selectedChecks` | ✅ | 至少 1 项；每项 `checkName` 必填 |
| `selectedChecks[].parameters[]` | — | `name` 必填；值字段按 AFF `chkv-v1`：`value` / `structuredValue` / `structuredValueList` / `valueList` / `valueRangeList` |
| `remoteEnabled` | — | 布尔；wire false 时 pull 省略该字段 |

## wire ↔ AFF 映射：`parameterValueXml` 内嵌 JSON

CHKV 的 wire 结构是**每个检查一段 XML + 一段内嵌 JSON**：

```xml
<chkvcheck:check>
  <chko:checkObject adtcore:name="ZCLI_MY_CHECK"><chko:content/></chko:checkObject>
  <chkvcheck:parameterValueXml>{"checkName": "ZCLI_MY_CHECK", "parameters": [{"name": "THRESHOLD", "value": "10"}]}</chkvcheck:parameterValueXml>
</chkvcheck:check>
```

- `parameterValueXml` 的内容就是 AFF `selectedChecks[]` 里的 check 对象（`checkName` + 可选 `parameters`）——SAP 原样存储，pull 时直接 `JSON.parse`，因此参数子结构（结构化值、值列表、range 列表）可以无损往返。
- `checkName` 以 JSON 内为准（XML 的 `adtcore:name` 只是冗余索引）；pull 在 JSON 缺 `checkName` 时回退到 XML 名。
- push 时 CLI 用紧凑 JSON 序列化（`{"checkName":"...","parameters":[...]}`），SAP 接受并把该字符串原样存回。

## 激活前置条件

- 变体引用的 `CHKO` 必须已创建并激活；
- 每个检查的参数必须与实现类 `QUERY_ATTRIBUTES` 暴露的参数**个数与 id 完全一致**。例如 `ABAP_UNIT` 检查要求 6 个属性，只给 0 个会报「检查 … 预期 6 个属性，但找到了 0 个」；
- 变体里用自建检查（参数 id 已知）最容易验证；真实场景请从 `abap pull CHKV <existing>` 拿一份可用的参数模板再改。

## 真机验证（S/4HANA profile `test`，2026-11-03）

- `create → activate`：201 + inactive → `activationExecuted=true` → `version="active"`。
- `lock → PUT`（改描述 + 参数值 10→20）→ activate 成功，GET 回读参数值 20；`selectedChecks` 增加第二个检查也能写回。
- `remoteEnabled` 可从 false 改为 true 并读回。
- delete 成功；随后 GET 404。
- 反例：参数个数不匹配（ABAP_UNIT 0/6）时激活返回 `ACTIVATION_FAILED` 与 SAP 明确消息。

## 已知限制 / gotcha

- **wire 版本是 v4**：`Accept`/`Content-Type` 用 `application/vnd.sap.adt.chkvv4+xml`；用 v1 会 406。
- **AFF 不覆盖的 wire 字段**（`abapsource:fixPointArithmetic`、`activeUnicodeCheck`、`syntaxConfiguration`、`referencedVariant`）pull 丢弃、push 不发送，由 SAP 保留默认值——AFF 文档不是 CHKV 的全量镜像。
- **`remoteEnabled=false` 时 pull 省略**该字段（schema 默认 false）。
- **`selectedChecks` 至少 1 条**（AFF `$minItems 1`）：空变体过不了本地 schema 校验。
- **名称/语言**：对象名走通用 30 字符校验；`originalLanguage` 与 CHKC/CHKO 一样由 SAP 决定。
