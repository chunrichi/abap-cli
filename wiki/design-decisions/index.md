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
| [004](004-npm-extension-trust.md) | npm 扩展 trust hardening | 启动期零 import + sha512 lockfile + 严格包名校验 |
| [005](005-btp-vs-onprem.md) | BTP trial vs on-prem 双路径 | SSO/auth/deploy 分流；同一命令在不同 runtime 下走不同 code path |

## 阅读顺序建议

- 第一次接触项目：先读 [001](001-3layer-architecture.md) → [002](002-icf-bypass-ddic.md) → [003](003-typesubdir-layout.md)
- 改 ICF / DDIC 相关代码：先读 [002](002-icf-bypass-ddic.md) → [005](005-btp-vs-onprem.md)
- 改扩展加载逻辑：先读 [004](004-npm-extension-trust.md)

# references

- 流程上游：`specs/001-031-*`（设计过程文档，不进 git 但本地保留）
- 流程下游：`wiki/commands/*.md`（命令的最终参考）
- 仓库宪法：[`.github/copilot-instructions.md`](../../.github/copilot-instructions.md)
