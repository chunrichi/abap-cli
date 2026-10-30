---
type: reference
title: BTP trial vs on-prem 双路径
description: 同一命令在不同 SAP runtime 下走不同 code path；deploy、DDIC 创建、ICF 注册都分支
tags: [abap-cli, design-decisions, btp, steampunk, on-prem]
created at: 2026-09-01 00:00:00
changed at: 2026-10-30 19:30:00
---

# 005 — BTP trial vs on-prem 双路径

## 决策

CLI 在启动期探测 SAP runtime，分流到不同 code path：

| Runtime | 探测特征 | 关键差异 |
|---|---|---|
| `netweaver740` / `netweaver750` | on-prem URL + classic ADT | 走 `cl_icf_tree` 注册 ICF |
| `steampunk` | `*.abap.<region>.hana.ondemand.com` | ICF 注册改为 source-only 部署 + CF destination 步骤；SAP 端对 trial 包路径有约束 |
| `unknown` | 无法识别 | 走最保守路径；警告用户自行判断 |

runtime 探测结果缓存到 `~/.abap-cli/systems.json` 的 `runtime` 字段，由 `profile test` 刷新（详见 `runtime-cache.ts`）。

认证方式不在此分流内：CLI 仅支持 basic auth（见 [009](009-basic-auth-only.md)）。

## 上下文

abap-cli 必须同时支持：(1) on-prem NetWeaver 7.40/7.50；(2) BTP ABAP Environment（Steampunk）；(3) BTP Trial。它们的 ADT/ICF/RFC 行为有系统性差异：

- on-prem 可走 `cl_icf_tree` 写 ICF 节点；Steampunk 不允许
- BTP trial 限定开发包只能在 `ZLOCAL` / `ZCUSTOM_DEVELOPMENT` / `$TMP` 下（SAP Note 3237141）；CLI 不再内置该校验，由 SAP 端拒绝
- BTP 创建 CLAS/INTF/PROG/FUGR 必须去掉 `adtcore:responsible`（trial 的 ST 会拒绝）

## 被否决方案

- **只支持 on-prem**：BTP 用户被排除在外
- **只支持 BTP trial**：on-prem 用户被排除在外
- **抽象统一 adapter 接口**：复杂度极高；runtime 差异是 SAP 端差异，不是工程差异

## 当前代价

- 每个写路径都要 `if (runtime === 'steampunk')` 分支
- `profile test` 必须先识别 runtime 才执行后续 probe
- 新增一个 BTP 区域或运行时需要更新分流表（`adc/strategies/`）
- 认证只有 basic：仅接受 OAuth / SAML 的目标系统（如 BTP trial）在认证方式恢复前无法登录

## 后果

- **正面**：同一份 CLI 同一组命令，可 basic 登录的 on-prem/BTP 系统都能直接用
- **负面**：测试矩阵是笛卡尔积（runtime × object × system）；CI 必须覆盖 on-prem + BTP 两个目标

# references

- 实现：[`src/abap_cli/adc/runtime-probe.ts`](../../src/abap_cli/adc/runtime-probe.ts)、[`src/abap_cli/adc/strategies/`](../../src/abap_cli/adc/strategies/)
- 认证决策：[009 — 认证只保留 basic](009-basic-auth-only.md)
- 文档：[`docs/configuration.md`](../../docs/configuration.md) — BTP trial 包路径约束
