---
type: command
title: abap doctor
description: 诊断 CLI 环境 — 环境 / 配置 / 连接三段检查，支持安全可逆修复 --fix
tags: [abap-cli, command, doctor, diagnose, setup]
created at: 2026-08-06 23:10:00
changed at: 2026-08-06 23:10:00
---

# abap doctor

诊断 CLI 环境，分 `environment` / `config` / `connection` 三段报告检查项。**永不抛错**——发现的问题作为报告项呈现，并聚合 `nextSteps` 建议。始终返回退出码 0（诊断是只读操作）。

## Usage

```bash
abap doctor [--verbose] [--fix] [--yes] [--system <name>]
```

## Options

- `--verbose`: 包含细节（版本、路径、底层消息）
- `--fix`: 应用安全可逆的修复（非交互环境需 `--yes`）
- `--yes`: 无需提示确认 `--fix`
- `--system <name>`: 连接段只检查指定 profile
- `--schema`: 打印本命令参数 schema（unified envelope，本地调用）

## 检查项

### environment

- `env.node`: Node ≥ 18
- `env.tls`: OpenSSL 运行时存在
- `env.config`: `~/.abap-cli/systems.json` 可读可解析
- `env.deps`: keytar（OS keychain）可导入

### config

- `config.profile.<name>`: 每个 profile 字段校验
- `config.active`: `.abap.json` 引用的 system 是否存在
- `config.workspace`: 当前目录是否有 `.abap.json`（未初始化时 err 并提示 `abap init`）

### connection

- `conn.none`: 未配置任何系统
- `conn.<name>`: 每个 profile 的四层探测（tls/auth/adt/icf）

## Examples

```bash
# 常规体检
abap doctor

# 详细模式
abap doctor --verbose

# 应用安全修复（非交互需 --yes）
abap doctor --fix --yes

# 只检查指定 profile 的连接
abap doctor --system dev
```

## Expected Output

```json
{
  "status": "ok",
  "meta": { "command": "doctor", "version": "0.2.0", "timestamp": "2026-08-06T23:10:00.000Z", "durationMs": 18, "warnings": [] },
  "data": {
    "environment": [
      { "key": "env.node", "status": "ok", "message": "" },
      { "key": "env.tls", "status": "ok", "message": "" },
      { "key": "env.config", "status": "ok", "message": "" },
      { "key": "env.deps", "status": "ok", "message": "" }
    ],
    "config": [
      { "key": "config.profile.dev", "status": "ok", "message": "" },
      { "key": "config.active", "status": "ok", "message": "" },
      { "key": "config.workspace", "status": "ok", "message": "" }
    ],
    "connection": [
      { "key": "conn.dev", "status": "ok", "message": "" }
    ],
    "nextSteps": []
  }
}
```

`--fix` 时 `data` 追加 `fixesApplied` 数组（当前仅重建 `~/.abap-cli` 目录）。

# More

## fixme

- [ ] **C** — `doctor` 的 `config.workspace` 检查在未初始化目录下依赖 `.abap.json` 存在与否；015 后新增命令（`run`）属 SAP-scope，不参与 doctor 的本地段，但 `--help` 分组文案（"Local Commands"）在新增 local 命令时需同步（P2.9）。

## todo

- [ ] **`--fix --all` 分级修复** — roadmap 建议按"安全/需确认"分级；当前 `--fix` 只做安全可逆项，可扩展输出"修复前后 diff"。
- [ ] **015 wrapper 健康检查** — 增加 `ZCL_ABAP_VIBE_RUNNER` 部署/激活状态检查（类似 ICF 节点检查），在 `doctor` 的 connection 段提示 `abap extension deploy` 是否滞后。

# references

- 实现：`src/abap_cli/commands/doctor.ts`、`src/abap_cli/flows/doctor-checks.ts`
- 文档：`docs/commands.md`、`docs/configuration.md`
