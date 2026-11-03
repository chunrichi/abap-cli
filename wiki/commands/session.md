---
type: command
title: abap session
description: 查看 / 重置 SAP 会话存储 —— 实际生效的存储、候选目录、密钥来源、jar 的 cookie/CSRF/连续失败计数，以及复用是否启用及原因（只读，不发起 SAP 调用）
tags: [abap-cli, command, session, cookie, csrf, reuse, keychain, sap-sessionid, sap-contextid, logout, session-store]
created at: 2026-09-03 00:00:00
changed at: 2026-11-01 22:05:00
---

# abap session

查看或重置当前（或指定）profile 的 **SAP 会话存储**。CLI 是短生命周期进程：命令之间靠一个加密的 session jar 复用同一个 SAP HTTP 会话，避免每条命令在 SM04 留下一个会话。

会话存储不再固定在 `~/.abap-cli/sessions`：HOME 不可写（agent sandbox / CI）时会自动落到工作区内的 `<workspace>/.abap-cli/sessions`。`session info` 报告**当前进程实际会用的**存储与 jar 状态，`session reset` 删除持久化会话。

本命令**不发起 SAP 调用**。

## Usage

```bash
abap session info [--profile <name>] [--json]
abap session reset [--profile <name>] --yes [--json]
abap session --help                      # 唯一的 help 入口
```

裸 `abap session`（无子命令）是 `USAGE` 失败（exit 2）：`--json` 下 stdout 为空、stderr 单条错误信封（`error.details.help` 指向 `abap session --help`）。本命令在命令清单中标记为 `scope: local`。

## Options

- `--profile <name>`: 覆盖活动 profile（默认用 `.abap.json#system` 指向的 profile）。
- `--yes`: `session reset` 必填——重置会丢弃可复用的 SAP 会话；没有隐式确认。
- `--json`: 输出单条 JSON envelope（`{ status: 'success', data: {...} }`）。
- `--pretty-json`: 缩进 JSON（覆盖 `--json`）。

## Examples

```bash
abap session info --json
abap session info --profile vhcala4hci
abap session reset --yes
```

## Expected Output

`session info`：

```json
{
  "status": "success",
  "meta": { "command": "abap session info", "version": "2.4.0", "warnings": [] },
  "data": {
    "policy": "reuse",
    "policySource": "default",
    "systemHash": "a1b2c3d4e5f60718",
    "keyMode": "keychain",
    "keychainAccount": "abap-cli/session-key",
    "reuseEnabled": true,
    "reuseReason": null,
    "store": { "kind": "workspace", "path": "<workspace>/.abap-cli/sessions" },
    "candidates": [
      { "kind": "home", "path": "~/.abap-cli/sessions/<hash>.json", "status": "unwritable", "writable": false, "jarExists": false },
      { "kind": "workspace", "path": "<workspace>/.abap-cli/sessions/<hash>.json", "status": "ok", "writable": true, "jarExists": true, "cookieCount": 4, "lastLoginAt": "2026-11-01T03:00:00.000Z" }
    ],
    "jar": {
      "path": "<workspace>/.abap-cli/sessions/<hash>.json",
      "lastLoginAt": "2026-11-01T03:00:00.000Z",
      "cookieCount": 4,
      "csrfPresent": true,
      "stateful": true,
      "reuseFailures": 0,
      "blocked": false
    }
  }
}
```

- `store`：当前进程会写入的存储（最高优先级的可写候选）；`null` 表示没有可写存储（会退化为每条命令登录+登出）。
- `candidates`：全部候选（`env` → `home` → `workspace`），逐个给出是否可写、是否存在 jar、是否可解密。
- `jar`：`null` 表示没有可读 jar；`blocked: true` 表示连续被 SAP 拒绝后复用已暂停。
- `reuseReason`：`null`（正常复用）或 `cloud-btp` / `always-logout` / `key-store-ephemeral` / `no-durable-store` / `reuse-unstable` / `corrupt-jar`。

`session reset`：

```json
{
  "status": "success",
  "data": {
    "systemHash": "a1b2c3d4e5f60718",
    "removed": ["~/.abap-cli/sessions/a1b2c3d4e5f60718.json"],
    "storeCandidates": ["~/.abap-cli/sessions", "<workspace>/.abap-cli/sessions"]
  }
}
```

## 会话复用机制

1. **存储选择**（固定优先级，全部为 durable 路径）：
   - `ABAP_CLI_SESSION_DIR`（显式覆盖；agent/CI 需要固定位置时用）；
   - `~/.abap-cli/sessions`（开发机默认）；
   - `<workspace>/.abap-cli/sessions`（HOME 不可写时自动启用；目录内自带 `.gitignore`=`*`，0700/0600，加密）。
   `$TMPDIR` **不再是存储**：它无法证明下一条命令能读到 jar。
