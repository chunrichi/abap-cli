---
type: reference
title: 三层架构（CLI / SAP / Agent）
description: 把项目拆为 CLI（TypeScript）+ SAP（ABAP）+ Agent（Markdown）三层，每层有自己的目录、自己的契约、自己的演进节奏
tags: [abap-cli, design-decisions, architecture, layers]
created at: 2026-09-01 00:00:00
changed at: 2026-09-01 00:00:00
---

# 001 — 三层架构

## 决策

把项目拆成三个独立层，每层用自己的语言、自己的目录、自己的演进节奏：

| 层 | 目录 | 语言 | 职责 |
|---|---|---|---|
| **CLI** | `src/abap_cli/` | TypeScript | 薄客户端；HTTP 调用 SAP、文件 I/O、结果展示 |
| **SAP** | `abap/` | ABAP | ICF 服务处理器；DDIC / HTTP / tcode 的 SAP 侧实现 |
| **Agent** | `skills/` + `agents/` | Markdown | Skill 与工作流提示词；驱动 agent 编排命令 |

## 上下文

CLI 直接吃 SAP 的 ADT REST API 是最简单的方案。但 ADT 写 DDIC（TABL/STRU/DOMA/DTEL）的成功率不可控；同时把所有规则塞进一个 TypeScript 仓库会让 agent 上手变得很重。

## 被否决方案

- **单层纯 CLI（CLI 全部实现）**：DDIC 写失败的概率不可接受；agent 必须读整个仓库才能理解命令集
- **CLI + 外部 NPM 库（依赖 abapGit 反序列化）**：abapGit 与 abap-file-format 语义有差，且 abapGit 不暴露写 API
- **纯 MCP Server（CLI 退化为协议层）**：CLI 是更基础的契约；agent 多样性更高（CLI 可被 shell 脚本化）

## 当前代价

- 三个层各有一套约定要维护（CLI 走 `commander`，SAP 走 ICF，Agent 走 SKILL.md frontmatter）
- ABAP 端任何 bug 都需要在两个仓库修（TS 这边做兜底）

## 后果

- **正面**：CLI 可以独立发布 npm；SAP 后端独立部署；Agent skill 可以独立打包到用户机器
- **负面**：新增一类对象需要同时改 CLI（路由 + format）+ SAP（handler）+ wiki（文档）三处

# references

- 实现：[`docs/architecture.md`](../architecture.md)
- 仓库宪法：[`.github/copilot-instructions.md`](../../.github/copilot-instructions.md)
