---
type: index
title: Commands
description: abap CLI 命令参考索引
tags: [abap-cli, commands, index]
created at: 2026-08-06 23:10:00
changed at: 2026-09-03 17:00:00
---

# Commands

按命令逐个维护的知识页。每条命令独立成文，遵循统一格式（Usage / Options / Examples / Expected Output）。

## Setup & 环境

- [init](init.md) — 工作区的唯一入口：首次绑定（写 `.abap.json`） / 修改字段（`--profile` `--tr` `--package` `--source-dir`，merge 不替换） / 自省（`--show-config`） / 清空（`--unset-package` `--unset-tr` `--unset-source-dir`） / 脚手架 agent 上下文（`--agent`）；裸 `init` 为交互向导
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

## 搜索与探查

- [search](search.md) — 在 SAP 中按名称搜索 ABAP 对象（通配符 / 类型与包过滤 / 精确匹配 / 全量抓取）
- [where-used](where-used.md) — 查询对象的直接引用（where-used list），改动前评估影响面；只读，走 ADT `usageReferences`
- [tcode](tcode.md) — 解析事务码到其配置的 ABAP 入口程序与屏幕；只读，走 ICF `/tcode/<code>`（TSTC → TSTCT）

## 传输管理

- [transport](transport.md) — 管理 SAP 传输请求（list / create / show / resolve / assign；create 与 assign 为写操作，非 TTY 需 `--yes` 或 `--dry-run`）

## 扩展

- [extension](extension.md) — 管理内置 ICF ABAP 扩展（deploy 部署 / status 只读探测版本匹配）
- [extensions](extensions.md) — 管理第三方扩展：list（只读列状态 + lockfile 状态）/ [lock](extensions-lock.md)（027 信任硬化：算 / 刷新 `extensions.lock.json`，npm 扩展 sha512 钉死；`--allow-unsigned` 首次必填）

## MIME 资源

- [mime](mime.md) — 创建 / 删除 / 上传 SAP MIME Repository 资源（SE80 存储库；走自建 ICF `dispatch_mime`）

## 搜索与探查（增量）

> 详见 [wiki/index.md#搜索与探查](../index.md) — 本索引只列命令；`diff` / `status` / `inspect` / `select` / `dumps` 在该分组：

- [inspect](inspect.md) — 只读对象元数据（structure / includes / locks / activation / package）
- [status](status.md) — 本地 vs SAP 差异（changed parts）
- [diff](diff.md) — 本地 ↔ SAP 按 part 对比（只读）
- [select](select.md) — 表数据只读查询（SE16N 等价）
- [dumps](dumps.md) — 近期 ST22 ABAP runtime dump 摘要（只读，走 ADT Atom feed）

## 跨命令契约

- [path-output](path-output.md) — `--json` 输出路径统一 POSIX（`/`），Windows / Linux / macOS Agent 消费到同一结构；边界 helper `toOutputPath` / `toOutputJoin` / `normalizePullData`

# references
