---
type: command
title: abap init
description: 工作区唯一入口 — 绑定/修改/自省 .abap.json、脚手架 AI agent 上下文；裸 abap init 进入交互向导
tags: [abap-cli, command, init, workspace, profile, agent]
created at: 2026-08-17 00:00:00
changed at: 2026-08-20 00:00:00
---

# abap init

工作区的**唯一入口**。承担四类职责（首次绑定 / 修改字段 / 自省 / 脚手架），并整合了原 `abap config` 的"修改/自省"语义（026）。全局 profile 管理仍由 `abap profile` 负责。

| 模式 | 触发 | 是否写 `.abap.json` |
|---|---|---|
| 首次绑定 | `--profile <name>` （无 `.abap.json`） | 创建 |
| 修改字段 | `--profile/--tr/--package/--source-dir`（已有 `.abap.json`，merge） | 更新（不替换） |
| 自省 | `--show-config` | 否（只读） |
| 清空字段 | `--unset-package / --unset-tr / --unset-source-dir` | 是（删字段） |
| Agent 脚手架 | `--agent copilot/claude/cursor/generic` | 否（不碰 `.abap.json`） |

## Usage

```bash
# 首次绑定 / 修改（merge 不替换）
abap init --profile <name> [--tr <transport>] [--package <pkg>] [--source-dir <path>] [--yes]
abap init --tr DEVK900002 --package Z_OTHER --yes   # 只改 tr/package，其它字段不动

# 自省（只读，不连接 SAP）
abap init --show-config

# 清空单字段
abap init --unset-package --yes
abap init --unset-tr --unset-source-dir --yes

# 交互向导（TTY）
abap init

# 仅脚手架 agent 上下文
abap init --agent copilot|claude|cursor|generic [--force]
```

## Options

- `--profile <name>`: 引用已有全局 profile（`abap profile add` 创建）；非交互模式不创建 profile
- `--url <url>` / `-c, --client <n>` / `-u, --username <u>` / `-p, --password <pwd>` / `-l, --language <lang>` / `--insecure` / `--ca <pem>`: 直连参数（仅 TTY 向导内使用；脚本里先 `abap profile add`）
- `--tr <transport>` / `--package <pkg>` / `--source-dir <path>`: 默认 transport / 包 / 源目录（写入 `.abap.json`）
- `--show-config`: 打印当前 `.abap.json`（向上找最近的，git 边界停），只读
- `--unset-package` / `--unset-tr` / `--unset-source-dir`: 移除对应顶层 key；非 TTY 需 `--yes`
- `--test-connection` / `--test-tls` / `--test-auth`: 分层探针（探针失败 → 结构化错误）
- `--agent <target>`: 脚手架 agent 上下文（见下表；幂等，已存在文件跳过）
- `--force`: `--agent` 时覆盖已存在文件
- `--yes` / `--non-interactive`: 非交互确认（aliases）

## 行为规则

- **非 TTY 裸 `abap init`**（无任何 flag）→ `USAGE`（exit 2）——Agent-First：不挂起等输入
- **非交互 + 直连参数** → `VALIDATION_ERROR`（exit 7）：init 不创建 profile，提示 `abap profile add`
- **profile 不存在** → `NOT_FOUND`（exit 8）+ 提示 `abap profile add`
- **`--agent` 独立运行**：不碰 `.abap.json`，可对已初始化目录补装；非法值 → `USAGE`
- **`--show-config` 无 `.abap.json`** → `CONFIG_ERROR`（exit 4）+ 提示 `abap init --profile <name> --yes`
- **`--unset-*` 非 TTY 无 `--yes`** → `VALIDATION_ERROR`（exit 7）
- **`--unset-*` 无 `.abap.json`** → `CONFIG_ERROR`（exit 4）
- **已存在 `.abap.json` 的首次绑定**：merge 已有字段（用户传的字段覆盖，未传的保留）；`--yes` 跳过确认，否则 `FILE_EXISTS`（exit 3 类）
- **ICF 部署检查**（信息性，不阻断）：`data.icf` 四态 `not_deployed` / `current` / `outdated` / `unreachable`；`unreachable` 降级为 `meta.warnings` 条目

## Agent Scaffold Matrix

