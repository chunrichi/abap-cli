---
name: abap-setup
description: abap-cli 接入与诊断 — 配置工作区（`abap config` / `connection`）、诊断环境（`abap doctor`）、管理传输请求（`abap transport`）。use when asking how to connect to SAP / configure a workspace / add a system profile / diagnose the CLI environment / list / create / show / resolve / assign / release a transport request.
metadata:
  version: "0.1.0"
  scope: local
  commands: [config, connection, doctor, transport]
---

# abap-setup — 接入与诊断

`local scope` — 这 4 个命令不调用 SAP，只读写本地配置（`.abap.json`、`~/.abap-cli/systems.json`、OS keychain、传输请求元数据）。

## 何时用

- 第一次使用 abap-cli，需要配置 SAP 系统
- 切换 SAP 系统或多系统切换
- 怀疑配置 / 连接 / 环境有问题，需要系统诊断
- 推送对象前缺传输请求，需要 `transport list` 查 + `transport create` 建
- 把现有对象绑到指定传输请求（`transport assign`）或查对象的请求归属（`transport resolve`）

## 决策树

```
首次接入？
├── 是 → [scripts/diagnose.sh](./scripts/diagnose.sh) 一次性诊断
│         ├── doctor 报告 OK → 已配置？看连接
│         ├── doctor 报告 config 缺失 → abap config --url ... --username ... --password ...
│         ├── doctor 报告 TLS 失败 → 加 --insecure 或 --ca <pem>
│         └── doctor 报告 auth 失败 → abap connection test <name>
└── 否 → 缺传输请求？
    ├── 是 → [scripts/resolve-transport.sh](./scripts/resolve-transport.sh) 自动建
    └── 否 → 直接进 abap-edit 工作流
```

## 错误恢复

| 错误 | 动作 |
|---|---|
| `CONFIG_ERROR` (exit 3) | 检查 `.abap.json` / `~/.abap-cli/systems.json` JSON 语法；重新 `abap config` |
| `TLS_ERROR` (exit 4) | `connection add <name> --insecure`（自签证书）或 `--ca <pem>` |
| `AUTH_ERROR` (exit 5) | `connection test <name>` 诊断；重写 keychain 密码（`connection set <name> --password '***'`） |
| `NO_TRANSPORT` (exit 7) | `transport list --open` 查 → 没有则 `transport create "..." --package $PKG` |
| `TRANSPORT_CREATE_FAILED` | 描述非空；用户须有 developer 权限 |
| `USAGE` / `INVALID_ARGUMENT` | 看 `error.nextSteps` 或 `abap <cmd> --help` |

## 通用规则

1. **永远 `--json`**：`status` / `error.code` 分支判断；不读自由文本
2. **密码走 keychain**：`connection add/set` 写入，**不**通过命令行传明文
3. **多系统用 profile**：每个系统一个 profile，切换用 `--system <name>`
4. **`connection test` 退出码反映最差失败层**：TLS→4 / AUTH→5 / ADT-ICF→6

## references（按需加载）

- [references/commands-quick.md](./references/commands-quick.md) — 4 命令完整速查
- [references/errors.md](./references/errors.md) — 错误码全表
- 权威来源：
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/config.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/connection.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/doctor.md>
  - <https://github.com/SAP/abap-cli/blob/main/wiki/commands/transport.md>
  - <https://github.com/SAP/abap-cli/blob/main/docs/commands.md>

## assets / scripts

- [scripts/diagnose.sh](./scripts/diagnose.sh) — 一次性跑 `doctor` + `connection test`
- [scripts/resolve-transport.sh](./scripts/resolve-transport.sh) — 自动 list → create → 输出新请求号
- [assets/.abap.json.template](./assets/.abap.json.template) — 工作区配置样板