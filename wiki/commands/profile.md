---
type: command
title: abap profile
description: 管理全局连接 profile — add / list / show / set / test / delete / export / import；绑定工作区用 abap init --profile。登录方式只有 basic auth
tags: [abap-cli, command, profile, connection, keychain]
created at: 2026-08-17 00:00:00
changed at: 2026-11-01 00:27:00
---

# abap profile

管理全局连接 profiles（021 — 原 `abap connection` 更名；`use` 移除，绑定工作区由 `abap init --profile <name>` 承担）。存储：`~/.abap-cli/systems.json`（mode 0600，含 `formatVersion`）+ OS keychain（密码）。零数据迁移。

登录方式只有 **basic auth**：SAP username + 密码（HTTP Basic），密码只存 OS keychain；`--ca` / `--insecure` 只影响 TLS 信任，不是独立认证方式。

## Usage

```bash
abap profile <command> [args...]
abap profile <command> --schema --json   # 子命令级机器契约
```

## Subcommands

| 子命令 | 说明 |
|---|---|
| `list` | 列出所有 profile（name / username@url / client / language / 工作区绑定标记 `current` / 缓存的 runtime tier；历史遗留 auth 会标注） |
| `show <name>` | 详情（无 secrets；历史遗留 auth 会带 `unsupportedAuth`） |
| `add <name>` | 新建（`--url`+`--username` 必填；`--password` 写 keychain）；**不连接、不验证**，输出 `verified:false` 与 `nextSteps` |
| `set <name>` | 修改字段 / 密码（`--remove-password`、`--clear-ca`）；也是历史 profile 的迁移入口 |
| `test <name>` | 分层探测 tls → auth → adt → icf |
| `delete <name>` | 删除 profile + keychain 密码 + 不再被引用的 CA 文件（非 TTY 需 `--yes`） |
| `export [names...]` | 导出便携 bundle（`--file`、`--with-passwords`） |
| `import <file>` | 导入 bundle（`--overwrite` 覆盖已有） |

## 输入校验（URL / profile 名）

- **profile 名**：`1–64` 字符，`[A-Za-z0-9_.-]`，首字符必须是字母或数字。名字同时是 `systems.json` 的键与 keychain account，非法字符在 `add` / `set` / `import` 阶段即被拒绝（`INVALID_ARGUMENT`）。
- **URL 归一化**：`--url` 只保留 `scheme://host[:port]`。用户从浏览器粘贴的 Fiori / WebGUI / 深链接会丢掉 path / query / fragment，并在 `meta.warnings` 给出 `URL_NORMALIZED`；URL 内嵌 `user:pass@` 一律拒绝。原因：ADT 客户端在 base URL 后拼接自己的 `/sap/bc/adt/...` 路径，带 path 的 base 必然 404。旧 profile 里已存的带 path URL 可通过 `abap profile set <name> --url <origin>` 修正。
- **交互向导与非交互 path 同一套校验**：向导落盘前调用同一 `assertValidProfile`，不会写出半成品 profile。

## 登录方式（basic auth）

| 项 | 说明 |
|---|---|
| 认证 | HTTP Basic：`--username` + OS keychain 中的密码 |
| 密码来源 | `profile add/set --password` 或首次 TTY 提示；`profile delete` 清理 keychain 条目 |
| TLS 信任 | `--ca <pem>`（导入 `~/.abap-cli/certificates/`）或 `--insecure`（仅开发环境） |
| 不支持的旧方式 | `cert`（mTLS/X.509）、`browser_sso`（cookie）、`oauth_password`（BTP UAA）、`sso`（Kerberos/SPNEGO）已全部移除 |

历史 profile 迁移：`~/.abap-cli/systems.json` 里仍声明旧 auth 的条目会以 basic 读取，并在 `list` / `show` 标注；连接类命令直接报 `CONFIG_ERROR` 并给出迁移步骤。任选其一完成迁移：

```bash
# 保留 profile：落一个密码即可（下次写入时旧 auth 字段被丢弃）
abap profile set <name> --password '<pwd>'

# 或重建
abap profile delete <name>
abap profile add <name> --url <url> --username <user> --password '<pwd>'
```

`profile export` bundle 版本为 3；旧 bundle 里带旧 auth 的条目在 `import` 时被拒绝并提示用 basic 重建。`import` 同样会归一化 URL、校验 profile 名。

