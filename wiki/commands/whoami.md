---
type: command
title: abap whoami
description: 由 SAP 系统返回当前连接的实际身份 — 用户、SID + client，以及应用服务器 / 数据库 / OS / ABAP release；需要新版内置 ICF 服务
tags: [abap-cli, command, whoami, identity, system-side, icf, deploy]
created at: 2026-11-03 22:35:00
changed at: 2026-11-03 23:12:31
---

# abap whoami

回答「SAP 系统认为当前连接是谁、连在哪个系统 / 客户端上」。身份不是从 `.abap.json` / profile 配置推断出来的：命令调用内置 ICF 服务的 `GET /sap/abap_cli/whoami`，由处理该 HTTP 请求的 ABAP 会话返回系统字段（`sy-uname`、`sy-sysid`、`sy-mandt`、`sy-host`、`sy-dbsys`、`sy-opsys`、`sy-saprl`）。配置与真实登录不一致时以系统返回为准；将来 CLI 接入 SSO 等认证方式后，命令语义不变。

命令不修改任何 SAP 对象，但需要新版内置 ICF 服务（2.3.0+）：服务未部署或版本过旧时报 `ICF_IDENTITY_UNAVAILABLE`（exit 8），先 `abap deploy --yes`。

## 前置条件

- 工作区已绑定 profile（`.abap.json`），SAP 可达且认证成功。
- 已部署包含 `/whoami` 端点的内置 ICF 服务：首次使用或升级 CLI 后执行 `abap deploy --yes`；`abap deploy status --json` 应显示 `current`。
- 服务未部署 / 版本过旧时，`abap whoami` 报 `ICF_IDENTITY_UNAVAILABLE`（exit 8），按 `error.nextSteps` 部署后重试；`abap whoami --schema --json` 不受影响（不连 SAP）。

## Usage

```bash
abap whoami
```

无位置参数、无命令专属选项；profile 由当前工作区的 `.abap.json#system` 决定（切换用 `abap init --profile <name>`）。

## Options

- `--schema`: 打印本命令参数 schema（本地调用，不连 SAP、不检查 ICF 部署）
- `--json` / `--pretty-json`: 全局输出开关（`--json` 紧凑，`--pretty-json` 缩进 2）

## Expected Output

human 输出固定 5 行（标题 + `profile` / `system` / `user` / `url`）；拿到服务器信息时追加一行 `server`：

```
Connection identity:
  profile:  test
  system:   S4H client 100
  user:     SAP103
  url:      https://sap.example.com:44300
  server:   HDB · Linux · vhcalhdbdb · ABAP 757
```

`--json` 信封的 `data`：

```json
{
  "status": "success",
  "meta": { "command": "abap whoami", "version": "2.6.1", "timestamp": "2026-11-03T00:00:00.000Z", "durationMs": 280, "warnings": [] },
  "data": {
    "profile": "test",
    "url": "https://sap.example.com:44300",
    "system": "S4H",
    "client": "100",
    "user": "SAP103",
    "server": {
      "applicationServer": "vhcalhdbdb",
      "database": "HDB",
      "os": "Linux",
      "abapRelease": "757"
    }
  }
}
```

字段来源（`profile` / `url` 是 CLI 连接上下文，其余全部由 SAP 系统返回）：

| 字段 | 来源 | 缺失时 |
|---|---|---|
| `profile` / `url` | 工作区绑定的 profile 名与 endpoint | `profile` 缺失即命令失败（`CONFIG_ERROR`） |
| `user` | SAP 会话字段 `sy-uname`（实际登录用户；SSO 下同样可用） | 系统返回不完整时报 `SAP_ERROR`，不用本地配置兜底 |
| `system` / `client` | `sy-sysid` / `sy-mandt` | 同上 |
| `server.applicationServer` | `sy-host` | 整个 `server` 在无可用字段时省略 |
| `server.database` | `sy-dbsys`（如 `HDB`） | 同上 |
| `server.os` | `sy-opsys` | 同上 |
| `server.abapRelease` | `sy-saprl`（如 `757`） | 同上 |

省略是契约的一部分：没有的事实不出现，不用 `null` 或空值补齐。Agent 只需读 `data.user` / `data.system` / `data.client`；`server` 是排障补充信息。

## Exit codes

| Code | 触发条件 |
|---|---|
| `0` | 成功读取系统返回的身份 |
| `3` | `CONFIG_ERROR`：工作区没有 `.abap.json`、引用的 profile 不存在、配置或凭证存储不可用 |
| `4` | `TLS_ERROR`：TLS 握手 / 证书校验失败 |
| `5` | `AUTH_ERROR`：SAP 拒绝登录（用户 / 密码错误、用户锁定） |
| `6` | `SAP_ERROR`：ICF 调用失败（服务端错误、网络问题，或返回的身份不完整） |
| `8` | `ICF_IDENTITY_UNAVAILABLE`：内置 ICF 服务未部署或版本过旧，没有 `/whoami` 端点；执行 `abap deploy --yes` 后重试 |

## Gotchas