2. **会话身份成对保存**：jar 保存 stateful `SAP_SESSIONID_*` **及其 `sap-contextid`**。S/4HANA 会把「只带 session cookie、不带 context cookie」的 ADT 请求静默路由到一个新会话（HTTP 200、无报错）——这是此前 SM04 按命令数增长的根因。没有 stateful session cookie 时才丢弃 context cookie（stateless/降级路径，回放它会得到 `400 Session not found`）。
3. **可复用才保留**：命令结束只有在 jar 已写入 durable 存储、包含 stateful cookie、且未被连续拒绝时才保留会话；否则本轮登录的会话在命令结束时登出。`always-logout` 策略下每条命令都登出。
4. **自愈**：回放的会话被 SAP 拒绝（401/403/440）时允许一次重新登录+重试，并累计 `reuseFailures`；连续 2 次后复用暂停（`blocked`），后续命令按「登录+登出」运行，避免继续泄漏。暂停 10 分钟后自动重试一次，或 `abap session reset` 立即清除。
5. **可见性**：复用不可用/工作区回退/连续被拒/损坏 jar 都会出现在 `--json` 的 `meta.warnings`（`SESSION_REUSE_DISABLED` / `SESSION_STORE_FALLBACK` / `SESSION_REUSE_UNSTABLE` / `SESSION_JAR_CORRUPT`）。

### 配置字段 `.abap.json#sap.sessionPolicy`

| 值 | 行为 |
|----|------|
| `reuse`（默认） | 复用 jar；不可复用时命令结束登出 |
| `always-logout` | 命令结束 logout（SIGKILL 除外）；不写 jar |
| `default` | 等价 `reuse` |

环境变量 `ABAP_CLI_SESSION_POLICY=reuse|always-logout` 覆盖 `.abap.json`；`ABAP_CLI_SESSION_DIR` 覆盖存储目录；`ABAP_CLI_SESSION_KEY_MODE=derived` 强制使用 PBKDF2 派生密钥（测试/CI）。

### 分桶

`<system-hash>` = `sha256(url|username|client).hex().slice(0, 16)`。URL / username / client 任一变化都会生成新 jar（旧 jar 成为 orphan，用 `session reset` 清理）。

### Cloud / BTP

cloud / btp profile **不支持** cookie 复用：不读、不写、不删 jar；`session info` 输出 `reuseEnabled:false`、`reuseReason:"cloud-btp"`。`abap doctor` 对该类 profile 输出 `SESSION_REUSE_UNSUPPORTED` warning（不阻断，exit 0）。

## Security

- jar 文件整体 AES-256-GCM 加密；32 字节对称密钥存 OS keychain（`service: abap-cli`, `account: abap-cli/session-key`）。
- keychain 不可用时退化为 PBKDF2-SHA256 派生密钥（从 `url|username|client`），stderr 一次性 WARN，`session info` 报 `keyMode:derived`。
- session key 必须可持久化：`fixture` / `disabled` 这类只在内存里保存的测试后端不会写盘，此时复用被禁用、命令结束 logout。
- 工作区存储只在 HOME 不可写时启用；目录自带 `.gitignore`（`*`）避免把加密 jar 提交进仓库。不要手动拷贝 session jar 到其他机器或提交到仓库。
- 沙箱/agent shell 不能写 login keychain（`Operation not permitted`）：凭据写入用普通终端；读取与派生密钥路径不受影响。

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | 成功（含没有 jar / jar 不可读 —— 输出 `null` 字段） |
| `1`  | 读盘 / 解密以外的错误 |
| `2`  | `USAGE`（裸 `abap session`、`session reset` 缺 `--yes`） |
| `3`  | `CONFIG_ERROR`（profile / 工作区配置不可用） |

# More

## fixme

- [ ] SIGKILL / OOM 等无法执行收尾的终止仍会残留会话（依赖 SAP 会话超时）；如需「下条命令回收」需增加会话账本（当前不做）。

## todo

- [ ] 回收 orphan jar（URL/username/client 变化后遗留的旧 hash 文件）。

# references

- 实现: [src/abap_cli/commands/session.ts](../../src/abap_cli/commands/session.ts) · [src/abap_cli/session/store.ts](../../src/abap_cli/session/store.ts) · [src/abap_cli/session/manager.ts](../../src/abap_cli/session/manager.ts) · [src/abap_cli/session/cookies.ts](../../src/abap_cli/session/cookies.ts) · [src/abap_cli/session/jar.ts](../../src/abap_cli/session/jar.ts) · [src/abap_cli/session/key.ts](../../src/abap_cli/session/key.ts) · [src/abap_cli/session/policy.ts](../../src/abap_cli/session/policy.ts)
- 配置说明: [docs/configuration.md](../../docs/configuration.md)
- 相关命令页: [abap doctor](doctor.md)（`SESSION_REUSE_UNSUPPORTED` / `session.store` / `session.key`）