## Options（add / set 共用）

- `--url <url>`: SAP 系统 URL（只保留 origin；带 path/query 会归一化并告警）
- `-c, --client <client>`: SAP 客户端号
- `-u, --username <user>`: SAP 用户名
- `-l, --language <lang>`: SAP 语言
- `-p, --password <password>`: 密码（写 keychain；add 时建议必给）
- `--insecure`: 跳过 SSL 证书校验（开发环境）
- `--ca <path>`: PEM CA 证书路径（被导入到 `~/.abap-cli/certificates/<sha256>.pem`，profile 只保留规范路径，详见下文）
- `--schema`: 子命令参数 schema（`abap profile <command> --schema --json`；parent 的 `abap profile --schema` 仍是扁平总览）

`set` 额外支持：`--remove-password`（删 keychain 凭证）、`--clear-ca`（移除 CA 设置）。

## 行为规则

- **裸 `abap profile`**（无子命令）是 `USAGE` 失败（exit 2）：`--json` 下 stdout 为空、stderr 单条错误信封（`error.details.help` 指向 `abap profile --help`）；human help 只在 `--help`
- **`add` 已存在** → `CONFIG_ERROR`（exit 3），提示 `set` 或 `delete` 后重建
- **`add`/`set` 无字段选项 + 非 TTY** → `USAGE`（exit 2）
- **`add` 不连接、不验证密码**：`data.verified: false` + `nextSteps`（`profile test` → `init --profile`）；连通性由 `profile test` 负责
- **`set` 改密码**：`--password` 与 `--remove-password` 互斥 → `INVALID_ARGUMENT`
- **`--ca` 与 `--clear-ca` 互斥** → `INVALID_ARGUMENT`；PEM 格式不对 / 源文件不存在 → `INVALID_ARGUMENT` / `CONFIG_ERROR`
- **历史 auth profile**：`show` 返回 `unsupportedAuth`；`test` 与所有连接类命令报 `CONFIG_ERROR` + 迁移 `nextSteps`（不会静默按 basic 连接）
- **`test` 分层退出码**：最差层决定退出码（TLS→4、AUTH→5、ADT/ICF→6），但各层结果都返回（部分结果，非崩溃）
- **`delete` 非 TTY 无 `--yes`** → `VALIDATION_ERROR`（exit 7）；`--json` 返回 `passwordCleaned` / `caOrphanRemoved`
- **textpool 能力探测**：由 `abap init` 针对**目标 profile** 一次性探测 ADT text-elements 读写能力并缓存（`adtTextpool`，落盘 `~/.abap-cli/systems.json`）——textpool 操作据此选路由，无运行时回退。探测未连上系统时**不落盘**（避免把网络故障固化成 read/write=false）。`adtTextpool.write: false` 表示写路由到 ICF `/textpool/*`，而该 POST 在无 ADT 写端点的 release 上是 stub（`TEXTPOOL_WRITE_UNSUPPORTED`，A4H 实测）；读不受影响。

- **ADT runtime cache（034）**：`profile test` 在 adt layer 成功时主动探测 ADT runtime tier + API capabilities 并缓存到 `systems[].runtime: { tier, icfSetupBlocked, source, apiCapabilities: { icf, httpService, steampunkMarkers? }, probedAt }`。`deploy` 优先读 cache，缺时再 `probeAdtRuntime`。`profile test --json` 本身不变（runtime 仍只在 adt 路径内部缓存）。
- **`use` 已移除**：绑定工作区用 `abap init --profile <name>`

## CA 证书生命周期（`--ca`）

`--ca` 触发"导入并绑定"：传入的文件被复制到 `~/.abap-cli/certificates/<sha256>.pem`（目录 0700、文件 0600，先建目录再写文件，写入走临时文件 + rename），profile 中只保存规范路径并额外记导入时间。后续 SAP 命令（`profile test`、doctor、push/pull）读这份规范路径；删掉源文件不会让 profile 失效。`profile show` 会额外显示 `ca sha256`（前 16 位）与 `ca imported`。`abap init` 建/改 profile 时走同一套逻辑。

