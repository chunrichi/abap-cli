---
type: command
title: abap doctor
description: 诊断 CLI 环境 — environment / config 两段检查，data.ok 布尔 gate、--strict 退出码、--fix 结构化修复摘要
tags: [abap-cli, command, doctor, diagnose, setup, gate, strict]
created at: 2026-08-06 23:10:00
changed at: 2026-11-01 00:25:00
---

# abap doctor

诊断 CLI 环境，分 `environment` / `config` 两段报告检查项。**永不因检查项失败而抛错**：发现的问题作为报告项呈现，并聚合 `nextSteps` 建议。默认始终退出码 0（只读诊断）；需要 CI / agent gate 时用 `--strict`。不探测 SAP（连接诊断走 `abap profile test <name>`）。

## Usage

```bash
abap doctor [--verbose] [--strict] [--fix [--yes]]
```

## Options

- `--verbose`: 包含细节（版本、路径、底层消息）
- `--strict`: `data.ok=false` 时返回 `CONFIG_ERROR`（exit 3），供 CI / agent 一键 gate
- `--fix`: 应用安全可逆的修复（非交互环境需 `--yes`）
- `--yes`: 无需提示确认 `--fix`
- `--schema`: 打印本命令参数 schema（unified envelope，本地调用）
- `--json` / `--pretty-json`: 全局输出开关（`--json` 紧凑，`--pretty-json` 缩进 2）

## Exit codes

| Code | 触发条件 |
|------|----------|
| `0` | 默认路径：报告已生成（即使 `data.ok=false`） |
| `3` | `--strict` 且 `data.ok=false` → `CONFIG_ERROR` |
| `7` | `--fix` 在非 TTY 且未带 `--yes` → `VALIDATION_ERROR`（写操作确认） |

## 检查项

### environment

- `env.node`: Node 为受支持且已修复安全漏洞的版本（22.23.4+ / 24.22.1+ / 26.12.1+）
- `env.tls`: OpenSSL 运行时存在
- `env.install`: 当前进程加载的 CLI 版本与安装布局（npm install / source checkout / linked checkout；纯诊断，永不失败）
- `env.config`: `~/.abap-cli/systems.json` 可读可解析
- `env.deps`: `ajv` / `ajv-formats` 可加载 + OS keychain 后端可用

### config

- `config.profile.<name>`: 每个 profile 字段校验
- `config.active`: `.abap.json` 引用的 system 是否存在
- `config.workspace`: 当前目录（或其祖先）是否有 `.abap.json`（未初始化时 err 并提示 `abap init`）

## Expected Output

成功信封（`data` 恒定包含 `ok` / `environment` / `config` / `nextSteps`）。`message: ""` 与空 `nextSteps` 按 token 约定省略：

```json
{
  "status": "success",
  "meta": { "command": "abap doctor", "version": "1.2.0", "timestamp": "2026-11-01T00:00:00.000Z", "durationMs": 18, "warnings": [] },
  "data": {
    "ok": false,
    "environment": [
      { "key": "env.node", "status": "ok" },
      { "key": "env.tls", "status": "ok" },
      { "key": "env.config", "status": "err", "message": "Config file not found: /home/u/.abap-cli/systems.json", "suggestion": "Run \"abap init\" (interactive wizard) to create the connection profile and .abap.json, or \"abap init --profile <name>\" to bind an existing profile." },
      { "key": "env.deps", "status": "ok" }
    ],
    "config": [
      { "key": "config.workspace", "status": "err", "message": "No workspace config (.abap.json) found in the current directory or any ancestor." }
    ],
    "nextSteps": ["Run \"abap init\" (interactive wizard) to create the connection profile and .abap.json, or \"abap init --profile <name>\" to bind an existing profile."]
  }
}
```

Agent 只需读 `data.ok` 一个布尔值判断环境是否可用（任何 environment / config 项 `err` → `false`）。`nextSteps` 按**修复动作**去重：`systems.json` 缺失与 `.abap.json` 缺失同属 `abap init` 家族，只出现一次。

`--fix --yes` 在 `data` 追加结构化修复摘要；`fixed` / `fixesApplied[]` / `remaining[]` 的字段存在性本身是契约（空数组不省略）：

```json
{
  "data": {
    "ok": false,
    "environment": [ { "key": "env.config", "status": "ok" } ],
    "config": [ { "key": "config.workspace", "status": "err", "message": "No workspace config (.abap.json) found in the current directory or any ancestor." } ],
    "nextSteps": ["Run \"abap init\" (interactive wizard) to create the connection profile and .abap.json, or \"abap init --profile <name>\" to bind an existing profile."],
    "fixed": 1,
    "fixesApplied": [
      { "id": "config-dir", "action": "Created the CLI config directory with 0700 permissions.", "target": "~/.abap-cli", "reversible": true }
    ],
    "remaining": [
      { "key": "config.workspace", "message": "No workspace config (.abap.json) found in the current directory or any ancestor.", "nextStep": "Run \"abap init\" (interactive wizard) to create the connection profile and .abap.json, or \"abap init --profile <name>\" to bind an existing profile." }
    ]
  }
}
```

无可修复项时 `fixesApplied: []` 与 `fixed: 0` 仍会出现（`remaining` 列出残留项）。

`--strict` 失败时错误信封（exit 3）：

```json
{
  "status": "error",
  "error": {
    "code": "CONFIG_ERROR",
    "category": "CONFIG_ERROR",
    "message": "Doctor found 2 blocking issue(s): env.config, config.workspace.",
    "details": { "ok": false, "issues": [ { "key": "env.config", "message": "..." }, { "key": "config.workspace", "message": "..." } ] },
    "nextSteps": ["Run \"abap init\" (interactive wizard) to create the connection profile and .abap.json, or \"abap init --profile <name>\" to bind an existing profile."]
  }
}
```

## Gotchas

- `data.ok` 描述**本次检查时**的状态：`--fix --yes` 会在修复后重新诊断，因此 `ok` / `remaining` 是修复后的真值；`fixed` 是本轮应用的修复数。
- `--strict` 与 `--fix` 可组合：修复后仍有 err 项才退出 3。
- `--fix` 的 `target` 是 home 锚定路径（`~/.abap-cli`），不是 cwd-relative；只有 workspace 内的路径才走 [path-output](path-output.md) 契约。
- doctor 不联网、不连 SAP：`env.deps` 的 keychain 探测只调本地后端；连接问题请用 `abap profile test`。

## Examples

```bash
# 常规体检
abap doctor

# 详细模式
abap doctor --verbose

# CI / agent gate：环境不可用即 exit 3
abap doctor --strict --json

# 应用安全修复并在修复后重新诊断
abap doctor --fix --yes
```

# More

## fixme

- [ ] `config.workspace` 在未初始化目录下依赖 `.abap.json` 存在与否；新增 local 命令时需同步 `--help` 的 Local Commands 分组文案。

## todo

- [ ] **`--fix --all` 分级修复** — roadmap 建议按"安全/需确认"分级；当前 `--fix` 只做安全可逆项，可扩展输出"修复前后 diff"。
- [ ] **wrapper 健康检查** — 增加 `ZCL_ABAP_VIBE_RUNNER` 部署/激活状态检查，作为独立 item 而不是插进 connection 探测。

# references

- 实现：`src/abap_cli/commands/doctor.ts`、`src/abap_cli/flows/setup/doctor-checks.ts`
- 输出契约：[docs/commands.md](../../docs/commands.md)、[path-output.md](path-output.md)
- 配置背景：[docs/configuration.md](../../docs/configuration.md)
