---
type: command
title: abap where-used
description: 只读查询对象的直接引用（where-used list）— 走 ADT usageReferences；agent 改动前的影响面评估
tags: [abap-cli, command, where-used, references, impact-analysis, adt, read-only, agent-loop]
created at: 2026-08-19 23:00:00
changed at: 2026-08-19 23:00:00
---

# abap where-used

SE80 / SE11 「Where-Used List」的 CLI 等价：给出**谁在引用这个对象**。这是 agent 在改类签名、删方法、改表字段**之前**评估影响面的关键工具——先知道有多少调用点、分布在哪些包，再决定改不改、怎么改。

严格只读：走 ADT `usageReferences` 端点，不获取锁、不修改 SAP。别名 `references`。

## Usage

```bash
abap where-used <object> [--type <type>] [--ref-type <type>] [--package <pkg>] [--limit <n>] [--json]
abap references <object> [...]          # 别名，等价
abap where-used --schema [--json]
```

## Options

- `<object>`（必填）: SAP 对象名。缺失 → `USAGE`（exit 2）。
- `--type <type>`: 目标对象类型消歧。当对象名在多个类型下都存在时必填（否则 `resolveObject` 报 `AMBIGUOUS_OBJECT`）。
- `--ref-type <type>`: **按引用方类型过滤**结果（如只看哪些程序引用了它）。
- `--package <pkg>`: 按引用方所属包过滤，**大小写不敏感**。
- `--limit <n>`: 返回引用数上限，整数 `[1, 500]`，默认 `100`。越界 / 非整数 → `INVALID_ARGUMENT`。
- `--schema`: 打印机器可读命令 schema 为 JSON 并 exit 0，**零 SAP 调用**。
- `--json`: 全局 flag——输出 012 统一 JSON 信封。

`--type` 与 `--ref-type` 支持的类型：`CLAS` / `INTF` / `PROG` / `FUGR` / `TABL`。传入其他类型 → `TYPE_NOT_SUPPORTED`。两者都接受带限定的 ADT 写法（`CLAS/OC` 会归一为 `CLAS`）。

## Examples

```bash
# 谁引用了这个类
abap where-used ZCL_MY_CLASS --type CLAS

# 只看程序类型的引用方，结构化输出
abap where-used ZCL_MY_CLASS --ref-type PROG --json

# 表的引用方中只看某个包的
abap where-used ZTAB_ORDER --type TABL --package ZFI_CORE

# 引用很多时先看总量，再放大 limit
abap where-used ZCL_UTIL --limit 500 --json
```

## Expected Output

成功信封：

```jsonc
{
  "status": "success",
  "meta": { "command": "abap where-used", "version": "0.2.0", "timestamp": "...", "durationMs": 180, "warnings": [] },
  "data": {
    "queryStatus": "found",
    "target": {
      "name": "ZCL_MY_CLASS",
      "type": "CLAS/OC",
      "uri": "/sap/bc/adt/oo/classes/zcl_my_class",
      "packageName": "ZPKG"
    },
    "references": [
      {
        "name": "ZCL_CALLER",
        "type": "CLAS/OC",
        "uri": "/sap/bc/adt/oo/classes/zcl_caller/source/main#start=42,8",
        "packageName": "ZPKG",
        "usageInformation": "Method CALL_IT"
      }
    ],
    "count": 1,
    "totalCount": 1,
    "limit": 100,
    "truncated": false
  }
}
```

人类模式（默认）：

```text
ZCL_MY_CLASS (CLAS/OC)
  uri: /sap/bc/adt/oo/classes/zcl_my_class
  package: ZPKG
References: 1 returned of 1
  ZCL_CALLER (CLAS/OC) [ZPKG] — Method CALL_IT
```

字段语义：

| 字段 | 含义 |
|---|---|
| `queryStatus` | `found` / `empty`——**过滤后**无引用即 `empty` |
| `count` / `totalCount` | 本次返回条数 / 过滤后总条数（`totalCount` 是判断影响面大小的依据） |
| `truncated` | `totalCount > count` 时为 `true`，此时附带 `nextSteps` 提示 |
| `references[].usageInformation` | 引用上下文（方法名等），ADT 提供时才有 |
| `references[].uri` | 带位置锚点的 ADT URI，可定位到具体行列 |

> **去重**：ADT 对同一引用会按每个使用点重复返回。CLI 按 `uri + usageInformation` 归一去重，因此 `totalCount` 是**去重且过滤后**的数量，通常小于 ADT 原始返回条数。

## 错误码

| 错码 | Category / exit | 触发 | 修复建议 |
|------|-----------------|------|----------|
| `USAGE` | USAGE / 2 | 未传对象名 | `abap where-used ZCL_MY_CLASS --type CLAS` |
| `INVALID_ARGUMENT` | USAGE / 2 | `--limit` 非整数或超出 `[1, 500]` | `--limit` 取 1–500 |
| `TYPE_NOT_SUPPORTED` | VALIDATION_ERROR / 7 | `--type`/`--ref-type` 不在支持集，或目标对象解析出的类型不受支持 | 用 CLAS / INTF / PROG / FUGR / TABL |
| `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | 对象在系统中不存在 | `abap search <name>` 校对名字 |
| `AMBIGUOUS_OBJECT` | NOT_FOUND / 8 | 同名对象存在于多个类型 | 加 `--type` 消歧 |

## v1 边界

- **仅直接引用**：不做递归/传递闭包（A→B→C 只给 A 的直接引用方）。
- 支持类型限 CLAS / INTF / PROG / FUGR / TABL；DTEL / DOMA / CDS 等延后。
- 不支持按对象内部位置（方法/行）细粒度查询——以整个对象为查询单位。
- 不返回引用代码片段（ADT `usageReferenceSnippets` 未接入）。
- 过滤在 CLI 侧完成：`--ref-type` / `--package` 是对 ADT 全量返回结果的后置过滤，因此 `--limit` 作用于过滤之后。

## 关联命令与流程

改动前的标准影响面评估闭环：

```bash
abap where-used ZCL_MY_CLASS --type CLAS --json   # 1. 有多少调用点
abap inspect ZCL_MY_CLASS --structure --json      # 2. 对象自身结构
abap pull ZCL_MY_CLASS --type CLAS                # 3. 拉下来改
abap check syntax --files ...                     # 4. 改完校验
```

- [tcode](tcode.md) — 从事务码定位到入口程序，再对该程序做影响分析
- [inspect](inspect.md) — 看对象自身结构（`where-used` 看外部引用，`inspect` 看内部构成）
- [search](search.md) — `OBJECT_NOT_FOUND` 时定位正确对象名
- [pull](pull.md) — 确认影响面后拉取源码

## 版本与服务依赖

- **CLI 版本**: 0.2.0（含 `where-used` 命令）。
- **依赖**: ADT 标准端点 `usageReferences`（`abap-adt-api`），**无需部署 ICF 扩展**。
