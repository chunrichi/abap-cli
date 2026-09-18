---
name: abap-cli-setup
description: abap-cli 接入、诊断与基础设施就绪 — 配置工作区（`abap init` / `profile`）、诊断环境（`abap doctor`）、管理传输请求（`abap transport`）、部署/探测自带 ICF 服务（`abap deploy` / `abap deploy status`）、管理第三方扩展（`abap extensions`）、探查 session cookie jar（`abap session info`）。use when asking how to connect to SAP / configure a workspace / add a system profile / diagnose the CLI environment / list / create / show / resolve / assign a transport request / install or upgrade the bundled ICF service / check whether the bundled ICF service is current / list or pin third-party extensions / inspect the SAP session cookie jar / debug a 400 "session timed out" auth error.
metadata:
  version: "0.2.7"
  scope: workspace-and-sap
  commands: [init, profile, doctor, transport, deploy, extensions, session]
---

# abap-cli-setup — 接入、诊断与基础设施就绪

`workspace-and-sap` scope — 7 个命令管工作区配置、profile 凭证、本地诊断、SAP 传输请求、ICF 服务部署、第三方扩展、session cookie 探查。本 skill **不**管对象操作（拉 / 推 / 查 / 跑）—— 那走 `abap-cli-search` / `abap-cli-edit` / `abap-cli-data`。

## 何时用

- 第一次使用 abap-cli，需要配置 SAP 系统
- 切换 SAP 系统或多系统切换
- 怀疑配置 / 连接 / 环境有问题，需要系统诊断
- 推送对象前缺传输请求，需要 `transport list` 查 + `transport create` 建
- 把现有对象绑到指定传输请求（`transport assign`）或查对象的请求归属（`transport resolve`）
- 第一次跑 `abap-cli-data` 的 `run` / `select` 之前，要部署 bundled ICF 服务
- 升级 CLI 后 ICF 服务版本过期（`deploy status` 报 `outdated`）
- 装了第三方 npm 扩展（`.abap.json::extensions[]`），想看加载状态 / 钉 sha512 → `extensions list` / `extensions lock`
- 看到 `400 Session Timed Out` 想确认本地 cookie jar 是否有效 → `session info`
- debug `AUTH_ERROR` 报"400 而非 401"（其实是 SAP 端 cookie 过期被踢，0.2.5+ 修复自动分类）

## 决策树

```
接入 / 基础设施就绪？
├── 首次接入？
│   ├── 是 → [scripts/diagnose.mjs](./scripts/diagnose.mjs) 一次性诊断
│   │         ├── doctor 报告 OK → 已配置？看连接
│   │         ├── doctor 报告 config 缺失 → abap init --url ... --username ...
│   │         ├── doctor 报告 TLS 失败 → 加 --insecure 或 --ca <pem>
│   │         └── doctor 报告 auth 失败 → abap profile test <name>
│   └── 否 → 缺传输请求？
│       ├── 是 → [scripts/resolve-transport.mjs](./scripts/resolve-transport.mjs) 自动建
│       └── 否 → ICF 服务状态？
│           ├── ICF 健康？→ 直接进 abap-cli-search / -edit / -data
│           ├── not_deployed / outdated → [scripts/deploy-if-outdated.mjs](./scripts/deploy-if-outdated.mjs) → 进对应领域 skill
│           └── unreachable (warning) → 不阻断；领域 skill 可能失败，再回这查
├── 领域 skill 跑类 / 查表 / 查码 报 WRAPPER_NOT_DEPLOYED？
│   └── → abap deploy --yes → 复跑
├── ICF 服务版本过期 (doctor 或 doctor/init 提示 outdated)？
│   └── → abap deploy --yes（升级）→ 重跑领域 skill
├── 装了第三方 npm 扩展？看加载状态 / 钉 sha512？
│   ├── 列已注册扩展 → abap extensions list --json
│   └── 重新生成 extensions.lock.json → abap extensions lock [--allow-uid]
└── debug 400 "Session Timed Out" auth 错误？
    └── → abap session info [--profile <name>] --json    # 确认 cookie jar 状态；session jar 内容用 AES-256-GCM 加密（keychain）
```

## 错误恢复（本 skill 专属错误码）

| 错误 | 动作 |
|---|---|
| `CONFIG_ERROR` (exit 3) | 检查 `.abap.json` / `~/.abap-cli/systems.json` JSON 语法；重新 `abap init` |
| `TLS_ERROR` (exit 4) | `profile add <name> --insecure`（自签证书）或 `--ca <pem>` |
| `AUTH_ERROR` (exit 5) | `profile test <name>` 诊断；重写 keychain 密码（`profile set <name> --password '***'`） |
| `NO_TRANSPORT` (exit 7) | `transport list --open` 查 → 没有则 `transport create "..." --package $PKG` |
| `TRANSPORT_CREATE_FAILED` | 描述非空；用户须有 developer 权限 |
| `ACTIVATION_FAILED` (exit 7) | **仅 ICF 部署语境**：ICF handler 激活失败；走 `inspect <obj> --activation` 复检 → `activate --yes`（后两步跳 `abap-cli-edit`） |
| `SAP_ERROR` (exit 6) | `data.objects[]` 看哪个失败 |
| `ICF_CHECK_DEGRADED` | **双形态**：① 多数场景为 `meta.warnings` 条目（`deploy status` 探测 / `init` 信息性检查），不阻断；② `init` 的 ICF 探针若解析失败且不致命则降级为 warning，若致命则升级为 error（exit 7） | 看 `meta.warnings` 详情 / 跳过；致命时按 SAP_ERROR 处理 |
| `STEAMPUNK_ICF_MANUAL` (exit 7) | BTP / Steampunk 不允许 ICF 自动部署 | 走 GUI 手动部署；profile 已标 `--auth-method` 为 oauth 时常见 |
| `FORCE_BYPASSED` (exit 7) | `deploy --force` 跳过安全守卫 | 检查 `data.forced: true` 是否预期 |
| `ICF_OUTDATED_DEADLOCK` | `deploy status` 报 outdated 且 transport 持有新源（用户已导入但未 release） | 走 transport release 后重 deploy；当前 CLI 无 `transport release` 子命令 |
| `USAGE` / `INVALID_ARGUMENT` | 看 `error.nextSteps` 或 `error.references` |

## 通用规则

1. **永远 `--json`**：`status` / `error.code` 分支判断；不读自由文本
2. **密码走 keychain**：`profile add/set` 写入，**不**通过命令行传明文
3. **多系统用 profile**：每个系统一个 profile，切换用 `--profile <name>`
4. **`profile test` 退出码反映最差失败层**：TLS→4 / AUTH→5 / ADT-ICF→6
5. **跨 skill handoff**：`deploy` 修 `abap-cli-data` 的 `WRAPPER_NOT_DEPLOYED`；`transport create` 修 `abap-cli-edit` 的 `NO_TRANSPORT`

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 5 命令完整速查
- [references/errors.md](./references/errors.md) — 本 skill 错误码全表

## scripts / assets

- [scripts/diagnose.mjs](./scripts/diagnose.mjs) — 一次性跑 `doctor` + `profile test`（Node 18+ 跨平台）
- [scripts/resolve-transport.mjs](./scripts/resolve-transport.mjs) — 自动 list → create → 输出新请求号
- [scripts/deploy-if-outdated.mjs](./scripts/deploy-if-outdated.mjs) — 仅在 ICF 服务版本过期时才部署
- [assets/.abap.json.template](./assets/.abap.json.template) — 工作区配置样板