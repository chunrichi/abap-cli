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
| `login <name>` | 弹浏览器捕获 SSO cookie（BTP trial / SAML，026） |
| `test <name>` | 分层探测 tls → auth → adt → icf |
| `delete <name>` | 删除 profile + keychain 密码 + cert passphrase + cookie jar（非 TTY 需 `--yes`） |
| `export [names...]` | 导出便携 bundle（`--file`、`--with-passwords`） |
| `import <file>` | 导入 bundle（`--overwrite` 覆盖已有） |

## 登录方式（auth-method）

| 方式 | 使用场景 | 是否需浏览器 | 凭证存放 |
|---|---|---|---|
| `basic`（默认） | 标准 basic auth（on-prem, IAS 未启 SSO） | 否 | password 走 keychain |
| `cert` | mTLS / X.509 客户端证书 | 否 | cert/key path;passphrase 走 keychain |
| `browser_sso` | BTP trial / SAML SSO（手动粘 cookie） | 是（手动） | cookie 文件 0o600 |
| `oauth_password` | BTP trial / CF service-key + 用户 JWT（**免粘贴**） | 否 | service-key 在 profile JSON, password 走 keychain |

### oauth_password 设置（027）

```bash
# 1. 下载 service key JSON（从 BTP Cockpit → Service Marketplace → ABAP environment → Service Keys）
#    保存路径随意，例如: ~/Downloads/default_key.json

# 2. 注册 profile（service key 路径进 profile JSON, password 不存盘）
abap profile add btptrial \
  --url 'https://cb6549d4-2ebc-4106-94c5-35da55fca11f.abap.ap21.hana.ondemand.com' \
  --username 'your-sap-id@email' \
  --client 100 \
  --auth-method oauth_password \
  --service-key ~/Downloads/default_key.json

# 3. 存密码到 OS keychain（首次运行无密码时会 TTY 提示并自动写入）
abap profile set btptrial --password '...'

# 4. 所有 abap 命令直接走 Bearer JWT
abap profile test btptrial --json
abap search '*' --limit 5 --json
abap transport list --json
```

**安全说明**: 用户密码存 OS keychain（不进 profile JSON）。`profile delete` 会清理 keychain 密码。Service key JSON 存 `~/.abap-cli/systems.json`（同 systems.json 同一文件）。如需额外隔离用 `--clear-oauth-password`。

## Options（add / set 共用）

- `--url <url>`: SAP 系统 URL
- `-c, --client <client>`: SAP 客户端号
- `-u, --username <user>`: SAP 用户名
- `-l, --language <lang>`: SAP 语言
- `-p, --password <password>`: 密码（写 keychain；add 时建议必给）
- `--insecure`: 跳过 SSL 证书校验（开发环境）
- `--ca <path>`: PEM CA 证书路径
- `--auth-method <basic|cert|browser_sso>`: 登录方式（默认 `basic`）
- `--cert-path <pem>` / `--cert-key <pem>`: X.509 客户端证书 / 私钥 PEM（`auth-method=cert` 时必给）
- `--cert-ca <pem>`: 可选，覆盖 profile 级 CA，仅用于 mTLS 握手
- `--cert-passphrase <pwd>`: .p12 / 加密私钥口令；写入 OS keychain（独立 account）
- `--sso-cookie-file <path>`: SSO cookie jar 路径（`auth-method=browser_sso` 时可选，默认 `~/.abap-cli/<profile>.sso.cookies.json`，mode 0o600）
- `--auth-option <key=value>`: 通用认证字段（可重复）。新认证方法的字段从 bag 读，无需新增 Commander option。示例：`--auth-option certPath=/abs/cert.pem --auth-option keyPath=/abs/key.pem`。legacy flag（`--cert-path` / `--cert-key` / `--cert-ca` / `--sso-cookie-file` / `--service-key`）会自动映射进 bag（`--auth-option` 同名 key 优先）。

`set` 额外支持：`--remove-password`（删 keychain 凭证）、`--clear-ca`（移除 CA 设置）、`--remove-cert-passphrase`（删 keychain 中证书口令）、`--clear-cert-auth`（同时移除 `authMethod` 与 `certAuth`，回到 basic）、`--clear-sso-cookie-file`（重置 cookie 文件路径到默认）。

## 行为规则

