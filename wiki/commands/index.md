---
type: index
title: Commands
description: abap CLI 命令参考索引
tags: [abap-cli, commands, index]
created at: 2026-08-06 23:10:00
changed at: 2026-08-07 00:39:21
---

# Commands

按命令逐个维护的知识页。每条命令独立成文，遵循统一格式（Usage / Options / Examples / Expected Output）。

## Setup & 环境

- [init](init.md) — 初始化工作区：绑定 profile（写 `.abap.json`）与/或脚手架 agent 上下文（`--agent`）；裸 `init` 为交互向导
- [profile](profile.md) — 管理全局连接 profiles（增删改查、测试、导入导出）
- [doctor](doctor.md) — 诊断 CLI 环境（环境 / 配置 / 连接三段检查，支持 `--fix`）
- [pull](pull.md) — 从 SAP 下载对象到本地（源码 / 包批量 / DDIC JSON / textpool / 远程版本）
- [push](push.md) — 推送本地文件到 SAP（源码 / FUGR / textpool / DDIC JSON，按对象解析 transport）
- [run](run.md) — 在 SAP 端执行类（classrun / 静态方法反射），返回 stdout 与退出码（push → run → 验证闭环）
- [activate](activate.md) — 激活对象的所有 inactive items（method/OSI 层级，规避 root-URI 静默 no-op）

## 创建

- [create](create.md) — 在 SAP 创建新对象并激活（源对象走 ADT / DDIC `--file` 走 ICF；`--template`/`--no-activate`/`--check-only`；`--schema` 自省；`create local` 离线草稿）

## 校验

- [check](check.md) — 校验本地 ABAP 文件（子命令 `syntax` 对 SAP / `content` 本地 / `atc` ATC；`--out` 持久化原始 ATC worklist）

## 搜索

- [search](search.md) — 在 SAP 中按名称搜索 ABAP 对象（通配符 / 类型与包过滤 / 精确匹配 / 全量抓取）

## 传输管理

- [transport](transport.md) — 管理 SAP 传输请求（list / create / show / resolve / assign；create 与 assign 为写操作，非 TTY 需 `--yes` 或 `--dry-run`）

## 扩展

- [extension](extension.md) — 管理内置 ICF ABAP 扩展（deploy 部署 / status 只读探测版本匹配）

# references
