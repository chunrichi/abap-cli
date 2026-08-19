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

- [init](commands/init.md) — 初始化工作区：绑定 profile（写 `.abap.json`）+ 脚手架 agent 上下文
- [profile](commands/profile.md) — 管理全局连接 profiles
- [doctor](commands/doctor.md) — 诊断 CLI 环境
- [pull](commands/pull.md) — 从 SAP 下载对象到本地
- [push](commands/push.md) — 推送本地文件到 SAP
- [run](commands/run.md) — 在 SAP 端执行类（classrun / 静态方法反射），返回 stdout 与退出码
- [activate](commands/activate.md) — 激活对象的所有 inactive items
- [where-used](commands/where-used.md) — 查询对象的直接引用，改动前评估影响面（只读）
- [tcode](commands/tcode.md) — 解析事务码到其 ABAP 入口程序与屏幕（只读）
- [extension](commands/extension.md) — 管理内置 ICF ABAP 扩展（deploy / status）

## Notes

- [SAP 层统一 JSON 生成（/ui2/cl_json）](json-generation.md) — 全 SAP 层唯一 JSON 生成方式（017）
- [外部 CLI 项目学习点](cli-benchmark-learning.md)
- [abap CLI 建议汇总](roadmap.md)

# references