- **裸 `abap profile`** 打印子命令 help（exit 0）
- **`add` 已存在** → `CONFIG_ERROR`（exit 3），提示 `set` 或 `delete` 后重建
- **`add`/`set` 无字段选项 + 非 TTY** → `USAGE`（exit 2）
- **`set` 改密码**：`--password` 与 `--remove-password` 互斥 → `INVALID_ARGUMENT`
- **`set` 改 cert-passphrase**：与 `--remove-cert-passphrase` 互斥 → `INVALID_ARGUMENT`
- **`auth-method=cert` 但缺 `cert-path` / `cert-key`** → `INVALID_ARGUMENT`（提示带可粘贴示例）
- **`test` 分层退出码**：最差层决定退出码（TLS→4、AUTH→5、ADT/ICF→6），但各层结果都返回（部分结果，非崩溃）
- **cert profile 缺证书文件**：`profile test` 在 tls 层先报 `CONFIG_ERROR`，不浪费一次对 SAP 的请求
- **cert profile 401/403**：错误 `nextSteps` 提示确认 `CERTRULE` / `STRUST` 映射，而不是"换密码"
- **browser_sso profile**：cookie 缺失/过期 → tls 层直接报 `AUTH_ERROR` + `nextSteps: 'abap profile login <name>'`；401/403 错误分流提示「cookies expired — run `abap profile login`」
- **`login <name>`**：起 127.0.0.1:<random> HTTP server（仅 loopback）+ 弹浏览器到 SAP discovery URL；用户在浏览器走 SAML/IAS 登录后把 `Cookie:` 头贴进 helper 页提交 → cookie jar 写盘 → 返回 `{cookieFile, capturedCookies, helperUrl, sapAuthUrl}`。TTL 30 分钟。
- **`delete` 非 TTY 无 `--yes`** → `VALIDATION_ERROR`（exit 7）；`--json` 返回 `passwordCleaned` / `certPassphraseCleaned` / `cookieJarCleaned`
- **textpool 能力探测（014）**：add/set 时一次性非阻断探测 ADT text-elements 读写能力并缓存到 profile（`adtTextpool`）——textpool 操作据此选路由，无运行时回退
- **ADT runtime cache（034）**：`profile test` 在 adt layer 成功时主动探测 ADT runtime tier + API capabilities 并缓存到 `systems[].runtime: { tier, icfSetupBlocked, source, apiCapabilities: { icf, httpService, steampunkMarkers? }, probedAt }`。`extension deploy` 优先读 cache，缺时再 `probeAdtRuntime`。trial 实测：cache 写入后 `extension deploy --dry-run` 直接命中，不重新探测 discovery。`profile test --json` 本身不变（runtime 仍只在 adt 路径内部缓存）。
- **`use` 已移除**：绑定工作区用 `abap init --profile <name>`

## Examples

```bash
# 创建 + 绑定（basic 仍是默认路径）
abap profile add dev --url https://sap:44300 --username DEV --password '***'
abap init --profile dev --yes

# X.509 客户端证书登录（不需要 username/password；SAP 端用 CERTRULE 映射证书 subject）
abap profile add trial --url https://vhcala4hci.dummy:44300 --username CERT_USER \
  --auth-method cert --cert-path /abs/client.pem --cert-key /abs/client.key.pem
abap profile set trial --cert-passphrase 'p12-pass'   # 仅 pkcs12 / 加密私钥需要
abap init --profile trial --yes
abap profile test trial --json  # authMethod=cert 出现在每层

# BTP ABAP trial（IAS-fronted SAML）— browser_sso 流
abap profile add btptrial --url https://cb6549d4-2ebc-4106-94c5-35da55fca11f.abap.ap21.hana.ondemand.com \
  --username <trial-user> --client 100 --auth-method browser_sso
abap profile login btptrial          # 弹浏览器 + helper 页;粘 Cookie 头并提交
abap init --profile btptrial --tr $TMP --yes
abap search '*' --limit 5 --json
abap profile test btptrial --json    # authMethod=browser_sso;30 分钟内有效

# 改回 basic + 探测
abap profile set trial --clear-cert-auth --password '***'
abap profile test dev --json

# 迁移到另一台机器
abap profile export dev qa --file profiles.json
abap profile import profiles.json
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap profile add", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 210, "warnings": [] },
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
  "meta": { "command": "abap profile test", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 1500, "warnings": [] },
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
