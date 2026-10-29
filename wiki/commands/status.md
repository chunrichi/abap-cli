---
type: command
title: abap status
description: 本地 vs SAP 同步状态 — 按 part 列出差异（local-only / remote-only / divergent / unchanged）；可选 --remote-only / --local-only / --all / --since / --limit
tags: [abap-cli, command, status, sync, diff, parts]
created at: 2026-08-28 00:00:00
changed at: 2026-10-30 01:14:53
---

# abap status

扫描工作区下的 `.abap` 文件，对照 SAP 端对象按 **part**（`main` / `testclasses` / `definitions` / `implementations` / `macros`）计算差异。只读，不获取锁，不修改 SAP。

扫描根为 `.abap.json::sourceDir`（配置了时，相对配置文件所在目录解析），否则为当前工作目录。不遵循 `<name>.<type>.abap|xml` 布局的杂散文件会被跳过；显式文件路径永不跳过。

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
| `part` | `main` / `testclasses` / `definitions` / `implementations` / `macros`；remote-only 条目固定为 `object` |
| `direction` | `local-only` / `remote-only` / `divergent` / `unchanged`（仅 `--all` 时出现） |
| `detail` | 本地文件路径（POSIX 相对路径，022 契约）；remote-only 条目没有该字段 |

`--remote-only` 时只含 `remote-only`；`--local-only` 时只含 `local-only`。

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

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap status", "version": "1.0.0", "timestamp": "2026-08-28T00:00:00.000Z", "durationMs": 1800, "warnings": [] },
  "data": {
    "changedParts": [
      { "object": "ZCL_DEMO", "part": "main", "direction": "divergent", "detail": "local file: src/clas/zcl_demo/zcl_demo.clas.abap" },
      { "object": "ZLOCAL_ONLY", "part": "main", "direction": "local-only", "detail": "local file: src/prog/zlocal_only/zlocal_only.prog.abap" },
      { "object": "ZREMOTE_ONLY", "part": "object", "direction": "remote-only" }
    ],
    "truncated": false,
    "checked": 2
  }
}
```

无差异（或 `--remote-only` / `--local-only` 过滤后为空）时 `data.changedParts` 被 token-efficient 清洗移除，`data` 只剩 `truncated` 与 `checked`：

```json
{
  "status": "success",
  "meta": { "command": "abap status", "version": "1.0.0", "timestamp": "2026-08-28T00:00:00.000Z", "durationMs": 900, "warnings": [] },
  "data": { "truncated": false, "checked": 5 }
}
```

## 与相邻命令的关系

- **`abap diff [file]`**：精细按 part 对比（本地 ↔ SAP 源码内容）；用 `status` 找差异集，再用 `diff` 看细节
- **`abap pull`**：拉 `remote-only` 同步到本地
- **`abap push`**：推 `local-only` 到 SAP
- 同步编排由 Agent 显式完成（无内置 `sync` 子命令）

## Error codes

| Code | Category / exit | Trigger |
|------|-----------------|---------|
| `INVALID_ARGUMENT` | USAGE / 2 | `--limit` 非正整数 |
| `SAP_ERROR` | SAP_ERROR / 6 | ADT `searchObject` / `getObjectSource` 失败 |
| `TLS_ERROR` / `AUTH_ERROR` | TLS_ERROR / 4 / AUTH_ERROR / 5 | 连接问题（先 `abap doctor`） |

# More

## fixme

- [ ] `--remote-only` 与 `--local-only` 同时给不会报 `INVALID_ARGUMENT`，而是顺序过滤得到空结果；与 Error codes 描述不一致
- [ ] `--since` 非法日期未做本地校验（`new Date()` 得到 `NaN`，比较恒 false 等于不过滤）；文档标称会报 `INVALID_ARGUMENT`

## todo

- [ ] `--format json|paths` — paths 仅输出 `data.changedParts[].detail` 行集合（agent token-efficient）
- [ ] 增量缓存（每次 `--since` 不重新扫整个工作区）
- [ ] 真机证据待补：`divergent` / `remote-only` 方向判定的 on-prem 回归记录

# references

- 实现: [src/abap_cli/commands/status.ts](../../src/abap_cli/commands/status.ts) · [src/abap_cli/flows/search/status.ts](../../src/abap_cli/flows/search/status.ts)（`computeChangedParts` / `runStatus`）
- 复用: `src/abap_cli/formats/file-resolver.ts`、`src/abap_cli/core/resolve.ts`、`src/abap_cli/core/local-targets.ts`
- 文档: [docs/commands.md](../../docs/commands.md)
- 相关命令页: [abap diff](diff.md)、[abap pull](pull.md)、[abap push](push.md)、[abap check](check.md)
- 设计：见 wiki 顶层 `pull-push-check-loop` 历史回顾（设计文档不入 git，详见仓库 wiki）
- 测试: `test/unit/status-changedparts.test.ts`
