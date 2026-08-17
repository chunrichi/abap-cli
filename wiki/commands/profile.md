---
type: command
title: abap profile
description: 管理全局连接 profile — add / list / show / set / test / delete / export / import；绑定工作区用 abap init --profile
tags: [abap-cli, command, profile, connection, keychain]
created at: 2026-08-17 00:00:00
changed at: 2026-08-17 00:00:00
---

# abap profile

管理全局连接 profiles（021 — 原 `abap connection` 更名；`use` 移除，绑定工作区由 `abap init --profile <name>` 承担）。存储：`~/.abap-cli/systems.json`（mode 0600）+ OS keychain（密码）。零数据迁移。

## Usage

```bash
abap profile <command> [args...]
```

## Subcommands

| 子命令 | 说明 |
|---|---|
| `list` | 列出所有 profile（name / username@url） |
| `show <name>` | 详情（无 secrets） |
| `add <name>` | 新建（`--url`+`--username` 必填；`--password` 写 keychain） |
| `set <name>` | 修改字段 / 密码（`--remove-password`、`--clear-ca`） |
| `test <name>` | 分层探测 tls → auth → adt → icf |
| `delete <name>` | 删除 profile + keychain 密码（非 TTY 需 `--yes`） |
| `export [names...]` | 导出便携 bundle（`--file`、`--with-passwords`） |
| `import <file>` | 导入 bundle（`--overwrite` 覆盖已有） |

## Options（add / set 共用）

- `--url <url>`: SAP 系统 URL
- `-c, --client <client>`: SAP 客户端号
- `-u, --username <user>`: SAP 用户名
- `-l, --language <lang>`: SAP 语言
- `-p, --password <password>`: 密码（写 keychain；add 时建议必给）
- `--insecure`: 跳过 SSL 证书校验（开发环境）
- `--ca <path>`: PEM CA 证书路径

`set` 额外支持：`--remove-password`（删 keychain 凭证）、`--clear-ca`（移除 CA 设置）。

## 行为规则

- **裸 `abap profile`** 打印子命令 help（exit 0）
- **`add` 已存在** → `CONFIG_ERROR`（exit 3），提示 `set` 或 `delete` 后重建
- **`add`/`set` 无字段选项 + 非 TTY** → `USAGE`（exit 2）
- **`set` 改密码**：`--password` 与 `--remove-password` 互斥 → `INVALID_ARGUMENT`
- **`test` 分层退出码**：最差层决定退出码（TLS→4、AUTH→5、ADT/ICF→6），但各层结果都返回（部分结果，非崩溃）
- **`delete` 非 TTY 无 `--yes`** → `VALIDATION_ERROR`（exit 7）
- **textpool 能力探测（014）**：add/set 时一次性非阻断探测 ADT text-elements 读写能力并缓存到 profile（`adtTextpool`）——textpool 操作据此选路由，无运行时回退
- **`use` 已移除**：绑定工作区用 `abap init --profile <name>`

## Examples

```bash
# 创建 + 绑定
abap profile add dev --url https://sap:44300 --username DEV --password '***'
abap init --profile dev --yes

# 改密码 / 探测
abap profile set dev --password '***'
abap profile test dev --json

# 迁移到另一台机器
abap profile export dev qa --file profiles.json
abap profile import profiles.json
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap profile add", "version": "0.1.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 210, "warnings": [] },
  "data": {
    "system": { "name": "dev", "url": "https://sap:44300", "client": "100", "username": "DEV", "language": "EN" },
    "passwordUpdated": true,
    "passwordRemoved": false
  }
}
```

`test` 输出四层结果：

```json
{
  "status": "success",
  "meta": { "command": "abap profile test", "version": "0.1.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 1500, "warnings": [] },
  "data": {
    "tls": { "ok": true },
    "auth": { "ok": true },
    "adt": { "ok": true },
    "icf": { "ok": false, "error": { "code": "SAP_ERROR", "message": "404" }, "nextSteps": ["Run: abap extension deploy"] }
  }
}
```

# More

## 关联命令

- [abap init](init.md) — 绑定 profile / 脚手架 agent 上下文
- [abap doctor](doctor.md) — 本地环境诊断（含 profile 可达性）
- [abap extension deploy](extension.md) — `test` 的 icf 层失败时部署 ICF 服务

## references

- 实现: [src/abap_cli/commands/profile.ts](../../src/abap_cli/commands/profile.ts) · [src/abap_cli/flows/profile-flow.ts](../../src/abap_cli/flows/profile-flow.ts)
- 文档: [docs/commands.md](../../docs/commands.md)
