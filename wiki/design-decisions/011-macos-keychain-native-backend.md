---
type: reference
title: macOS keychain 默认走原生 security 后端
description: 用系统签名的 /usr/bin/security 创建凭据条目，消除反复弹出的钥匙串授权窗口；keytar 降为回退
tags: [abap-cli, design-decisions, keychain, macos, security]
created at: 2026-10-30 21:05:00
changed at: 2026-10-30 21:05:00
---

# 011 — macOS keychain 默认走原生 security 后端

## 决策

macOS 上凭据默认由原生后端（`/usr/bin/security` CLI）写入和读取；`keytar` 只在原生 helper 不可用时回退，`ABAP_CLI_KEYCHAIN_BACKEND` 仍可强制指定。写入遇到已存在的条目（`security` 退出码 45）时删除重建，让新条目的 ACL 重新绑定 `/usr/bin/security`。

## 上下文

macOS keychain 条目带 ACL：只有 ACL 里列出的应用可以无提示读取，其它应用每次访问都会弹出「允许 / 始终允许 / 拒绝」的授权窗口。ACL 绑定的是应用的代码身份（cdhash / code requirement）：

- 旧 `keytar` 后端的条目由 node 进程写入，ACL 信任当时的 node 二进制（如 `/opt/homebrew/Cellar/node@22/22.23.2/bin/node`，cdhash 精确匹配）。Homebrew 升级 node 后 cdhash 变化，ACL 失效：keytar 自己读会失败（`UNIX[Operation not permitted]`），改用原生 `security` 读又因不在 ACL 里而每次弹窗。
- 原生后端的条目由 `/usr/bin/security` 写入，ACL 默认信任创建者，也就是 Apple 签名的 `security`（`security dump-keychain -a` 可见 `identifier "com.apple.security" and anchor apple`）。它跨 node/macOS 升级稳定，读取不再弹窗。
- 参考实现 `vscode_abap_remote_fs` 在 1.6.10 以同样理由移除了 keytar，改用 VS Code 的 SecretStorage（`ExtensionContext.secrets`，由签名的 VS Code 宿主应用持有 keychain 身份）。standalone CLI 没有宿主应用，等价做法就是把 keychain 身份交给系统签名 helper。

## 被否决方案

- **放弃 keychain，改明文文件 / 环境变量**：违反仓库合约（SAP 密码只写入 OS keychain），且 `.env`、进程参数、日志的泄漏面比 keychain 大。CI/测试已有 `ABAP_CLI_KEYCHAIN_BACKEND=none` / `fixture` 两个不落盘的选项。
- **继续用 keytar，让用户点「始终允许」**：ACL 绑定 node cdhash，每次 Homebrew 升级 node 都会重新触发；而且在 agent/沙箱上下文里点击授权和 ACL 落盘都不可靠。
- **用 `security add-generic-password -U` 原地更新旧条目**：实测 `-U` 只更新 secret，不替换 ACL（`security dump-keychain -a` 仍显示无可信应用），弹窗照旧。必须删除重建。
- **把 secret 交给 agent/host 托管（VS Code SecretStorage 的等价物）**：CLI 是独立进程，没有宿主 secret API；若要做只能由调用方通过环境变量传入，和上一条同样的泄漏问题。

## 当前代价

- macOS 上旧的 keytar 条目需要迁移：在普通终端执行一次 `abap profile set <name> --password <pwd>` 重建密码条目，再 `security delete-generic-password -a abap-cli/session-key -s abap-cli` 并重跑一次命令重建会话密钥。不迁移的话，首次读取仍会弹一次窗。
- 沙箱/agent shell 不能写 login keychain（`Operation not permitted`）：凭据写入类命令必须在普通终端跑；读取不受影响。
- 信任 `/usr/bin/security` 意味着同一 OS 用户下的任意进程都能通过它无提示读取该条目，保护面比「绑定具体应用」的 keytar ACL 宽。本项目按「同用户可信」威胁模型取舍：换掉的是反复弹窗和跨 node 升级失效，不是防范同用户恶意进程。

## 后果

- **正面**：macOS 不再反复弹钥匙串授权窗口；凭据条目跨 node / macOS 升级稳定；keychain 后端选择收敛为「原生优先」，`keytar` 从主路径降级为回退，后续可直接移除 optionalDependency。
- **负面**：旧条目需要一次性迁移；`/usr/bin/security` 成为凭据读取的单点信任；native 后端通过命令行传 secret（`-w value`），进程参数短暂可见——这一点与旧行为一致，后续可评估 stdin / 临时文件的替代实现。

# references

- 实现：[`src/abap_cli/config/secrets/native.ts`](../../src/abap_cli/config/secrets/native.ts)、[`src/abap_cli/config/secrets.ts`](../../src/abap_cli/config/secrets.ts)
- 相关决策：[009 — 认证只保留 basic](009-basic-auth-only.md)
- 外部参考：`vscode_abap_remote_fs` 1.6.10「replaced keytar with vscode secure storage」；其 `PasswordVault` 委托给 `ExtensionContext.secrets`
