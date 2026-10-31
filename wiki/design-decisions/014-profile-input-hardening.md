---
type: reference
title: profile 输入在写入前归一化与校验
description: URL 只存 origin、profile 名限字符集、交互与参数共用一套校验、textpool 探测定向到目标 profile、init 字段更新走 merge
tags: [abap-cli, design-decisions, profile, init, validation, url]
created at: 2026-10-31 22:36:00
changed at: 2026-10-31 22:36:00
---

# 014 — profile 输入在写入前归一化与校验

## 决策

`abap profile add / set / import` 与 `abap init` 建 profile 时，统一在**写入前**完成三件事：

1. **URL 归一化**：只保留 `scheme://host[:port]`；丢弃 path / query / fragment 并发 `URL_NORMALIZED` 告警；拒绝 URL 内嵌凭据。
2. **profile 名校验**：`1–64` 字符、`[A-Za-z0-9_.-]`、首字符字母或数字；名称同时是 `systems.json` 键与 keychain account。
3. **交互与参数同一套校验**：TTY 向导落盘前调用与 flag 路径相同的 `assertValidProfile`，不再有"向导可以写出坏 profile"的分叉。

同时：

- `abap init` 支持只给 `--tr / --package / --source-dir` 时更新最近的 `.abap.json`（不必 `--profile`）；写盘统一走 merge，未传字段保留。
- `systems.json` 增加 `formatVersion` 标记（读取忽略，写入固定）。
- textpool 能力探测改为**定向到目标 profile**（`abap init` 时），连不上时不落盘；`profile add/set` 不再触发任何探测。

## 上下文

官方 ADT for VS Code 的 destination 添加流程里，HTTP destination 只用两个字段（URL + ID），创建时会先清 URL 的 path/query 再探测 API 地址——说明"用户粘贴浏览器 URL"是通用问题。我们的 CLI 没有这个清理：`abap-adt-api` 把 base URL 交给 axios，资源路径是绝对的 `/sap/bc/adt/...`，带 path 的 base 必然拼出 404。

本仓库的 profile 层还有三个已实测缺陷：交互式 `add` 不校验、能写空 URL 导致整份配置不可读；`add` 的 textpool 探测借用当前工作区连接、可能把别的系统的结论写进新 profile；`init` 写 `.abap.json` 是覆盖而非文档承诺的 merge（会丢 `sourceDir`）。这些都在"添加 profile"这一条主路径上，一起收敛。

## 被否决方案

- **照搬官方向导（RFC/HTTP 二选一 + 浏览器登录 + 不存密码）**：与仓库已定的"仅 basic auth、keychain 无人值守"冲突（见 009），重新引入需要新设计文档。
- **`profile add` 自动联网验证**：会让离线/CI 场景变慢且行为不确定；保留 `profile test` 作为显式验证步骤，`add` 只返回未验证与下一步。
- **只在文档里提示"URL 不要带 path"**：真实用户仍会粘贴浏览器地址，错误延迟到连接阶段且难定位。
- **读取时静默归一化旧 URL**：会掩盖历史脏数据，且 `profile show` 与实际存储不一致；改为写入时归一化，旧数据用 `profile set <name> --url <origin>` 显式修正。
- **按官方 destination ID 派生规则命名 profile**（`<SID>_<client>_<user>_<lang>`）：HTTP 场景无 SID，且会改变现有 CLI 命名习惯。

## 当前代价

- 既有 profile 名含空格/斜杠等字符时不能再 `set` 或导出后重新导入；需删除重建并重新绑定工作区。
- 旧 profile 里带 path/query 的 URL 仍按原样读取，需要手动 `profile set --url` 修正一次。
- `abap init --tr/--package` 在非交互下的行为从"报错"变为"更新现有配置"；依赖旧报错的脚本需要调整。
- `profile add/set` 不再顺便探测 textpool，能力缓存只会在 `abap init` 时写入；没有运行过 `init` 的 profile 会走保守的默认路由（读 ADT、写 ICF）。

## 后果

- **正面**：连接配置的主路径不再产生"看着创建成功、实际永远 404"的 profile；交互与参数路径契约一致；`init` 的 merge 行为与文档一致；textpool 路由依据来自目标系统本身。
- **负面**：多了一条迁移动作（profile 名/URL）；`init` 的字段更新语义变化需要用户感知。
- **后续**：如果要支持跨机器 bundle 的 URL 归一化差异，可在 `import` 结果里回显被归一化的字段（当前只发 warning）。

# references

- 实现：[`src/abap_cli/config/validation.ts`](../../src/abap_cli/config/validation.ts)、[`src/abap_cli/flows/setup/profile.ts`](../../src/abap_cli/flows/setup/profile.ts)、[`src/abap_cli/flows/setup/init.ts`](../../src/abap_cli/flows/setup/init.ts)、[`src/abap_cli/clients/textpool-capability.ts`](../../src/abap_cli/clients/textpool-capability.ts)
- 相关决策：[009 — 认证只保留 basic](009-basic-auth-only.md)、[011 — macOS keychain 原生后端](011-macos-keychain-native-backend.md)
- 外部参照：官方 ADT for VS Code 的 destination 创建流程（`AdtLsDestinationService.createDestination`：清 path/query 后探测 API URL）
