---
type: command
title: abap init
description: 初始化工作区 — 绑定 profile（写 .abap.json）与/或脚手架 AI agent 上下文（--agent）；裸 abap init 进入交互向导
tags: [abap-cli, command, init, workspace, profile, agent]
created at: 2026-08-17 00:00:00
changed at: 2026-08-17 00:00:00
---

# abap init

初始化工作区（021 — 替代原 `abap config`，`--system` 更名 `--profile`，并新增 `--agent` 脚手架）。职责：把 workspace 绑定到已有全局 profile、设置默认 tr/package、以及（可选）把 agent 上下文文件脚手架进当前目录。

## Usage

```bash
abap init --profile <name> [--tr <transport>] [--package <pkg>] [--yes]   # 参数形式
abap init                                                                  # 交互向导（TTY）
abap init --agent copilot|claude|cursor|generic [--force]                  # 仅脚手架 agent 上下文
```

## Options

- `--profile <name>`: 引用已有全局 profile（`abap profile add` 创建）；非交互模式不创建 profile
- `--url <url>` / `-c, --client <n>` / `-u, --username <u>` / `-p, --password <pwd>` / `-l, --language <lang>` / `--insecure` / `--ca <pem>`: 直连参数（仅 TTY 向导内使用；脚本里先 `abap profile add`）
- `--tr <transport>` / `--package <pkg>`: 默认 transport / 包（写入 `.abap.json`）
- `--test-connection` / `--test-tls` / `--test-auth`: 分层探针（探针失败 → 结构化错误）
- `--agent <target>`: 脚手架 agent 上下文（见下表；幂等，已存在文件跳过）
- `--force`: `--agent` 时覆盖已存在文件
- `--yes` / `--non-interactive`: 非交互确认（aliases）

## 行为规则

- **非 TTY 裸 `abap init`**（无任何 flag）→ `USAGE`（exit 2）——Agent-First：不挂起等输入
- **非交互 + 直连参数** → `VALIDATION_ERROR`（exit 7）：init 不创建 profile，提示 `abap profile add`
- **profile 不存在** → `NOT_FOUND`（exit 8）+ 提示 `abap profile add`
- **`--agent` 独立运行**：不碰 `.abap.json`，可对已初始化目录补装；非法值 → `USAGE`
- **已存在 `.abap.json`**：`--yes` 覆盖，否则 `FILE_EXISTS`（exit 3 类）
- **ICF 部署检查**（信息性，不阻断）：`data.icf` 四态 `not_deployed` / `current` / `outdated` / `unreachable`；`unreachable` 降级为 `meta.warnings` 条目

## Agent Scaffold Matrix

| 值 | 写入 |
|---|---|
| `generic`（所有值的基础） | `AGENTS.md` + `skills/`（跨厂商标准） |
| `copilot` | generic + `.github/copilot-instructions.md` |
| `claude` | generic + `CLAUDE.md` |
| `cursor` | generic + `.cursor/rules/abap.mdc` |

JSON 输出 `{ written: [...], skipped: [...] }`（token-efficient）。

## Examples

```bash
# 绑定已有 profile + 默认 tr/package
abap init --profile dev --tr DEVK900001 --package ZDEV --yes

# 交互向导
abap init

# 只补装 agent 上下文（幂等；已存在文件跳过）
abap init --agent copilot
abap init --agent copilot --force

# 切换 workspace 到另一 profile
abap init --profile qa --yes
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap init", "version": "0.1.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 512, "warnings": [] },
  "data": {
    "configPath": ".abap.json",
    "system": "dev",
    "sap": { "url": "https://sap:44300", "client": "100", "username": "DEV", "language": "EN" },
    "transport": "DEVK900001",
    "package": "ZDEV",
    "icf": { "status": "current", "expectedVersion": "0.4.0", "remoteVersion": "0.4.0" }
  }
}
```

`--agent` 单独运行：

```json
{
  "status": "success",
  "meta": { "command": "abap init --agent", "version": "0.1.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 90, "warnings": [] },
  "data": { "written": ["AGENTS.md", "skills/abap-setup/SKILL.md", ".github/copilot-instructions.md"], "skipped": ["skills/abap-edit/SKILL.md"] }
}
```

# More

## 关联命令

- [abap profile](profile.md) — 创建/管理全局 profile；`abap init --profile` 引用
- [abap doctor](doctor.md) — 本地环境诊断（与 init 的 ICF 检查互补）
- [abap extension deploy](extension.md) — `data.icf` 提示时部署 ICF 服务

## references

- 实现: [src/abap_cli/commands/init.ts](../../src/abap_cli/commands/init.ts) · [src/abap_cli/flows/init-flow.ts](../../src/abap_cli/flows/init-flow.ts) · [src/abap_cli/flows/init-agents.ts](../../src/abap_cli/flows/init-agents.ts)
- 文档: [docs/commands.md](../../docs/commands.md)
