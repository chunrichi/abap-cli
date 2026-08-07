---
type: command
title: abap config
description: 配置工作区 — 从系统 profile 或完整连接参数写入 .abap.json；config init 为交互向导
tags: [abap-cli, command, config, setup, .abap.json]
created at: 2026-08-06 23:10:00
changed at: 2026-08-06 23:10:00
---

# abap config

配置工作区：把 `~/.abap-cli/systems.json` 中的系统 profile 引用写入当前目录的 `.abap.json`，或直接从完整连接参数创建 profile 并写入。`abap config init` 是仅有的交互向导入口（不接受任何 flags）；裸 `abap config` 打印帮助。

## Usage

```bash
# 参数化形式（写入 .abap.json）
abap config --system <name> [--tr <tr>] [--package <pkg>] [--test-connection] [--yes]
abap config --url <url> --username <user> --password <pass> [--client <c>] [--language <lang>] [--tr <tr>] [--package <pkg>]

# 交互向导（TTY）
abap config init

# 打印帮助
abap config
```

## Options

- `--system <name>`: 使用已有的系统 profile（用 `abap connection add` 创建）
- `--url <url>`: SAP 系统 URL（仅交互模式接受）
- `-c, --client <client>`: SAP 客户端
- `-u, --username <user>`: SAP 用户名
- `-p, --password <password>`: SAP 密码
- `-l, --language <language>`: SAP 语言
- `--insecure`: 跳过 SSL 证书校验（仅开发环境）
- `--ca <path>`: CA 证书路径（PEM）
- `--tr <transport>`: 默认传输请求号（写入 `.abap.json`）
- `--package <package>`: 默认包名（写入 `.abap.json`）
- `--test-connection`: 探测 TLS + 认证并报告（等价 `--test-tls --test-auth`）
- `--test-tls`: 探测 TLS 握手
- `--test-auth`: 探测认证（TLS 之后）
- `--yes` / `--non-interactive`: 跳过所有确认；`--yes` 时允许覆盖已存在的 `.abap.json`

## 行为规则

- **非交互 + 完整参数** → 拒绝，引导先用 `abap connection add` 建 profile
- **TTY + 完整参数** → 自动创建 profile 并写 `.abap.json`
- **`--system <name>`** → 引用已有 profile；密码取 keychain / `--password` / `SAP_PASSWORD`
- **`.abap.json` 已存在** → 默认拒绝（`FILE_EXISTS`）；`--yes` / `config init --yes` 覆盖
- probe（`--test-*`）在写文件**之前**执行，失败不留 `.abap.json`
- 附带信息性 ICF 部署检查（不阻塞；未部署提示 `abap deploy`）
- `config init` 接受任何 config flags 时报 `USAGE`（exit 2）

## Examples

```bash
# 使用已有 profile 并设置默认 transport 与包
abap config --system DEV --tr DEVK900001 --package Z_MY_PACKAGE

# CI / 非交互（profile 需已存在）
abap connection add CI --url https://... --username CI_USER --password ...
abap config --system CI --yes

# 完整参数 + 连接测试（TTY）
abap config --url https://sap.example.com --username USER --password PASS --test-connection

# 交互向导
abap config init
```

## Expected Output

```json
{
  "status": "ok",
  "meta": {
    "command": "config",
    "version": "0.7.0",
    "timestamp": "2026-08-06T23:10:00.000Z",
    "durationMs": 42,
    "warnings": []
  },
  "data": {
    "configPath": ".abap.json",
    "system": "DEV",
    "sap": { "url": "https://sap.example.com", "client": "001", "username": "USER", "language": "EN" },
    "transport": "DEVK900001",
    "package": "Z_MY_PACKAGE",
    "tls": { "ok": true },
    "auth": { "ok": true },
    "icf": { "status": "not_deployed" }
  }
}
```

# More

## fixme

- [ ] **C** — `config init` 交互向导在 TTY 探测依赖 `process.stdin.isTTY`；在管道/CI 包装场景（pty 层模拟 TTY）下可能误判为 TTY 而进入向导。应记录在案，必要时支持 `--non-interactive` 强制非交互。

## todo

- [ ] **ICF 部署检查增强** — `data.icf` 四态已就绪；可补充 `--check-only` 变体只做部署探测（当前伴随写入 `.abap.json` 后执行）。
- [ ] **profile 引用的密码回退** — `--system` 引用时密码按 keychain → `--password` → `SAP_PASSWORD` 顺序解析；可增加显式 `--use-env` 强制仅读环境变量（避免误读 keychain）。

# references

- 实现：`src/abap_cli/commands/config.ts`、`src/abap_cli/flows/config-flow.ts`、`config-write.ts`、`config-wizard.ts`
- 文档：`docs/commands.md`、`docs/configuration.md`