每个 vendor 写入**自己的 agent 框架约定的目录**，不再污染 workspace 根目录：

| 值 | 写入路径 |
|---|---|
| `copilot` | `.github/skills/<name>/` + `.github/agents/abap-developer.agent.md` |
| `claude`  | `.claude/skills/<name>/` + `.claude/agents/abap-developer.agent.md` + `CLAUDE.md` |
| `cursor`  | `.cursor/skills/<name>/` + `.cursor/agents/abap-developer.agent.md` + `.cursor/rules/abap.mdc` |
| `generic` | `.agents/skills/<name>/` + `.agents/agents/abap-developer.agent.md` |

**不写入** `AGENTS.md` / `copilot-instructions.md` / `skills/README.md`（仓库级文件，不属于用户 workspace 上下文）。`skills/README.md`（仓库分层边界说明）也被 init 排除。

JSON 输出 `{ written: [...], skipped: [...] }`（token-efficient）。

## Examples

```bash
# 绑定已有 profile + 默认 tr/package
abap init --profile dev --tr DEVK900001 --package ZDEV --yes

# 修改现有 workspace：只换 tr/package
abap init --tr DEVK900002 --package Z_NEW --yes

# 重新绑定到另一 profile
abap init --profile qa --yes

# 自省（不连接 SAP）
abap init --show-config

# 清除字段
abap init --unset-package --yes

# 交互向导
abap init

# 只补装 agent 上下文（幂等；已存在文件跳过）
abap init --agent copilot
abap init --agent copilot --force
```

## Expected Output

`abap init --profile dev --yes`：

```json
{
  "status": "success",
  "meta": { "command": "abap init", "version": "0.2.0", "timestamp": "2026-08-20T00:00:00.000Z", "durationMs": 512, "warnings": [] },
  "data": {
    "configPath": ".abap.json",
    "system": "dev",
    "sap": { "url": "https://sap:44300", "client": "100", "username": "DEV", "language": "EN" },
    "transport": "DEVK900001",
    "package": "ZDEV",
    "icf": { "status": "current", "expectedVersion": "0.5.0", "remoteVersion": "0.5.0" }
  }
}
```

`abap init --show-config`：

```json
{
  "status": "success",
  "meta": { "command": "abap init --show-config", "version": "0.2.0", "timestamp": "2026-08-20T00:00:00.000Z", "durationMs": 4, "warnings": [] },
  "data": { "configPath": ".abap.json", "system": "dev", "transport": "DEVK900001", "package": "ZDEV", "sourceDir": "./packages/core/src" }
}
```

`abap init --unset-package --yes`：

```json
{
  "status": "success",
  "meta": { "command": "abap init --unset-package", "version": "0.2.0", "timestamp": "2026-08-20T00:00:00.000Z", "durationMs": 6, "warnings": [] },
  "data": { "configPath": ".abap.json", "removed": ["package"], "missing": [] }
}
```

`--agent` 单独运行：

```json
{
  "status": "success",
  "meta": { "command": "abap init --agent", "version": "0.2.1", "timestamp": "2026-08-26T00:00:00.000Z", "durationMs": 86, "warnings": [] },
  "data": {
    "written": [
      ".claude/skills/abap-setup/SKILL.md",
      ".claude/skills/abap-object/SKILL.md",
      ".claude/agents/abap-developer.agent.md",
      "CLAUDE.md"
    ],
    "skipped": []
  }
}
```

> 路径相对 workspace 根；`AGENTS.md` / `copilot-instructions.md` / `skills/README.md` 都不会被写入。

# More

## 关联命令

- [abap profile](profile.md) — 创建/管理全局 profile；`abap init --profile` 引用
- [abap doctor](doctor.md) — 本地环境诊断（与 init 的 ICF 检查互补）
- [abap extension deploy](extension.md) — `data.icf` 提示时部署 ICF 服务

## references

- 实现: [src/abap_cli/commands/init.ts](../../src/abap_cli/commands/init.ts) · [src/abap_cli/flows/init-flow.ts](../../src/abap_cli/flows/init-flow.ts) · [src/abap_cli/flows/init-agents.ts](../../src/abap_cli/flows/init-agents.ts)
- 文档: [docs/commands.md](../../docs/commands.md)
