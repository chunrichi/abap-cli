---
type: reference
title: 认证只保留 basic
description: 删除 cert / browser_sso / oauth_password / sso 四种登录方式，统一 username + keychain 密码
tags: [abap-cli, design-decisions, auth, keychain]
created at: 2026-10-30 19:30:00
changed at: 2026-10-30 19:30:00
---

# 009 — 认证只保留 basic

## 决策

CLI 只支持 basic auth（HTTP Basic：SAP username + OS keychain 密码）。删除另外四种登录方式及其全部实现与命令面：`cert`（X.509 mTLS）、`browser_sso`（浏览器 cookie）、`oauth_password`（BTP UAA password grant）、`sso`（Kerberos/SPNEGO）。

`--ca` / `--insecure` 只属于 TLS 信任配置，不是独立认证方式；CA 的导入/回收/store 机制保留。

## 上下文

认证策略层曾以 registry 形式扩展出 5 种方法，但实际使用面窄：`cert` 依赖 SAP 端 CERTRULE 配置，`browser_sso` 需要人工抓 30 分钟 TTL 的 cookie，`oauth_password` 只适用 BTP/CF service-key，`sso` 只在 Windows SSPI 下真正可用（Unix 需额外 GSS-API binding）。这些分支的成本（profile schema、CLI 参数、错误提示、probe 预检、测试矩阵）超过收益，且没有真实第三方用例。

## 被否决方案

- **保留代码、只隐藏 CLI 参数**：留下死代码和半死配置（profile 里的 auth 字段仍在），probe 与错误提示仍要分支。
- **自动降级到 basic**：cert/SSO 配置无法安全地"猜"出一个可用密码，静默降级会把正确性问题推迟成 401。

## 当前代价

- 需要 OAuth（BTP ABAP Environment / trial）、SAML SSO 或 X.509 的系统不能接入。
- 旧 profile 必须迁移：`abap profile set <name> --password <pwd>` 或删除重建；旧 keychain cert-passphrase 条目需手动清理。

## 后果

- **正面**：认证路径单线（password + TLS options），profile 不再有 `auth` 判别联合，CLI 参数面、错误提示、测试矩阵同步收缩。
- **负面**：认证类型覆盖变窄；以后重新引入某种方式需要重建策略层与迁移路径。

# references

- 实现：[`src/abap_cli/clients/basic-auth.ts`](../../src/abap_cli/clients/basic-auth.ts)、[`src/abap_cli/config/user-config.ts`](../../src/abap_cli/config/user-config.ts)、[`src/abap_cli/config/validation.ts`](../../src/abap_cli/config/validation.ts)
- 相关决策：[005 — BTP trial vs on-prem 双路径](005-btp-vs-onprem.md)
