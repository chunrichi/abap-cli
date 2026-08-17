---
type: command
title: abap diff
description: 本地↔SAP 对比 — per-part direction（same / local-only / remote-only / both-changed）+ bounded 行变化摘要，只读不锁
tags: [abap-cli, command, diff, compare, read-only, agent-loop]
created at: 2026-08-09 22:40:00
changed at: 2026-08-09 22:40:00
---

# abap diff

本地文件与 SAP 系统逐 part 对比。**只读**，**不获取锁**。给 agent 一个"哪些 part 改了什么 / 谁改得更新的"快照——是 `status` / `pull` / `push` 的安全前置（避免 silent overwrite）。

## Usage

```bash
abap diff [options] [file]
abap diff src/zcl_foo/zcl_foo.clas.abap
abap diff --all
abap diff --remote PRD
abap diff --local-only --limit 50
```

无文件参数时遍历当前目录下所有 `.abap` 文件（遵循 `.abapignore`）。

## Options

| flag | 含义 |
|---|---|
| `--all` | 含未变 part |
| `--remote <id>` | 与远程系统（Version Management）active 版本对比 |
| `--local-only` | 仅本地独有的差异 |
| `--limit <n>` | 单次返回 part 数上限（默认 20）；超过时 `truncated: true` |
| `--json` | 全局 — 输出 012 统一信封 |

`--local-only` / `--remote-only`（仅 SAP 独有）二选一。

## per-part direction

每个 part 给出方向：

| direction | 含义 |
|---|---|
| `same` | 本地与 SAP 完全一致 |
| `local-only` | 本地有，SAP 没有（`local mtime > remote` 或本地独有） |
| `remote-only` | SAP 有，本地没有（SAP 端更新） |
| `both-changed` | 两边都改了——**冲突**，需 agent 决策 |

`both-changed` 时本地文件**不会**被覆盖；agent 必须显式选 `pull` / `edit` / `merge`。

## --json 输出信封

```jsonc
{
  "status": "success",
  "meta": { "command": "abap diff", ... },
  "data": {
    "results": [
      {
        "object": "ZCL_FOO",
        "file": "src/zcl_foo/zcl_foo.clas.abap",
        "parts": [
          {
            "part": "main",
            "direction": "same",
            "localHash": "abc123",
            "remoteHash": "abc123"
          },
          {
            "part": "implementations",
            "direction": "both-changed",
            "summary": { "added": 12, "removed": 3, "changed": 5 }
          }
        ]
      }
    ],
    "truncated": false,
    "limit": 20
  }
}
```

`summary`（仅 `direction != same` 时存在）：

- `added`: 新增行数
- `removed`: 删除行数
- `changed`: 修改行数

## 与 `status` 的关系

`status` 是粗粒度（只列 changed parts）；`diff` 是细粒度（per-part direction + 行变化）。两者**不重复**：

- `status`：CI 友好，看"哪些对象需要 attention"
- `diff`：决策前要看，看"具体冲突是什么"

## 远程对比（`--remote`）

与远程系统 active（00000）版本对比——**只**比较 active，不看 workspace 状态：

```bash
abap diff ZCL_FOO --remote PRD
# data.results[].parts[].remoteHash 是 PRD 系统的 active 版本
```

走 ICF `/version-source` 端点，类型映射与 `pull --remote` 一致（PROG→REPS、INTF→INTF、CLAS→CLSD）。

## Examples

```bash
# 对比一个类
abap diff src/zcl_foo/zcl_foo.clas.abap --json

# 全部 .abap（含未变 part）
abap diff --all --json

# 仅本地独有
abap diff --local-only --limit 10 --json

# 与 PRD 对比
abap diff src/zcl_foo/zcl_foo.clas.abap --remote PRD --json
```

## Expected Output

```json
{
  "status": "success",
  "data": {
    "results": [
      {
        "object": "ZCL_FOO",
        "file": "src/zcl_foo/zcl_foo.clas.abap",
        "parts": [
          { "part": "main", "direction": "same" },
          { "part": "implementations", "direction": "both-changed",
            "summary": { "added": 8, "removed": 2, "changed": 4 } }
        ]
      }
    ],
    "truncated": false
  }
}
```

## 关键错误码

| 错误 | 类别 / exit | 含义 | 恢复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | 文件路径解析不到 SAP 对象 | `abap search <name>` 校对 |
| `FILE_NOT_FOUND` | USAGE / 2 | 本地文件不存在 | 确认路径 |
| `VERSION_DESTINATION_INVALID` | USAGE / 2 | `--remote` 系统 ID 非法 | 改成合法 system-id |

## 关联命令

- **`abap status`**：粗粒度差异（changed parts 列表）；先 status 再 diff 看冲突
- **`abap pull`**：把 `remote-only` / `local-only` 拉下来同步（`sync` 已随 021 移除，编排由 Agent 显式完成）
- **`abap push`**：把 `local-only` 推上去

## references

- 用户文档：[docs/commands.md#abap-diff](../../docs/commands.md#abap-diff)
- 设计决策：[specs/004-pull-push-check-loop/spec.md](../../specs/004-pull-push-check-loop/spec.md)
- 同步工作流：[skills/abap-edit/SKILL.md](../../skills/abap-edit/SKILL.md)（决策树）