- **幂等**：同一 PEM 从不同位置反复导入，hash 相同 → 不重写文件，时间戳保留首次导入；已指向 store 的路径直接复用。
- **格式限制**：必须是含 `-----BEGIN CERTIFICATE-----` 的 PEM；私钥等其他 PEM 一律拒绝（`INVALID_ARGUMENT`）。PKCS#12 / DER 需先转 PEM（`openssl pkcs12 -in a.p12 -nokeys -out a.ca.pem`）。
- **清理**：三种时机回收 store 文件 —— `profile delete <name>`、`profile set` 替换了 `--ca`、`--clear-ca`。回收前扫描所有 profile，sha256 仍被任何 profile 引用则保留；只有引用数归零才删。多 profile 共享同一份 PEM 时只删最后一个引用者。清理失败（例如 systems.json 不可读）不影响命令结果。
- **store 路径覆盖**：`ABAP_CLI_CERT_DIR` 环境变量可改写 store 根目录（默认 `~/.abap-cli/certificates/`）；该变量同时决定本进程信任的 CA 来源，CI / 容器里请指向受控目录。
- **回退**：profile 里旧版"绝对路径"形式的 `ca` 仍可读（直接 `fs.readFileSync`），但建议重新 `profile set <name> --ca <原路径>` 完成导入，让源文件移动不再影响后续连接。
- **导出/导入**：`profile export` 只导出 store 路径，不打包 PEM 内容，所以跨机器导入后仍需在目标机重新 `profile set --ca`。
- **诊断**：doctor 在 `tls` 失败 + profile 未配置 CA 时输出 `nextSteps: abap profile set <name> --ca <pem>`；store 文件丢失时 `readCaCertificate` 抛 `CONFIG_ERROR` 并同样提示。

## Examples

```bash
# 创建 + 绑定（basic auth）
abap profile add dev --url https://sap:44300 --username DEV --password '***'
abap init --profile dev --yes

# 自签 CA（导入 store，源文件之后可删）
abap profile set dev --ca ./sap-dev-ca.pem
abap profile test dev --json

# 历史 profile 迁移到 basic auth
abap profile show legacy --json          # data.system.unsupportedAuth = cert
abap profile set legacy --password '***'
abap profile test legacy --json

# 迁移到另一台机器
abap profile export dev qa --file profiles.json
abap profile import profiles.json
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap profile add", "version": "1.2.0", "timestamp": "2026-10-31T00:00:00.000Z", "durationMs": 210, "warnings": [] },
  "data": {
    "system": { "name": "dev", "url": "https://sap:44300", "client": "100", "username": "DEV", "language": "EN" },
    "passwordUpdated": true,
    "passwordRemoved": false,
    "verified": false,
    "nextSteps": ["abap profile test dev", "abap init --profile dev"]
  }
}
```

粘贴带 path 的 URL 时 `meta.warnings` 会多一条 `URL_NORMALIZED`（`url` 只保留 origin）。

`test` 输出四层结果：

```json
{
  "status": "success",
  "meta": { "command": "abap profile test", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 1500, "warnings": [] },
  "data": {
    "tls": { "ok": true },
    "auth": { "ok": true },
    "adt": { "ok": true },
    "icf": { "ok": false, "error": { "code": "SAP_ERROR", "message": "404" }, "nextSteps": ["Run: abap deploy"] }
  }
}
```

# More

## 关联命令

- [abap init](init.md) — 绑定 profile / 脚手架 agent 上下文
- [abap doctor](doctor.md) — 本地环境诊断（含 profile 可达性）
- [abap deploy](deploy.md) — `test` 的 icf 层失败时部署 ICF 服务

# references

- 实现: [src/abap_cli/commands/profile.ts](../../src/abap_cli/commands/profile.ts) · [src/abap_cli/flows/setup/profile.ts](../../src/abap_cli/flows/setup/profile.ts)
- 认证实现: [src/abap_cli/clients/basic-auth.ts](../../src/abap_cli/clients/basic-auth.ts)
- 配置与证书: `src/abap_cli/config/user-config.ts`、`src/abap_cli/config/secrets.ts`（keychain）、`src/abap_cli/config/ca-store.ts` + `src/abap_cli/config/profile-pems.ts`（CA store）
- 文档: [docs/commands.md](../../docs/commands.md)、[docs/configuration.md](../../docs/configuration.md)
- 相关命令页: [abap init](init.md)、[abap doctor](doctor.md)、[abap deploy](deploy.md)
