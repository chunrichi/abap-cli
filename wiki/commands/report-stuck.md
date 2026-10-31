---
type: command
title: abap report-stuck
description: "把一次 agent 卡死记录成本地 JSON 报告（离线、不连 SAP / 网络），供事后 offline triage。"
tags: [abap-cli, command, report-stuck, meta, local, triage, feedback-loop]
created at: 2026-10-29 14:30:14
changed at: 2026-10-31 06:45:00
---

# abap report-stuck

把一次"卡死"记录成本地 JSON 报告，供事后 offline triage。它是**纯本地**命令：不连 SAP、不发网络请求、不需要 profile；只把 `goal` / `tried` / `where` 三个字段连同时间戳写进用户配置目录。

写入位置是 `~/.abap-cli/reports/<id>.json`，其中 `<id>` 形如 `STUCK-<UTC 时间戳>-<4 位随机>`。目录以 `0700`、文件以 `0600` 权限创建。写盘失败**不会让命令失败**：会降级成 `recorded: false`、id 带 `STUCK-DEGRADED-` 前缀，并在 `meta.warnings` 里给 `STUCK_REPORT_DEGRADED`。

## Usage

```bash
abap report-stuck --goal <text> --tried <text> --where <cmd> [--json]
abap report-stuck --schema --json
```

## Options

- `--goal <text>`: **必填**。agent 想完成什么（如 `"create ZCL_ORDER class"`）。
- `--tried <text>`: **必填**。已经尝试过什么（命令、次数、关键错误码）。
- `--where <cmd>`: **必填**。卡在哪条命令（如 `"abap push src/zcl_order.clas.abap"`）。
- `--schema`: 打印参数 schema 并退出，不产生任何 I/O。
- `--json` / `--pretty-json`: 全局输出模式，见 [agent-integration](../../docs/agent-integration.md)。

## 前置条件

- 无。不需要 SAP 连接、profile 或网络；只要求 `$HOME` 可写。
- 三个字段都是自由文本，建议写清命令、错误码、重试次数，方便事后聚类重复问题。

## Examples

```bash
# 记录一次卡死的 push（纯本地，离线可用）
abap report-stuck \
  --goal "push ZCL_DEMO" \
  --tried "retried 3x; syntax check OK; push 报 LOCK_FAILED" \
  --where "abap push src/zcl_demo.clas.abap --tr NDK900123 --yes" \
  --json

# 记录一次卡死的 deploy
abap report-stuck --goal "deploy ICF service" --tried "deploy --yes 两次均超时" --where "abap deploy --yes"

# 只读自省
abap report-stuck --schema --json
```

## Expected Output

成功（报告已落盘）：

```json
{
  "status": "success",
  "meta": { "command": "abap report-stuck", "version": "1.2.0", "timestamp": "2026-10-31T05:36:20.430Z", "durationMs": 6, "warnings": [] },
  "data": {
    "id": "STUCK-20261031T053620-7f3a",
    "recorded": true,
    "echo": { "goal": "push ZCL_DEMO", "tried": "retried 3x", "where": "abap push" }
  }
}
```

写盘降级（命令仍 exit 0，但 `recorded: false`；warning 在 `meta.warnings`）：

```json
{
  "status": "success",
  "meta": {
    "command": "abap report-stuck", "version": "1.2.0", "timestamp": "2026-10-31T05:37:02.901Z", "durationMs": 4,
    "warnings": [ { "code": "STUCK_REPORT_DEGRADED", "message": "Could not write stuck report to /home/user/.abap-cli/reports (STUCK-DEGRADED-20261031T053702-1b2c)." } ]
  },
  "data": { "id": "STUCK-DEGRADED-20261031T053702-1b2c", "recorded": false, "echo": { "goal": "push ZCL_DEMO", "tried": "retried 3x", "where": "abap push" } }
}
```

## 关键错误码

SCHEMA 未声明 `errors[]`；唯一会主动抛错的是参数校验：

| 错误码 | 类别 / exit | 触发场景 | 恢复 |
|---|---|---|---|
| `USAGE` | USAGE / 2 | 缺 `--goal` / `--tried` / `--where` 任一 | 三个都补齐，参考 `error.example` |

## 真机证据

- **未验证**：本页没有记录 `abap report-stuck` 的真实执行输出；纯本地写盘，不涉及 SAP。

# More

## gotcha

- **报告不在工作区**：落在 `~/.abap-cli/reports/`，同一用户的所有项目共享；triage 时去该目录按 `STUCK-*` 前缀找。
- **`recorded: false` 仍是 exit 0**：写盘失败只体现在 `data.recorded` 和 `meta.warnings`，agent 不能只看退出码。
- **报告不会自动上传**：要提交上游请直接建 GitHub issue（GitHub MCP / `gh issue create` / 预填 URL，默认仓库 `chunrichi/abap-cli`）；`report-stuck` 只负责本地留痕，CLI 已没有 `abap feedback` 命令。
- **不要写敏感信息**：`--goal` / `--tried` / `--where` 会明文落盘，密码、token 先脱敏。
- **`--report-stuck` 不是全局 flag**：顶层 CLI 只注册了 `--json` / `--pretty-json`；`dumps` 的 schema 曾误列该选项，已从 schema 移除。

# references

- 实现：`src/abap_cli/commands/report-stuck.ts`、`src/abap_cli/core/stuck-reports.ts`（`writeStuckReport` / 报告 id / 降级路径）
- 生成参数表：[docs/commands.md](../../docs/commands.md)；`--json` 契约：[agent-integration.md](../../docs/agent-integration.md)
- 所属 skill：[skills/abap-cli/SKILL.md](../../skills/abap-cli/SKILL.md)
