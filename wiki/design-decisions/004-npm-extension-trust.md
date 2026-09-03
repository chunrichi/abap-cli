---
type: reference
title: npm 扩展 trust hardening
description: 启动期零 import + sha512 lockfile + 严格包名校验 — 防止恶意或被篡改的扩展被 import()
tags: [abap-cli, design-decisions, security, extensions, supply-chain]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# 004 — npm 扩展 trust hardening

## 决策

第三方 npm 扩展（`abap extensions install <pkg>`）的加载路径**必须**经过四道闸门，缺一不可：

1. **启动期零 `import()`**：CLI 启动只读 `extensions.lock.json` + argv sniff；只有真正命中目标命令才 `import()`（详见 `extensions/lazy.ts`）
2. **Lockfile 完整性**：每个扩展记录 `integrity.sha512`；`node:crypto` 在 `import()` 之前先验哈希，不通过直接 `EXTENSION_LOAD_FAILED`（exit 3）
3. **包名严格校验**：拒绝 `..` / `\` / 空 scope / URL scheme / 非 npm 名字符集（参考 npm 包名正则 `^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$`）
4. **白名单命令**：未声明在 lockfile 的 npm 包不会被加载；`abap extensions lock [--allow-unsigned]` 显式管理 lockfile

## 上下文

abap-cli 是 agent 在用户机器上**以用户身份**执行的工具。攻击面 = 一个被植入恶意代码的扩展可以在用户保存 SAP 密码（OS keychain）时偷走它。任何 `extensions.install <pkg>` 路径都必须把"包是否被篡改过"作为头等大事。

## 被否决方案

- **白名单知名发布者**：可被攻击者社工绕过；锁死生态
- **运行时只校验签名、不验哈希**：签名验通过但 `node_modules` 被人改过仍然危险
- **完全禁止扩展**：杀鸡用牛刀；spec 023 设计目标就是支持第三方扩展

## 当前代价

- 用户安装扩展时多一步：`abap extensions lock` 把哈希写入 lockfile
- 升级扩展时 lockfile 必须同步更新（用 `npm update` 后再 `lock`）
- 整体包管理 UX 比 npm 自身更严格（少部分用户会觉得"装个扩展这么麻烦"）

## 后果

- **正面**：被攻破的扩展在 `import()` 那一刻就会被拦截；密码泄露面缩到最小
- **负面**：lockfile 增大了本地配置复杂度；首次安装门槛略高

# references

- 规范来源：[`specs/023-extension-mechanism/`](../../specs/023-extension-mechanism/)、[`specs/027-extension-trust/`](../../specs/027-extension-trust/)
- 实现：[`src/abap_cli/extensions/lockfile.ts`](../../src/abap_cli/extensions/lockfile.ts)、[`src/abap_cli/extensions/lazy.ts`](../../src/abap_cli/extensions/lazy.ts)
- 命令：[`wiki/commands/extensions.md`](../commands/extensions.md)、[`wiki/commands/extensions-lock.md`](../commands/extensions-lock.md)
