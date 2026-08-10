---
type: command
title: abap sync
description: 链式 status / pull / push — 一条命令完成本地↔SAP 状态汇总与同步；CI 友好，divergent 双向改动永不静默覆盖
tags: [abap-cli, command, sync, workflow, ci, agent-loop]
created at: 2026-08-09 22:40:00
changed at: 2026-08-09 22:40:00
---

# abap sync

把 `status` / `pull` / `push` 串成一条命令——一次调用完成"看 → 拉 → 推"的同步循环。**divergent 双向改动永不静默覆盖**，冲突显式报 `VALIDATION_ERROR` 由 agent 决策。

## Usage

```bash
abap sync                # 默认 --status（只读）
abap sync --pull         # 拉 remote-only + divergent（需要 --yes 确认 divergent 覆盖本地）
abap sync --push         # 推 local-only（需要 --yes 确认 divergent 推上去）
abap sync --push --yes   # 显式确认 divergent
abap sync --dry-run      # 计划模式
```

`--status` / `--pull` / `--push` **互斥**，同时给 → `INVALID_ARGUMENT` (exit 2)。

## Options

| flag | 含义 |
|---|---|
| `--status`（默认） | 仅看本地↔SAP 状态（只读） |
| `--pull` | 拉 `remote-only` + divergent 改动到本地 |
| `--push` | 推 `local-only` + divergent 改动到 SAP |
| `--dry-run` | 计划模式 — 零变更 |
| `--yes` | 确认 divergent 覆盖 / 推送（写操作；非 TTY 必需） |
| `--json` | 全局 — 012 统一信封 |

## 冲突保护（核心）

`sync` 的关键不变量：**双向改动（`both-changed` / divergent）永不被静默覆盖**：

| 情况 | 行为 |
|---|---|
| 本地 = SAP | 跳过 |
| 仅本地改 | `--push` 自动推 |
| 仅 SAP 改 | `--pull` 自动拉 |
| 双向改（divergent） | `--pull` / `--push` **拒绝**（`VALIDATION_ERROR` / exit 7），除非 `--yes` |

`--yes` 时 divergent 走 `pull --overwrite` 或 `push --force` 路径；agent 显式确认后才生效。

## 写操作保护

`--pull` / `--push` 是写操作：

- **TTY**：无确认提示
- **非 TTY**：必须 `--yes` 或 `--dry-run`，否则 `VALIDATION_ERROR` (exit 7)

`--dry-run` 返回 `{ dryRun: true, ... }` 不调 SAP。

## --json 输出信封

```jsonc
{
  "status": "success",
  "meta": { "command": "abap sync", ... },
  "data": {
    "direction": "status" | "pull" | "push",
    "dryRun": false,
    "parts": [
      {
        "object": "ZCL_FOO",
        "part": "implementations",
        "direction": "local-only" | "remote-only" | "both-changed" | "same",
        "action": "pushed" | "pulled" | "conflict" | "skipped",
        "status": "ok" | "failed",
        "reason": "..."   // 仅 conflict / failed 时
      }
    ],
    "skipped": 3,
    "nextSteps": []    // 仅 failed / conflict 时非空
  }
}
```

`conflict` 与 `failed` 项在 `nextSteps` 里给出恢复路径（`abap diff` 看冲突 / `abap pull --overwrite` / `abap push --force`）。

## Examples

```bash
# 默认 status
abap sync --json

# 拉所有 remote-only
abap sync --pull --yes --json

# 推所有 local-only（无 divergent 时）
abap sync --push --yes --json

# 计划模式
abap sync --push --dry-run --json

# 完整闭环（看 + 拉 + 推）
abap sync --status --json
abap sync --pull --yes --json
abap sync --push --yes --json
```

## Expected Output

```json
{
  "status": "success",
  "data": {
    "direction": "status",
    "parts": [
      { "object": "ZCL_FOO", "part": "implementations",
        "direction": "both-changed", "action": "conflict" }
    ],
    "skipped": 0,
    "nextSteps": [
      "Divergent changes detected — run `abap diff` to review",
      "Resolve by `abap pull --overwrite` or `abap push --force` (then retry)"
    ]
  }
}
```

## 关键错误码

| 错误 | 类别 / exit | 含义 | 恢复 |
|---|---|---|---|
| `VALIDATION_ERROR` | VALIDATION_ERROR / 7 | divergent 冲突；非 TTY 缺 `--yes` | `abap diff` 看冲突 → 显式 `--yes` 确认 |
| `INVALID_ARGUMENT` | USAGE / 2 | `--status` / `--pull` / `--push` 同时给 | 只保留一个 |
| `NO_TRANSPORT` | VALIDATION_ERROR / 7 | `--push` 缺 transport | `abap transport create` 后重试 |

## 关联命令

- **`abap status`**：sync 的只读子集
- **`abap diff`**：sync 冲突时定位
- **`abap pull`** / **`abap push`**：sync `--pull` / `--push` 的底层
- **`abap doctor`**：sync 前诊断环境

## references

- 用户文档：[docs/commands.md#abap-sync](../../docs/commands.md#abap-sync)
- 设计决策：[specs/004-pull-push-check-loop/spec.md](../../specs/004-pull-push-check-loop/spec.md)
- 错误恢复表：[skills/abap-edit/SKILL.md](../../skills/abap-edit/SKILL.md)（决策树 + 错误恢复）