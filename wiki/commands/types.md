---
type: command
title: abap types
description: "Print the canonical CLI type ↔ TADIR PGMID/OBJECT ↔ DDIC tabclass mapping. Pure local — no SAP call. Surfaces the non-obvious mappings that cost real time when joining CLI write paths to TADIR queries (CLI HTTP ↔ TADIR SICF, CLI STRU ↔ TADIR TABL + DD02L-TABCLASS=INTTAB, etc.)."
tags: [abap-cli, command, types]
created at: 2026-10-29 14:30:14
changed at: 2026-10-30 20:00:00
---

# abap types

打印 CLI 类型码 ↔ TADIR `PGMID`/`OBJECT` ↔ DDIC `TABCLASS` 的规范映射。纯本地命令，不连 SAP。用来回答那些"猜不出来、查起来很花时间"的对应关系：CLI 的 `HTTP` 在 TADIR 里是 `SICF`；CLI 的 `STRU` 在 TADIR 里也是 `TABL`，只能靠 `DD02L-TABCLASS=INTTAB` 区分。

`abap types` 只描述对象类型的 **SAP 侧身份**，不再包含本地目录字段：AFF 产物平铺在 `src/`（文件名 `<name>.<type>[.<sub_type>].<ext>` 自带类型后缀），没有类型子目录，因此旧的 FOLDER 列已删除。

## Usage

```bash
abap types [--json] | abap types <type> [--json]
```

## Arguments

| Argument | Required | Values | Description |
| --- | --- | --- | --- |
| `type` | no |  | Optional CLI type code to look up (e.g., STRU, HTTP, PROG). |

## Options

| Option | Required | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `--tadir-object` | no |  |  | With a single type, print only the TADIR OBJECT value (one line, no table). |
| `--json` | no |  |  | Emit a single JSON envelope (global flag). |

## Examples

```bash
# 打印完整类型目录（human 表格：CLI / TADIR OBJECT / DDIC tabclass / CHANNEL / AFF SCHEMA / DESCRIPTION）
abap types

# 查单个类型
abap types HTTP

# 只取 TADIR OBJECT（脚本用）
abap types STRU --tadir-object
```

## Expected Output

完整目录（`data` 是行数组，每行一个类型；此处截取两行）：

```json
{
  "status": "success",
  "meta": { "command": "abap types", "version": "1.1.0", "timestamp": "2026-10-30T12:00:00.000Z", "durationMs": 2, "warnings": [] },
  "data": [
    { "cliType": "CLAS", "pgmid": "R3TR", "tadirObject": "CLAS", "ddicTabclass": "", "channel": "ADT", "affSchema": "clas-v1.json", "description": "Global ABAP class" },
    { "cliType": "STRU", "pgmid": "R3TR", "tadirObject": "TABL", "ddicTabclass": "INTTAB", "channel": "ICF", "affSchema": "tabl-v1.json", "description": "Structure (DDIC) — TADIR OBJECT is also TABL; disambiguate via DD02L-TABCLASS=INTTAB" }
  ]
}
```

单类型查询时 `data` 是该行对象本身：

```json
{
  "status": "success",
  "data": { "cliType": "HTTP", "pgmid": "R3TR", "tadirObject": "SICF", "ddicTabclass": "", "channel": "ICF", "affSchema": "http-v1.json", "description": "ICF/SICF service node (TADIR OBJECT is SICF, not HTTP)" }
}
```

`--tadir-object` 时 `data` 收窄为 `{ type, tadirObject }`，human 输出只打印 `SICF` 这类单值。

# More

## fixme

- [ ] 目录行来自 `flows/setup/types-catalog.ts` 的手工表，新增 `TYPE_REGISTRY` 类型时需同步补行，否则该类型不会出现在 `abap types` 输出里

## todo

- [ ] 真机证据待补：TADIR 映射（尤其 `HTTP → SICF`、`STRU → TABL + INTTAB`）在 A4H 上的 `abap select --table TADIR` 回归

# references

- [docs/commands.md](../../docs/commands.md) — generated parameter reference
- [agent-integration.md](../../docs/agent-integration.md) — `--json` contract
- 实现：`src/abap_cli/commands/types.ts`、`src/abap_cli/flows/setup/types-catalog.ts`、`src/abap_cli/types/registry.ts`
