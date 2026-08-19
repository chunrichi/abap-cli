---
type: index
title: abap CLI Wiki
description: abap CLI 知识库首页 — 命令参考、学习记录与路线图
tags: [abap-cli, wiki, index]
created at: 2026-08-06 23:10:00
changed at: 2026-08-19 23:00:00
---

# abap CLI Wiki

面向 Agent 与开发者的 abap CLI 知识库。命令参考按 okf 格式维护。

## Commands

### Setup & 环境

- [init](commands/init.md) — 工作区的唯一入口：首次绑定（写 `.abap.json`） / 修改字段 / 自省（`--show-config`） / 清空（`--unset-*`） / 脚手架 agent 上下文
- [profile](commands/profile.md) — 管理全局连接 profiles
- [doctor](commands/doctor.md) — 诊断 CLI 环境
- [extension](commands/extension.md) — 管理内置 ICF ABAP 扩展（deploy / status）

### 创建 / 拉取 / 推送

- [create](commands/create.md) — 在 SAP 创建新对象并激活（源对象走 ADT / DDIC 三件套走 ICF；`create local` 离线草稿）
- [pull](commands/pull.md) — 从 SAP 下载对象到本地（源码 / 包批量 / DDIC JSON / textpool / 远程版本）
- [push](commands/push.md) — 推送本地文件到 SAP（源码 / FUGR / textpool / DDIC JSON，按对象解析 transport）

### 校验

- [check](commands/check.md) — 校验本地 ABAP 文件（子命令 `syntax` / `content` / `atc`）

### 搜索与探查

- [search](commands/search.md) — 在 SAP 中按名称搜索 ABAP 对象
- [inspect](commands/inspect.md) — 只读对象元数据探测（结构 / include / 锁 / 激活状态）
- [where-used](commands/where-used.md) — 查询对象的直接引用，改动前评估影响面（只读）
- [tcode](commands/tcode.md) — 解析事务码到其 ABAP 入口程序与屏幕（只读）
- [diff](commands/diff.md) — 本地 ↔ SAP 按 part 对比（只读）
- [status](commands/status.md) — 本地 vs SAP 差异（changed parts）

### 执行与数据查询（只读）

- [run](commands/run.md) — 在 SAP 端执行类（classrun / 静态方法反射），返回 stdout 与退出码
- [select](commands/select.md) — 表数据只读查询（SE16N 等价，走 ICF `/data/query`）
- [activate](commands/activate.md) — 激活对象的所有 inactive items（method/OSI 层级）

### 传输管理

- [transport](commands/transport.md) — 管理 SAP 传输请求（list / create / show / resolve / assign）

## Notes

- [SAP 层统一 JSON 生成（/ui2/cl_json）](json-generation.md) — 全 SAP 层唯一 JSON 生成方式（017）
- [外部 CLI 项目学习点](cli-benchmark-learning.md)
- [abap CLI 建议汇总](roadmap.md)
- [abap-file-format 导出与兼容](abap-file-format-export.md)

# references
