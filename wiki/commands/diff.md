---
type: command
title: abap diff
description: 本地↔SAP 对比 — per-part direction（unchanged / divergent / local-only / remote-only）+ bounded 行变化摘要（added / removed / changedLines），只读不锁
tags: [abap-cli, command, diff, compare, read-only, agent-loop]
created at: 2026-08-09 22:40:00
changed at: 2026-10-30 01:14:53
---

# abap diff

本地文件与 SAP 系统逐 part 对比。**只读**，**不获取锁**。给 agent 一个"哪些 part 改了什么 / 谁改得更新的"快照——是 `status` / `pull` / `push` 的安全前置（避免 silent overwrite）。

## Usage

```bash
abap diff [options] [file]
abap diff src/clas/zcl_foo/zcl_foo.clas.abap
abap diff --all
abap diff --remote
abap diff --local-only --limit 50
```

无文件参数时遍历扫描根下所有 `.abap` 文件（遵循 `.abapignore`）——扫描根为 `.abap.json::sourceDir`（配置了时，相对配置文件所在目录解析），否则为当前工作目录。不遵循 `<name>.<type>.abap|xml` 布局的杂散文件会被跳过；显式 `diff <file>` 路径永不跳过。

`<file>` 必须是本地文件路径；传裸对象名会得到 `INVALID_ARGUMENT` 并提示先 `abap pull`。单文件 diff 不能与 `--all` / `--remote` / `--local-only` 组合。

## Options

| flag | 含义 |
|---|---|
| `--all` | 含未变 part |
| `--remote` | 仅 SAP 端独有（`remote-only`）的差异 |
| `--local-only` | 仅本地独有的差异 |
| `--limit <n>` | 单次返回 part 数上限（默认 20）；超过时 `truncated: true` |
| `--json` | 全局 — 输出 012 统一信封 |

`--remote` / `--local-only` 用于工作区级别的结果过滤。

## per-part direction

每个 part 给出方向：

| direction | 含义 |
|---|---|
| `unchanged` | 本地与 SAP 完全一致（仅 `--all` 时出现，无 `summary`） |
| `divergent` | 两侧源码不同（本地有未同步改动，或 SAP 端已更新） |
| `local-only` | 本地有，SAP 解析不到该对象（尚未 push） |
| `remote-only` | SAP 有，本地没有（SAP 端新增） |

`divergent` 表示两边都有改动，agent 必须显式决策（`pull` / 手动 merge）；diff 本身不写文件、不覆盖本地。

## 输出字段

```jsonc
{
  "status": "success",
  "meta": { "command": "abap diff", ... },
  "data": {
    "parts": [
      { "object": "ZCL_FOO", "part": "main", "direction": "divergent",
        "summary": { "added": 8, "removed": 2, "changedLines": [3, 7, 11] } },
      { "object": "ZPROG_NEW", "part": "main", "direction": "local-only",
        "summary": { "added": 12, "removed": 0 } },
      { "object": "ZREMOTE_NEW", "part": "object", "direction": "remote-only" }
    ],
    "truncated": false,
    "checked": 1
  }
}
```

`summary` 只在 `direction != unchanged` 时出现：

- `added`: 本地相对 SAP 新增的行数
- `removed`: SAP 有、本地没有的行数
- `changedLines`: 前 20 个本地差异行号（上限 `MAX_CHANGED_LINES`；无差异行时该键被空值清洗移除）

`checked` 是实际完成远端比较的本地文件数；`parts` 受 `--limit` 约束（默认 20），超出时 `truncated: true`。

## 与 `status` 的关系

`status` 是粗粒度（只列 changed parts）；`diff` 是细粒度（per-part direction + 行变化）。两者**不重复**：

- `status`：CI 友好，看"哪些对象需要 attention"
- `diff`：决策前要看，看"具体冲突是什么"

## `--remote`（仅 SAP 端独有）

