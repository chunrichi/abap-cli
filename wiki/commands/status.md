---
type: command
title: abap status
description: 本地 vs SAP 同步状态 — 按 part 列出差异（local-new / local-changed / remote-new / remote-changed / unchanged）；可选 --remote-only / --local-only / --all / --since / --limit
tags: [abap-cli, command, status, sync, diff, parts]
created at: 2026-08-28 00:00:00
changed at: 2026-08-28 00:00:00
---

# abap status

扫描工作区下的 `.abap` 文件，对照 SAP 端对象按 **part**（`main` / `testclasses` / `definitions` / `implementations` / `macros`）计算差异。只读，不获取锁，不修改 SAP。

## Usage

```bash
abap status [--remote-only] [--local-only] [--all] [--since <iso>] [--limit <n>] [--json]
abap status --schema                                    # 参数自省
```

## Options

- `--remote-only`: 只列出 SAP 端有 / 本地没有的对象
- `--local-only`: 只列出本地有 / SAP 端没有（或 SAP 端不可达）的对象
- `--all`: 包含 unchanged（默认仅列出 changed）
- `--since <iso-date>`: 仅纳入本地 mtime ≥ 该时间点的文件（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ss`）
- `--limit <n>`: 最大结果数（默认 `SEARCH_RESULT_LIMIT`，通常 20）
- `--schema`: 打印本命令参数 schema（unified envelope，无 SAP 调用）

## Output 字段

`data.changedParts[]` 每条：

| 字段 | 含义 |
|---|---|
| `object` | 对象名 |
| `type` | CLAS / PROG / INTF / FUGR ... |
| `part` | `main` / `testclasses` / `definitions` / `implementations` / `macros` |
| `direction` | `local-new` / `local-changed` / `remote-new` / `remote-changed` / `unchanged`（仅 `--all` 时出现） |
| `detail` | 路径或差异简述（POSIX 相对路径，022 契约） |

`--remote-only` 时只含 `remote-new` / `remote-changed`；`--local-only` 时只含 `local-new` / `local-changed`。两者同时给 → `INVALID_ARGUMENT`（exit 2）。

## Examples

```bash
# 全量扫差异
abap status

# 只看本地有改动要 push 的
abap status --local-only

# 只看 SAP 有新版本要 pull 的
abap status --remote-only

# 自上次同步以来改动
abap status --since 2026-08-01 --all

# Agent mode
abap status --json
```

## 与相邻命令的关系

- **`abap diff [file]`**：精细按 part 对比（本地 ↔ SAP 源码内容）；用 `status` 找差异集，再用 `diff` 看细节
- **`abap pull`**：拉 `remote-only` / `remote-changed` 同步到本地
- **`abap push`**：推 `local-only` / `local-changed` 到 SAP
- 同步编排由 Agent 显式完成（无内置 `sync` 子命令）

## Error codes

| Code | Category / exit | Trigger |
|------|-----------------|---------|
| `INVALID_ARGUMENT` | USAGE / 2 | `--remote-only` 与 `--local-only` 同时给 / `--limit` 非正整数 / `--since` 格式非法 |
| `SAP_ERROR` | SAP_ERROR / 6 | ADT searchObject 失败 |
| `TLS_ERROR` / `AUTH_ERROR` | TLS_ERROR / 4 / AUTH_ERROR / 5 | 连接问题（先 `abap doctor`） |

## More

### fixme

- [ ] (none)

### todo

- [ ] `--format json|paths` — paths 仅输出 `data.changedParts[].detail` 行集合（agent token-efficient）
- [ ] 增量缓存（每次 `--since` 不重新扫整个工作区）

## references

- 实现：`src/abap_cli/commands/status.ts`、`src/abap_cli/flows/status.ts`（`computeChangedParts`）
- 设计：见 wiki 顶层 `pull-push-check-loop` 历史回顾（设计文档不入 git，详见仓库 wiki）
- 配合：`wiki/commands/diff.md`（精细按 part 比对）
