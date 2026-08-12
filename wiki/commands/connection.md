---
type: command
title: abap connection
description: 管理全局连接 profiles — 增删改查、切换工作区、分层测试、导入导出
tags: [abap-cli, command, connection, profile, setup]
created at: 2026-08-06 23:10:00
changed at: 2026-08-06 23:10:00
---

# abap connection

管理全局连接 profiles（存储于 `~/.abap-cli/systems.json`，密码存 OS keychain）。profile 由 `abap config --system <name>` 引用，写入工作区 `.abap.json`。裸 `abap connection` 打印帮助。

## Usage

```bash
abap connection list
abap connection show <name>
abap connection add <name> [--url <url>] [-c <client>] [-u <user>] [-l <lang>] [-p <pass>] [--insecure] [--ca <path>]
abap connection set <name> [--url <url>] [-c <client>] [-u <user>] [-l <lang>] [-p <pass>] [--remove-password] [--insecure] [--ca <path>] [--clear-ca]
abap connection use <name>
abap connection test <name>
abap connection delete <name> [--yes]
abap connection export [names...] [--file <path>] [--with-passwords]
abap connection import <file> [--overwrite]
```

## Subcommands

- `list`: 列出所有 profile（name / username / url）
- `show <name>`: 显示 profile 详情（密码只显示 `stored` / `not stored`）
- `add <name>`: 创建 profile；重名拒绝；无参数时 TTY 进入交互向导
- `set <name>`: 修改 profile；`--password` 与 `--remove-password`、`--ca` 与 `--clear-ca` 互斥
- `use <name>`: 把当前工作区 `.abap.json` 的 `system` 切到该 profile
- `test <name>`: 四层探测 `tls → auth → adt → icf`；退出码取最差层（TLS→4、AUTH→5、SAP→6）
- `delete <name>`: 删除 profile 及 keychain 密码；非交互环境必须 `--yes`
- `export [names...]`: 导出可移植 bundle（默认不含密码）；`--with-passwords` 为显式 opt-in（带警告）
- `import <file>`: 导入 bundle；默认**跳过**已存在的 profile，`--overwrite` 才更新

## Options

- `--url <url>`: SAP 系统 URL
- `-c, --client <client>`: SAP 客户端（默认 `100`）
- `-u, --username <user>`: SAP 用户名
- `-l, --language <lang>`: SAP 语言（默认 `EN`）
- `-p, --password <password>`: 密码（存入 keychain，不入 systems.json）
- `--insecure`: 跳过 SSL 证书校验
- `--ca <path>`: CA 证书路径（PEM）
- `--remove-password`: 移除 keychain 中的密码（仅 `set`）
- `--clear-ca`: 移除 CA 证书设置（仅 `set`）
- `--yes`: 跳过删除确认（非交互环境必需）
- `--file <path>`: export 写入文件（默认 stdout）
- `--with-passwords`: export 时包含密码（警告提示）
- `--overwrite`: import 时更新已存在的 profile

## Examples

```bash
# 创建 profile 并存入密码
abap connection add dev --url https://sap.example.com --username DEV --password secret --client 001

# 切换到该 profile 作为工作区
abap connection use dev

# 分层测试连接
abap connection test dev

# 非交互删除（需确认）
abap connection delete dev --yes

# 导出 / 导入（默认跳过已存在）
abap connection export dev --file profiles.json
abap connection import profiles.json --overwrite
```

## Expected Output

```json
{
  "status": "ok",
  "meta": { "command": "connection", "version": "0.1.0", "timestamp": "2026-08-06T23:10:00.000Z", "durationMs": 12, "warnings": [] },
  "data": {
    "deleted": "dev",
    "passwordCleaned": true
  }
}
```

`test` 子命令的 `data` 为四层探测结果（部分失败不崩溃，以非零退出码呈现）：

```json
{
  "status": "ok",
  "data": {
    "tls": { "ok": true },
    "auth": { "ok": true },
    "adt": { "ok": true },
    "icf": { "ok": true }
  }
}
```

# More

## fixme

- [ ] **C** — `connection import --overwrite` 语义：默认跳过已存在 profile，`--overwrite` 才更新；帮助/文档若残留"无条件覆盖"措辞需与实现对齐（014 已改，检查其余引用点）。

## todo

- [ ] **能力探测扩展（015 预留）** — 014 在 add/set 时探测并持久化 `adtTextpool`；015 的 `--method` 反射同样依赖"classrun 参数注入能力"，可在同一能力探测点增加 `classrunInput` 字段并持久化（避免每次运行 `WRAPPER_INPUT_UNAVAILABLE`）。
- [ ] **密码迁移路径** — keychain 不可用（无 GUI 会话）时的降级提示与重试策略，可与 `doctor --fix` 联动。

# references

- 实现：`src/abap_cli/commands/connection.ts`、`src/abap_cli/flows/connection-flow.ts`、`connection-profile.ts`、`src/abap_cli/config/profiles.ts`
- 文档：`docs/commands.md`、`docs/configuration.md`
