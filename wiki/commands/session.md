---
type: command
title: abap session
description: 查看 / 管理 SAP session cookie 复用状态 —— 会话 jar 路径、上次登录时间、cookie 数、CSRF 是否存在（只读，不发起 SAP 调用）
tags: [abap-cli, command, session, cookie, csrf, reuse, keychain, sap-sessionid, logout]
created at: 2026-09-03 00:00:00
changed at: 2026-09-03 00:00:00
---

# abap session

查看当前（或指定）profile 的 **session cookie jar** 状态。session jar 是 CLI 跨命令复用 SAP HTTP 会话的持久化文件：`~/.abap-cli/sessions/<system-hash>.json`，内容用 AES-256-GCM 加密（密钥存 OS keychain）。本命令**只读、不联网**。

## Usage

```bash
abap session info [--profile <name>] [--json]
```

## Options

- `--profile <name>`: 覆盖活动 profile（默认用 `.abap.json#system` 指向的 profile）。
- `--json`: 输出单条 JSON envelope（`{ status: 'success', data: {...} }`）。
- `--pretty-json`: 缩进 JSON（覆盖 `--json`）。

## Examples

```bash
abap session info --json
abap session info --profile vhcala4hci
```

## Expected Output

```json
{
  "status": "success",
  "data": {
    "policy": "reuse",
    "systemHash": "a1b2c3d4e5f60718",
    "jarPath": "/Users/<user>/.abap-cli/sessions/a1b2c3d4e5f60718.json",
    "keychainAccount": "abap-cli/session-key",
    "lastLoginAt": "2026-09-03T10:00:00.000Z",
    "cookieCount": 1,
    "csrfPresent": true
  }
}
```

## Session 复用机制

每次 `abap pull / push / search / select / ...` 会创建一个 ADT client。为避免在 SAP `User Sessions` 列表堆积会话：

1. **复用模式（默认）**：成功登录后把 `SAP_SESSIONID_<sid>_<client>` + CSRF token 加密写入
   `~/.abap-cli/sessions/<system-hash>.json`。下一次命令读取并注入 cookie，跳过 `login()` 往返。
2. **fresh login**：jar 不存在 / 解密失败 / SAP 返回 401 时自动回退到全新登录并覆盖 jar。
3. **`always-logout` 模式**：每条命令结束都调 `ADTClient.logout()`，不留会话。

### 配置字段 `.abap.json#sap.sessionPolicy`

| 值 | 行为 |
|----|------|
| `reuse`（默认） | 复用 jar；命令结束不 logout |
| `always-logout` | 命令结束 logout（SIGKILL 除外）；不写 jar |
| `default` | 等价 `reuse` |

环境变量 `ABAP_CLI_SESSION_POLICY=reuse|always-logout` 覆盖 `.abap.json`。

### 分桶

`<system-hash>` = `sha256(url|username|client).hex().slice(0, 16)`。URL / username / client 任一变化都会生成新 jar（旧 jar 成为 orphan，不主动清理）。

### Cloud / BTP

cloud / btp profile **不支持** cookie 复用：不读、不写、不删 jar。`abap doctor` 对该类 profile 输出 `SESSION_REUSE_UNSUPPORTED` warning（不阻断，exit 0）。

## Security

- jar 文件整体 AES-256-GCM 加密；32 字节对称密钥存 OS keychain（`service: abap-cli`, `account: abap-cli/session-key`）。
- keychain 不可用时退化为 PBKDF2-SHA256 派生密钥（从 `url|username|client`），stderr 每次 WARN。
- 不要将 `~/.abap-cli/sessions/` 拷贝到其他机器 / 提交到仓库。

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | 成功（含 jar 存在但不可读 —— 输出 null 字段） |
| `1`  | 读盘 / 解密以外的错误 |
| `2`  | `--schema` 前的 schema mismatch（不应发生） |

# More

## references

- [`wiki/commands/doctor.md`](doctor.md) —— doctor 的 `SESSION_REUSE_UNSUPPORTED` warning
- `.abap.json#sap.sessionPolicy` 配置说明见 [`docs/configuration.md`](../../docs/configuration.md)
