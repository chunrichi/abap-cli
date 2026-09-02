---
type: command
title: abap inspect
description: 只读探测 SAP 对象元数据 — structure / includes / locks / activation / package，不获取锁、不修改 SAP
tags: [abap-cli, command, inspect, metadata, read-only, agent-loop]
created at: 2026-08-09 22:40:00
changed at: 2026-09-02 23:10:19
---

# abap inspect

只读探测 SAP 对象元数据，**不获取锁、不修改 SAP**。给 agent 一个稳定的"对象是什么样 / 现在状态如何"探针——是 `abap-object` skill 决策树的关键工具。

## Usage

```bash
abap inspect <object> [--structure] [--includes] [--locks] [--activation] [--package]
abap inspect ZCL_FOO --structure --json
abap inspect ZCL_FOO --activation --json    # 诊断 stale 激活
abap inspect ZCL_FOO --locks --json         # 谁锁着 / 绑定到哪个请求
```

## Options

| flag | 含义 |
|---|---|
| `--structure` | 含结构元素（methods / attributes / events） |
| `--includes` | 含 class include parts 列表 |
| `--locks` | 含锁 / transport 归属（只读） |
| `--package` | 含对象包名 |
| `--activation` | 校验 active vs latest source per part（只读；检测 stale 激活） |
| `--type <type>` | 对象类型消歧（CLAS / PROG / INTF 等） |
| `--schema` | 打印本命令参数 schema（unified envelope，无 SAP 调用） |

无 flag 时返回对象基础元数据；`--activation` 是最常用的诊断 flag。

## --activation（核心诊断）

逐 part 对比 active 源码 vs latest（inactive）源码，输出 `{ ok, parts: [...] }`：

> **仅对 ADT structure 暴露 include parts 的对象生效**（CLAS / INTF / PROG 等）。
> 对象没有 include parts（如 FUGR）时不输出 `activation` 键——`data` 只有
> `metadata`，退出码仍为 0。Agent 必须把缺失的 `activation` 视为「该对象类型不
> 适用」，而非错误；FUGR 这类对象的激活/收敛用 `abap status` / `abap diff` 验证。

- `ok: true` — 每个 part 的 active = latest（没有 stale）
- `ok: false` — 有 part 未激活或不一致

每 part 结构：

```jsonc
{
  "includeType": "main" | "definitions" | "implementations" | "testclasses" | "...",
  "sourceUri": "/sap/bc/adt/oo/classes/zcl_foo/source/main",
  "active": true | false
}
```

## 使用场景

- **推送后激活验证**：`push` 报 `activated` 但 `inspect --activation` 仍报 `ok: false` → method/OSI 层级没激活（013 dogfooding）→ 用 `abap activate <obj> --yes` 修复
- **锁归属诊断**：`push` 报 `LOCK_FAILED` 时，`inspect --locks` 看谁持有 + 该对象绑定到哪个 transport
- **包与对象关系**：选 `--package` 在批量 pull 前看每个对象的归属

## --json 输出信封

```jsonc
{
  "status": "success",
  "meta": { "command": "abap inspect", ... },
  "data": {
    "metadata": { "object": "ZCL_FOO", "type": "CLAS", "uri": "..." },
    "structure": { /* methods / attributes / events */ },
    "includes": ["main", "definitions", "implementations", "testclasses"],
    "locks": {
      "editor": "DEVUSER",
      "transport": "DEVK900123"
    },
    "package": "ZDEV",
    "activation": {
      "ok": false,
      "parts": [
        { "includeType": "main", "sourceUri": ".../source/main", "active": true },
        { "includeType": "implementations", "sourceUri": ".../source/implementations", "active": false }
      ]
    }
  }
}
```

`--activation.ok: false` 时 `data.parts[]` 列出未激活 part；恢复路径在 `nextSteps` 里直接给 `abap activate <obj> --yes`。

`activation` 键只在该对象 ADT structure 暴露 include parts 时出现（见上节）——
对没有 include parts 的对象（如 FUGR），即使传了 `--activation`，`data` 也只有
`metadata`、没有 `activation` 键。

## Examples

```bash
# 基础元数据
abap inspect ZCL_FOO --json

# 诊断 stale 激活
abap inspect ZCL_FOO --activation --json

# 查锁 / 归属
abap inspect ZCL_FOO --locks --json

# 查结构（methods / attrs）
abap inspect ZCL_FOO --structure --json

# 多个 flag 组合
abap inspect ZCL_FOO --includes --locks --package --json
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap inspect", "version": "0.2.0", ... },
  "data": {
    "metadata": { "object": "ZCL_FOO", "type": "CLAS", "uri": "/sap/bc/adt/oo/classes/zcl_foo" },
    "includes": ["main", "definitions", "implementations", "testclasses"],
    "package": "ZDEV",
    "activation": { "ok": true, "parts": [...] }
  }
}
```

## 关键错误码

| 错误 | 类别 / exit | 含义 | 恢复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | 对象不存在 | `abap search <name>` 校对 |
| `SAP_ERROR` | SAP_ERROR / 6 | ADT 元数据查询失败 | `abap doctor` 诊断 ADT 探针 |

## 关联命令

- **`abap activate`**：修复 `--activation.ok: false` 的 stale 状态
- **`abap push`**：`LOCK_FAILED` 时用 `--locks` 查持有者
- **`abap search`**：对象不存在时先 search 校对
- **`abap pull`**：拉对象的本地副本（需要 lock；inspect 是只读）

## references

- 用户文档：[docs/commands.md#abap-inspect](../../docs/commands.md#abap-inspect)
- 设计决策：见 wiki 顶层 `icf-interface-implementation` 历史回顾（设计文档不入 git）
- 修复脚本：直接走 `abap inspect <obj> --activation --json` + `abap activate <obj> --yes --json`（agent 可按 SKILL.md 错误恢复表按需现写）