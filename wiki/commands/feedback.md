---
type: command
title: abap feedback
description: "把一条脱敏的 issue 从已完成的 agent session 提交到上游反馈服务（纯 HTTP，不连 SAP；默认 endpoint 是占位地址）。"
tags: [abap-cli, command, feedback, meta, http, agent-loop]
created at: 2026-10-29 14:30:14
changed at: 2026-10-31 13:24:09
---

# abap feedback

把一条**脱敏的 issue** 从已完成的 agent session 提交到上游反馈服务。它是纯 HTTP 命令：不读写 SAP、不要求 `.abap.json` 或 SAP profile，只要求网络可达反馈服务。请求体是扁平 JSON（`username` / `feature_key` / `title` / `description` / `priority` / 可选 `source_system`、`agent_id`、`session_id`），带 `Idempotency-Key`，可选 `X-Correlation-ID`。

> ⚠️ **默认 endpoint 是占位地址**（`feedback.example.com`）：开箱提交会因域名不可达失败。真正使用前要部署 bundled 的反馈 ICF 端点，并把 `src/abap_cli/clients/feedback-client.ts` 的 `FEEDBACK_ENDPOINT` 常量改成自己的地址后重建 CLI——没有 `--endpoint` 选项。离线校验用 `--dry-run`。

## Usage

```bash
abap feedback --feature-key <key> --title <text> --description <text> [options]
abap feedback --schema --json
```

## Options

- `--feature-key <key>`: **必填**，稳定 feature / 功能标识，最长 60 字符。
- `--title <text>`: **必填**，简短标题，最长 120 字符。
- `--description <text>`: **必填**，纯文本观察，最长 255 字符。
- `--priority <level>`: `LOW` / `NORMAL` / `HIGH` / `URGENT`，默认 `NORMAL`，大小写不敏感。
- `--username <name>`: 业务用户名（≤80）；省略时按 `$USERNAME` → `$USER` → OS 用户信息 → `git config user.name` 解析。
- `--email <address>`: 联系邮箱（≤241），必须同时含 `@` 和 `.`。
- `--source-system <name>` / `--agent-id <id>` / `--session-id <id>`: 调用方（默认 `abap-cli`，≤40）、agent 标识（≤60）、已完成 session 标识（≤100）。
- `--idempotency-key <key>`: 稳定重试 key（≤64）；省略时由 payload 的 sha256 生成（`abap-feedback-<前 47 位>`）。
- `--correlation-id <id>`: 追踪 ID（≤64），作为 `X-Correlation-ID` 发送。
- `--dry-run`: 只做本地校验并打印规范化后的请求，不联网。
- `--schema`: 打印参数 schema 并退出，不读配置、不联网。
- `--json` / `--pretty-json`: 全局输出模式，见 [agent-integration](../../docs/agent-integration.md)。

## 前置条件

- 网络可达反馈服务；**不需要** SAP 连接或 profile。
- 至少能解析出一个 username，否则报 `CONFIG_ERROR`（可用 `--username` 显式指定）。

## Examples

```bash
# 离线校验参数与最终请求体（推荐先跑）
abap feedback --feature-key abap.cli --title "Example" --description "Example feedback." --dry-run --json
# 从完成的 session 提交一条 issue
abap feedback --feature-key abap.push --title "Push reports an unclear error" \
  --description "A valid class push fails after syntax check with no actionable detail." \
  --priority NORMAL --session-id session-123 --json
```

## Expected Output

`--dry-run`（不联网；`payload` 是实际会发送的字段，`idempotencyKey` 由 payload 推导）：

```json
{
  "status": "success",
  "meta": { "command": "abap feedback", "version": "1.0.0", "timestamp": "2026-10-31T05:24:10.201Z", "durationMs": 38, "warnings": [] },
  "data": {
    "dryRun": true,
    "payload": { "username": "developer", "feature_key": "abap.push", "title": "Push reports an unclear error", "description": "A valid class push fails after syntax check with no actionable detail.", "priority": "NORMAL", "source_system": "abap-cli" },
    "idempotencyKey": "abap-feedback-9f2c1d7a4b3e5f608192a7c4d5e6f70819a2b3c4d5e6f70"
  }
}
```

真提交成功（`data.status` 是提交状态，与信封 `status` 无关；重复提交时为 `duplicate`）：

```json
{
  "status": "success",
  "meta": { "command": "abap feedback", "version": "1.0.0", "timestamp": "2026-10-31T05:25:02.844Z", "durationMs": 412, "warnings": [] },
  "data": { "status": "submitted", "id": "FB-2026-000123", "issueStatus": "NEW" }
}
```

## 关键错误码

| 错误码 | 类别 / exit | 触发场景 | 恢复 |
|---|---|---|---|
| `USAGE` | USAGE / 2 | 缺 `--feature-key` / `--title` / `--description`，或必填值为空 | 补齐必填项 |
| `INVALID_ARGUMENT` | USAGE / 2 | `--priority` 非法、`--email` 不含 `@`/`.`、任一字段超长、可选 flag 传空值 | 按上限压缩或改正取值 |
| `CONFIG_ERROR` | CONFIG_ERROR / 3 | 解析不出 username（SCHEMA `errors[]` 未列出，实际会出现） | 显式 `--username` |
| `VALIDATION_ERROR` | VALIDATION_ERROR / 7 | 反馈服务以 400 拒绝字段 | 看 `error.details`，修正字段 |
| `CONFLICT` | CONFLICT / 66 | 同一 `Idempotency-Key` 已用于**不同** payload（409） | 换 key，或修正 payload |
| `PERSISTENCE_ERROR` | PERSISTENCE_ERROR / 67 | 服务端 5xx / 无法落库 | 稍后重试；持续失败转 `report-stuck` |
| `HTTP_ERROR` | HTTP_ERROR / 68 | 请求到不了反馈服务（网络 / 其它 4xx） | 检查网络与 endpoint |
| `AUTH_ERROR` / `TLS_ERROR` | AUTH_ERROR / 5；TLS_ERROR / 4 | 服务 401/403；证书自签 / 过期 / 主机名不匹配 | 检查服务认证；修证书或换可信 endpoint |
| `SAP_ERROR` | SAP_ERROR / 6 | 服务返回非法 success 响应，或未映射的服务端错误码 | 看 `error.details.httpStatus` / `serviceCode` |

## 真机证据

- **未验证**：默认 endpoint 是占位地址，仓库内没有真实反馈服务的联调记录；username 回退链（`$USERNAME` / `$USER` / OS 用户 / git config）只有单元测试覆盖。

# More

## gotcha

- **幂等语义**：payload 相同 → 自动 key 相同 → 服务端返回 `duplicate` 并复用上次结果，不报错；要真正重发需改 payload 或换 `--idempotency-key`。
- **长度上限只在代码里**：`--title` ≤120、`--feature-key` ≤60、`--description` ≤255、`--username` ≤80；超长直接 `INVALID_ARGUMENT`，schema 表格未逐项标出。
- **不要提交凭据**：`description` / `title` 会明文发到网络，敏感信息先脱敏。

# references

- 实现：`src/abap_cli/commands/feedback.ts`、`src/abap_cli/flows/feedback-flow.ts`、`src/abap_cli/clients/feedback-client.ts`
- 生成参数表：[docs/commands.md](../../docs/commands.md)；`--json` 契约：[agent-integration.md](../../docs/agent-integration.md)
- 所属 skill：[skills/abap-cli/SKILL.md](../../skills/abap-cli/SKILL.md)
