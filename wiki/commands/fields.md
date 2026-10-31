---
type: command
title: abap fields
description: "只读列出一个表/视图的 DDIC 字段清单，或反向查找包含指定字段的所有表（--find 反查）。"
tags: [abap-cli, command, fields, ddic, dd03l, reverse-lookup, read-only]
created at: 2026-10-29 14:30:14
changed at: 2026-10-31 13:24:09
---

# abap fields

只读查看 DDIC 字段。两种模式：

- **正向** `abap fields <table>`：列出某个表 / 视图的字段清单（名字、位置、是否主键、是否非空、数据元素、类型、长度、小数位）。
- **反向** `abap fields --find <f1>,<f2>`：反查**哪些表包含这些字段**，例如"哪些表记录了最后修改人 + 修改时间"。

正向模式本质是查 `DD03L`（经 bundled ICF 的 `/data/query`，不读表数据）；反向模式走专用端点 `/data/find-tables-by-fields`，在 SAP 端用一次 `DD03L JOIN DD02L` 完成，成本与命中行数相关而不是"表数 × 字段数"。命令不加锁、不产生 transport、不修改数据。

## Usage

```bash
abap fields <table> [--json]
abap fields --find <f1>,<f2>,... [--any] [--with-text] [--as4local A|I] [--tabclass <class>] [--limit <n>]
abap fields --schema --json
```

## Options

- `<table>`: 表 / 视图名，自动转大写；与 `--find` **互斥**，二者必须给一个。
- `--find <f1,f2,...>`: 反向查找的字段名列表（逗号分隔，最多 **20** 个）。
- `--any`: 反向查找时改为"包含任意一个字段"；默认要求包含全部字段。
- `--with-text`: 反向查找时附带 DDIC 短文本（`DD03T` 字段文本优先，缺失时回退 `DD04T` 数据元素文本）。
- `--as4local <A|I>`: 反向查找的 DDIC 版本，默认 `A`（活动版本）；`I` 才会扫到 inactive / 已修改版本。
- `--tabclass <class>`: 反向查找限定 DDIC 表类别（`TRANSP` / `VIEW` / `INTTAB` / ...）。
- `--limit <n>`: 反向查找最大返回表数，默认 200，硬上限 5000（超出被夹到 5000）。
- `--schema`: 打印参数 schema 并退出，不调用 SAP；`--json` / `--pretty-json` 是全局输出模式，见 [agent-integration](../../docs/agent-integration.md)。

## 前置条件

- 已绑定 profile，SAP 可达；ICF 服务已部署且版本匹配（当前 bundled 版本 `1.1.0`，含 `/data/find-tables-by-fields`）。旧服务缺端点时反向模式报 `QUERY_FAILED`，先 `abap deploy --yes`。
- 对 `DD03L` / `DD02L`（以及 `--with-text` 时的 `DD03T` / `DD04T`）有读权限。

## Examples

```bash
# 正向：VRSD 的字段清单（人类可读）
abap fields VRSD
# 正向：机器可读
abap fields VRSD --json
# 反向：哪些 TRANSP 表同时有"修改人 + 修改日期"
abap fields --find CHANGED_BY,CHANGED_ON --tabclass TRANSP
# 反向 + 短文本：任何含 UNAM 字段的表
abap fields --find UNAM --with-text --limit 50 --json
```

## Expected Output

正向（`--json`，`data.fields` 按 `position` 升序；空字段省略）：

```json
{
  "status": "success",
  "meta": { "command": "abap fields", "version": "1.1.0", "timestamp": "2026-10-31T05:30:12.310Z", "durationMs": 286, "warnings": [] },
  "data": {
    "table": "VRSD", "count": 2, "truncated": false,
    "fields": [
      { "field": "MANDT", "position": 1, "key": true, "notNull": true, "rollname": "MANDT", "dataType": "CLNT", "length": 3 },
      { "field": "KEYLEN", "position": 8, "key": false, "notNull": false, "dataType": "INT2", "length": 5 } ]
  }
}
```

反向（`--json`，`hitCount` 是命中的请求字段数，`mode` 是 `all` / `any`）：

```json
{
  "status": "success",
  "meta": { "command": "abap fields", "version": "1.1.0", "timestamp": "2026-10-31T05:31:40.872Z", "durationMs": 391, "warnings": [] },
  "data": {
    "total": 2, "truncated": false, "mode": "all", "requestedCount": 2,
    "matches": [ { "table": "VRSD", "tabclass": "TRANSP", "hitCount": 2, "fields": [
      { "name": "CHANGED_BY", "position": 6, "rollname": "UNAME" },
      { "name": "CHANGED_ON", "position": 7, "rollname": "DATUM" } ] } ]
  }
}
```

## 关键错误码

| 错误码 | 类别 / exit | 触发场景 | 恢复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | `DD03L` 里没有该对象的字段行（名字错 / 不是表或视图） | `abap search <name> --exact` 核对 |
| `INVALID_ARGUMENT` | USAGE / 2 | 名字不是合法 DDIC 标识符、`--find` 为空、同时给了表名和 `--find` | 按 `error.nextSteps` 修正 |
| `LIMIT_EXCEEDED` | VALIDATION_ERROR / 7 | `--find` 超过 20 个字段 | 拆成多次更窄的查询 |
| `QUERY_FAILED` | SAP_ERROR / 6 | SAP 返回空 payload（ICF 未部署 / 版本旧 / 查询失败） | `abap deploy --yes`，或 `abap doctor` 诊断 |

## 真机证据

- **未验证**：本页没有记录正向 / 反向模式在 A4H 或 S/4HANA 上的端到端输出；反向查找的 SQL 成本形态在 vhcala4hci（A4H，约 10 万行 `DD03L`）验证过（见 `abap/src/zcl_abap_vibe_icf_fields.clas.abap` 注释），功能正确性未单独验证。

# More

## gotcha

- **`--any` 目前等价于 ALL**：客户端会发 `requireAll: false`，但 SAP 端 `parse_find_request` 把 `requireAll` 一律解析成 true（源码如此），`mode` 也恒为 `all`；需要"任意字段"语义时按字段拆成多次单字段查询。
- **`total` 是截断后的数量**：服务端先按 `limit` 截断再计数，`total` 恒等于 `matches.length`；真实总数不可得，只能看 `truncated`。
- **`--as4local I` 才看得到未激活版本**（默认 `A` 只扫活动版本）；`--with-text` 的文本取会话语言，字段文本（`DD03T`）优先于数据元素文本（`DD04T`）。

# references

- 实现：`src/abap_cli/commands/fields.ts`、`src/abap_cli/flows/data/fields.ts`；SAP 端 `abap/src/zcl_abap_vibe_icf_fields.clas.abap`
- 生成参数表：[docs/commands.md](../../docs/commands.md)；`--json` 契约：[agent-integration.md](../../docs/agent-integration.md)
- 所属 skill：[skills/abap-cli-data/SKILL.md](../../skills/abap-cli-data/SKILL.md)