`--remote` 是**结果过滤**：只保留 `direction: "remote-only"` 的对象（SAP 有、本地没有）。对比对象始终是当前连接的系统，不会读取另一套系统，也不做跨系统 active 版本内容对比。等价于 `abap status --remote-only` 的细粒度版本。

## Examples

```bash
# 对比一个类
abap diff src/clas/zcl_foo/zcl_foo.clas.abap --json

# 全部 .abap（含未变 part）
abap diff --all --json

# 仅本地独有
abap diff --local-only --limit 10 --json

# 仅 SAP 端独有（remote-only）
abap diff --remote --json
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap diff", "version": "1.0.0", "timestamp": "2026-09-02T00:00:00.000Z", "durationMs": 1500, "warnings": [] },
  "data": {
    "parts": [
      {
        "object": "ZCL_FOO",
        "part": "main",
        "direction": "divergent",
        "summary": { "added": 8, "removed": 2, "changedLines": [3, 7, 11] }
      },
      {
        "object": "ZPROG_NEW",
        "part": "main",
        "direction": "local-only",
        "summary": { "added": 12, "removed": 0 }
      },
      { "object": "ZREMOTE_NEW", "part": "object", "direction": "remote-only" }
    ],
    "truncated": false,
    "checked": 1
  }
}
```

无差异时 `data.parts` 为空数组、被 token-efficient 清洗移除，只剩 `truncated` 与 `checked`：

```json
{
  "status": "success",
  "meta": { "command": "abap diff", "version": "1.0.0", "timestamp": "2026-09-02T00:00:00.000Z", "durationMs": 420, "warnings": [] },
  "data": { "truncated": false, "checked": 5 }
}
```

## 关键错误码

| 错误 | 类别 / exit | 含义 | 恢复 |
|---|---|---|---|
| `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | 文件解析到的对象没有对应 source part | `abap search <name>` 校对；本地独有对象用 `create` / `push` 建 |
| `INVALID_ARGUMENT` | USAGE / 2 | 单文件参数与 `--all` / `--remote` / `--local-only` 混用，或传的是裸对象名 | 二选一：单文件 diff 或工作区 scoping |
| `FILE_PARSE_ERROR` | USAGE / 2 | 文件名无法解析出对象类型 / 文件读不出 | 确认 `<name>.<type>.abap` 布局，先 `abap pull` |

# More

## fixme

- [ ] `--limit` 未做整数校验：非数字会得到 `NaN` 并让 `slice(0, NaN)` 静默返回空 `parts`，应改为 `INVALID_ARGUMENT`
- [ ] `summary.changedLines` 只给前 20 个本地行号，没有 unified diff 文本；agent 要看具体差异内容仍需自己读两侧源码

## todo

- [ ] `--remote` 目前只是 remote-only 过滤；与另一套系统（如 PRD）active 版本的内容级对比尚未实现
- [ ] `--limit` 截断时不分页、无游标，大工作区只能反复调大 limit
- [ ] 真机证据待补：`--remote` / `--local-only` 过滤与 `divergent` 摘要的 on-prem 回归记录

# references

- 实现: [src/abap_cli/commands/diff.ts](../../src/abap_cli/commands/diff.ts) · [src/abap_cli/flows/search/diff.ts](../../src/abap_cli/flows/search/diff.ts)（`lineDiffSummary` / `computeDiff`）
- 复用: `src/abap_cli/flows/search/status.ts`（`computeChangedParts` 提供 changed parts 集合）、`src/abap_cli/core/resolve.ts`、`src/abap_cli/formats/file-resolver.ts`
- 文档: [docs/commands.md#abap-diff](../../docs/commands.md#abap-diff)
- 相关命令页: [abap status](status.md)、[abap pull](pull.md)、[abap push](push.md)
- 同步工作流: [skills/abap-cli-edit/SKILL.md](../../skills/abap-cli-edit/SKILL.md)（决策树）