- **需要新版 ICF 服务**：身份端点随 2.3.0 内置服务提供；旧服务 / 未部署报 `ICF_IDENTITY_UNAVAILABLE`（exit 8）。先 `abap deploy --yes`，再用 `abap deploy status --json` 确认 `current`。
- **刚部署完可能短暂仍报 `ICF_IDENTITY_UNAVAILABLE`**：SICF handler 的 class load 刷新有延迟（部署页「部署后的会话缓存」），等待约 1 分钟或换新会话重试；`abap deploy status` 已显示 `current` 时不需要重复部署。
- **身份来自系统，不来自 CLI 配置**：`user` / `system` / `client` 全部由 SAP 会话返回，profile 只标出用哪套连接参数。配置与实际登录不一致时以输出为准；这也是将来支持 SSO / ticket 认证时命令仍然有效的原因。
- **只看工作区绑定的 profile**：命令没有 `--profile` 选项；要确认另一个 profile，先 `abap init --profile <name>` 绑定，或用 `abap profile test <name>` 做该 profile 的分层探测。
- **实时命令**：需要网络可达 SAP 与可用的认证（当前为 basic auth + OS keychain 密码）；离线或没有凭据时无法完成。
- **不走 ADT 会话复用**：whoami 与其它 ICF 类命令一样每次用 Basic auth 直接请求；内置 ICF 端点是无状态的，不读 / 写 ADT 的 session jar，也不受 `.abap.json#sap.sessionPolicy` 影响。
- **不输出秘密**：密码、cookie、会话密钥都不进输出；`url` 只是 endpoint base（`scheme://host[:port]`）。
- **不是 `abap profile test` 的替代**：whoami 只回答「系统认为你是谁」，不逐层诊断 TLS / AUTH / ADT，也不检查 ICF 服务版本（版本用 `abap deploy status`）。

## Examples

```bash
# 当前连接在 SAP 系统里是谁、属于哪个系统 / 客户端
abap whoami

# 机器可读：agent / 脚本读 data.user / data.system / data.client
abap whoami --json

# 升级 CLI 后先部署新版 ICF 服务，再确认身份
abap deploy --yes
abap whoami --json
```

# More

## 与 `abap profile test` 的区别

| | `abap whoami` | `abap profile test <name>` |
|---|---|---|
| 目标 | 工作区绑定的连接 | 显式指定的 profile |
| 动作 | 调 ICF `/whoami`，取 SAP 会话身份 | 分层探测 tls → auth → adt → icf |
| 依赖 | 新版内置 ICF 服务（含 `/whoami`） | 无需 ICF 部署即可跑前两层；icf 层单独报告 |
| 退出码 | 成功 / CONFIG / TLS / AUTH / SAP / `ICF_IDENTITY_UNAVAILABLE`(8) | 最差层决定（TLS→4、AUTH→5、ADT/ICF→6） |
| 适用 | 「系统认为现在是谁」 | 「这个 profile 哪里不通」 |

## 真机证据

- 2026-11-03 在默认测试系统（S/4HANA 2022 SP01，kernel 789，profile `test`，client 100）实测：
  - 部署 2.3.0 内置 ICF 服务（`abap deploy --yes`）后 `abap whoami --json` 成功（exit 0，约 0.4–0.8s）：`user: "SAP103"`、`system: "S4H"`、`client: "100"`，`server: { applicationServer: "vhcalhdbdb", database: "HDB", os: "Linux", abapRelease: "757" }`，与系统侧原始 `GET /sap/abap_cli/whoami` 响应一致；human 输出为 `Connection identity:` 标题 + profile / system / user / url / server 五行。
  - 服务未部署新版（旧服务无 `/whoami`、`GET /sap/abap_cli/whoami` 返回 404 NOT_FOUND）时：`ICF_IDENTITY_UNAVAILABLE`（exit 8），`error.nextSteps` 指向 `abap deploy --yes` 与 `abap deploy status --json`；部署后 `abap deploy status` 报 current（2.3.0）。
  - 错误密码 → `AUTH_ERROR`（exit 5）；未绑定工作区 → `CONFIG_ERROR`（exit 3）；`abap whoami --schema --json` 不连 SAP。
  - 输出不含密码 / cookie / 会话值；命令只读，不创建 SAP 对象。

# references

- 实现：`src/abap_cli/commands/whoami.ts`、`src/abap_cli/flows/core/whoami.ts`、`src/abap_cli/clients/system-identity.ts`、`src/abap_cli/clients/icf-client.ts`（`getSystemIdentity`）、`src/abap_cli/output/error-codes.ts`
- SAP 侧：`abap/src/zcl_abap_vibe_icf.clas.abap`（`/whoami` 路由）、`abap/src/zcl_abap_vibe_icf_response.clas.abap`（`handle_whoami`）、`abap/src/zcl_abap_vibe_icf_types.clas.abap`
- 部署要求：[abap deploy](deploy.md)（`deploy --yes` 安装 / 升级 ICF 服务；`deploy status` 查 `current` / `outdated`）
- 配置：[docs/configuration.md](../../docs/configuration.md)（`.abap.json`、`sap.sessionPolicy`、keychain）
- 生成参数参考：[docs/commands.md](../../docs/commands.md)
- 相关命令页：[abap init](init.md)（绑定工作区）、[abap profile](profile.md)（`profile test` 分层诊断）、[abap session](session.md)（会话存储与复用）、[abap doctor](doctor.md)（本地环境诊断）
