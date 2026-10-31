---
type: reference
title: 反馈改走 GitHub Issues，删除自建反馈服务
description: 删除 abap feedback 命令与自建 issue HTTP 契约；CLI 反馈由 agent 直接提 GitHub issue（MCP / gh / token / 预填 URL）
tags: [abap-cli, design-decisions, feedback, github, agent-loop]
created at: 2026-10-31 06:45:00
changed at: 2026-10-31 06:45:00
---

# 013 — 反馈改走 GitHub Issues，删除自建反馈服务

## 决策

CLI 反馈（bug / 缺失能力 / 行为不符预期）统一走仓库的 GitHub Issues，不再在 CLI 内实现反馈通道：

- 删除 `abap feedback` 命令、`src/abap_cli/flows/feedback-flow.ts`、`src/abap_cli/clients/feedback-client.ts`；
- 删除自建反馈服务的 HTTP 契约（`/api/v1/issues`、幂等 key、`Idempotency-Key` / `X-Correlation-ID`、`feedback.example.com` 占位 endpoint），以及仅供它使用的保留错误类别 `CONFLICT`（exit 66）/ `PERSISTENCE_ERROR`（67）/ `HTTP_ERROR`（68）；
- agent 侧改为**能力探测**：GitHub MCP 的建 issue 工具 → `gh issue create` → `GITHUB_TOKEN` / `GH_TOKEN` + REST → 都没有时给用户预填 issue URL（明确未提交）；
- 默认仓库 `chunrichi/abap-cli`（与 `package.json#bugs`、`SUPPORT.md` 一致），用户明确指定别的仓库时优先用户指定；
- 离线 / 无法连 GitHub 时仍用 `abap report-stuck` 本地留档。

## 上下文

- 旧方案是"自己的 issue 服务"：CLI 直接 POST 到部署在 SAP ICF 上的反馈端点，由服务端落 issue、做幂等和重复检测。仓库里没有对应的 ABAP 实现，默认 endpoint 是占位地址，开箱即失败。
- 自建通道的成本：要维护服务端部署、issue 存储、认证、幂等语义、字段长度契约与错误码映射；而反馈的消费方（维护者）本来就在 GitHub 上工作。
- 旧 `abap feedback` 的字段（`feature_key` / `priority` / `username` / `session_id`）只是服务端 issue 的元数据，GitHub issue 正文可以承载同样的信息；GitHub 的 label / assignee / 讨论 / 搜索能力远超自建服务。
- agent 环境差异大：有的有 GitHub MCP，有的有 `gh`，有的只有 `GITHUB_TOKEN`，有的完全没有 GitHub 凭据。硬性要求凭据会让反馈通道对一部分 agent 不可用。

## 被否决方案

- **保留 `abap feedback`，把后端换成 GitHub API**：CLI 要内置 token 解析、认证错误码、幂等去重（GitHub API 没有 idempotency key，只能靠正文 marker + 搜索或本地缓存），复杂度接近自建服务；而 agent 往往已经能直接用 MCP / `gh`，CLI 只是多一层壳。
- **保留命令但只生成预填 URL**：仍然要维护命令面、schema、文档和测试；同样的 URL 拼接逻辑放在 skill 里更薄。
- **自建服务桥接 GitHub**：多一个需要部署的组件，故障面更大。
- **GitHub App / 无状态代理建 issue**：需要托管凭据与额外部署，收益不足以抵消运维成本。

## 当前代价

- 反馈不再结构化：`feature_key` / `priority` / `session_id` 只是正文文本，无法按字段过滤；需要靠 issue 模板、label 和维护者阅读。
- 没有 CLI 侧幂等 / 去重：重复提交依赖 agent 判断；GitHub 搜索能力可以部分补偿。
- 反馈能力依赖 agent 环境：skill 必须做能力探测；没有 GitHub 访问时只能把预填 URL 交给用户，反馈不再"一条命令完成"。
- 预填 URL 有长度限制：标题 / 正文过长需要压缩，或改用 `gh` / MCP。

## 后果

- 命令面 29 → 28 个顶层命令；`skills/abap-cli` 的 `metadata.commands` 只剩 `report-stuck`；`docs/commands.md`、quick refs、wiki 命令索引由生成器重建。
- `error-codes.ts` / `exit-codes.ts` 删除 66–68 三个类别；公共 0–9 与 64 / 65 不变。
- 反馈路径不再经过 CLI 运行时：没有网络失败重试、没有反馈服务 TLS / 认证错误；agent 按 skill 的探测顺序自行选择 MCP / `gh` / token / URL。
- `SUPPORT.md`、README 双语与 `skills/` 的文档同步为 GitHub Issues 流程。

# references

- agent 侧流程：[skills/abap-cli/SKILL.md](../../skills/abap-cli/SKILL.md)（提交反馈一节）
- 用户支持入口：[SUPPORT.md](../../SUPPORT.md)、[CONTRIBUTING.md](../../CONTRIBUTING.md)
- 历史背景：[001 — 三层架构](001-3layer-architecture.md)（CLI 对外契约边界）
