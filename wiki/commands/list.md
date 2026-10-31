---
type: command
title: abap list
description: "只读列出包内 ABAP 对象（ADT quickSearch 通配搜索 + 客户端包过滤），用于清理临时对象或审计包内内容。"
tags: [abap-cli, command, list, package, adt, quicksearch, read-only]
created at: 2026-10-29 14:30:14
changed at: 2026-10-31 13:24:09
---

# abap list

只读列出包内的 ABAP 对象。实现方式是 ADT `quickSearch` 的 `*` 通配搜索（取前 N 条命中），再在**客户端**按 `adtcore:packageName` 过滤出目标包。命令不加锁、不产生 transport、不修改任何数据。

典型用途：清理 `$TMP` 里的探针类 / 草稿，或在批量 `pull` / `push` 前先看一眼包里有什么。注意它**不是服务端包查询**——包过滤发生在结果取回之后，因此 `--limit` 的截断会影响包内对象的完整性（见下方 gotcha）。

## Usage

```bash
abap list --package <pkg> [--type <type>] [--limit <n>] [--json]
abap list --schema --json
```

## Options

- `--package <pkg>`: **必填**。包名（如 `$TMP`、`ZDEV`），大小写不敏感，内部转大写。
- `--type <type>`: 按对象类型过滤（`CLAS` / `PROG` / `INTF` / `FUGR` / `TABL` / `DDLS` / ...），内部只做转大写，必须用 ADT 类型码。
- `--limit <n>`: 最多取多少条 quickSearch 命中，默认 20；**硬上限也是 20**（超出被夹到 20）。
- `--schema`: 打印参数 schema 并退出，不调用 SAP。
- `--json` / `--pretty-json`: 全局输出模式，见 [agent-integration](../../docs/agent-integration.md)。

## 前置条件

- 已绑定 profile（`.abap.json`），SAP 可达且凭据有效；只读命令不需要 transport。
- 目标包名正确；`$TMP` 用 shell 单引号写成 `'$TMP'`，避免被 shell 当变量展开。
- 对包内对象的可见性受 SAP 权限限制，结果只反映当前用户的搜索可见范围。

## Examples

```bash
# 列出 $TMP 里所有对象（单引号防止 shell 展开 $TMP）
abap list --package '$TMP'
# 只看 $TMP 里的类
abap list --package '$TMP' --type CLAS --json
# 其它包（结果同样受 20 条上限约束）
abap list --package ZDEV --type PROG --limit 20
```

## Expected Output

`--json`（`count` 是过滤后的条数；`truncated` 表示 quickSearch 命中达到 `--limit` 上限）：

```json
{
  "status": "success",
  "meta": { "command": "abap list", "version": "1.2.0", "timestamp": "2026-10-31T05:34:02.115Z", "durationMs": 268, "warnings": [] },
  "data": {
    "count": 2, "truncated": false, "packageName": "$TMP", "type": "CLAS",
    "entries": [
      { "name": "ZCL_ZR_CHK9", "type": "CLAS", "packageName": "$TMP", "description": "Scratch probe" },
      { "name": "ZCL_DEMO", "type": "CLAS", "packageName": "$TMP", "description": "Demo class" }
    ]
  }
}
```

人类模式：

```
2 object(s) in $TMP (type=CLAS)
  CLAS     ZCL_ZR_CHK9                        Scratch probe
  CLAS     ZCL_DEMO                           Demo class
```

## 关键错误码

| 错误码 | 类别 / exit | 触发场景 | 恢复 |
|---|---|---|---|
| `USAGE` | USAGE / 2 | 缺 `--package` | 补 `--package '$TMP'` 等包名 |
| `CONFIG_ERROR` / `AUTH_ERROR` / `TLS_ERROR` / `SAP_ERROR` | 3 / 5 / 4 / 6 | 未绑定 profile、凭据失效、证书问题、SAP 不可达（SCHEMA 只声明 `USAGE`，这些来自共享客户端分类） | `abap doctor` / `abap profile test` 排查 |

## 真机证据

- **未验证**：本页没有记录 `abap list` 在 A4H 或 S/4HANA 上的端到端输出。
- `*` 通配作为 "列出某类型全部对象" 的 ADT quickSearch 用法，在 vhcala4hci（A4H）验证过（见 `src/abap_cli/flows/data/list.ts` 注释）；包过滤与截断行为未在真机单独验证。

# More

## gotcha

- **`--limit` 上限就是 20**：`clampLimit` 把大于 20 的值夹回 20；传 `--limit 50` 实际仍只取 20 条。
- **包过滤在客户端**：先取 quickSearch 前 N 条（N ≤ 20）再按包名过滤，所以包内对象可能被截断漏掉，甚至返回 0 条——人类输出的 "No objects in package X" **不代表包是空的**。`truncated: true` 只表示 quickSearch 命中达到上限。
- **完整审计用 `select`**：需要可靠地列全某个包的对象时，用 `abap select --table TADIR --where "DEVCLASS = '<pkg>'" --fields OBJECT,OBJ_NAME`（服务端过滤）。
- **不返回作者 / 责任人**：ADT quickSearch 不带 TADIR 的作者字段；按作者审计同样走 `abap select --table TADIR`。
- **`--type` 只转大写**：不做别名映射，必须是 ADT 类型码（如 `CLAS`，不是 `CLASS`）。

# references

- 实现：`src/abap_cli/commands/list.ts`、`src/abap_cli/flows/data/list.ts`
- 生成参数表：[docs/commands.md](../../docs/commands.md)；`--json` 契约：[agent-integration.md](../../docs/agent-integration.md)
- 所属 skill：[skills/abap-cli-edit/SKILL.md](../../skills/abap-cli-edit/SKILL.md)
