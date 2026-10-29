---
type: reference
title: 设计决策录
description: abap-cli 关键架构与契约决策的「为什么」— 决策 / 被否决方案 / 当前代价，便于新人和 agent 快速理解项目取舍
tags: [abap-cli, design-decisions, architecture, adr]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# 设计决策录（Design Decisions）

每篇文档遵循 **决策 / 上下文 / 被否决方案 / 当前代价 / 后果** 五段式。面向新人 onboarding 与 agent 上下文读取。

## 索引

| # | 标题 | 摘要 |
|---|---|---|
| [001](001-3layer-architecture.md) | 三层架构（CLI / SAP / Agent） | 把"对外契约"和"对内实现"分层；spec/issue 不进 git |
| [002](002-icf-bypass-ddic.md) | DDIC 走自建 ICF 而非 ADT | ADT 写 DDIC 不稳；ICF 自托管换取稳定性 |
| [003](003-typesubdir-layout.md) | 类型子目录布局（`src/clas/...`） | 偏离 abap-file-format 扁平布局，换取多类型共存的整洁 |
| [005](005-btp-vs-onprem.md) | BTP trial vs on-prem 双路径 | SSO/auth/deploy 分流；同一命令在不同 runtime 下走不同 code path |
| [006](006-write-and-observe-semantics.md) | 写路径与观测语义的五条硬契约 | latest/active 版本语义、激活行号与半写状态、ICF 400 会话重试、DDIC 行类型、发布依赖边界 |

## 阅读顺序建议

- 第一次接触项目：先读 [001](001-3layer-architecture.md) → [002](002-icf-bypass-ddic.md) → [003](003-typesubdir-layout.md)
- 改 ICF / DDIC 相关代码：先读 [002](002-icf-bypass-ddic.md) → [005](005-btp-vs-onprem.md)
- 改 pull / push / inspect / select 的契约：先读 [006](006-write-and-observe-semantics.md)

# references

- 命令参考：[`docs/commands.md`](../../docs/commands.md)（生成物）；命令叙述页见 [`wiki/commands/`](../commands/)
- 命令元数据源：`src/abap_cli/flows/setup/command-schemas.ts` 与各命令的 `SCHEMA`
- 仓库合约：根 [`AGENTS.md`](../../AGENTS.md)
