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

**不确定 CLI 能处理什么对象？先看 [支持的对象类型](object-types.md)** — 类型码 × 命令 × 路由矩阵。

## Commands

### Setup & 环境

- [init](commands/init.md) — 工作区的唯一入口：首次绑定（写 `.abap.json`） / 修改字段 / 自省（`--show-config`） / 清空（`--unset-*`） / 脚手架 agent 上下文
- [profile](commands/profile.md) — 管理全局连接 profiles
- [doctor](commands/doctor.md) — 诊断 CLI 环境
- [extension](commands/extension.md) — 管理内置 ICF ABAP 扩展（deploy / status）
- [extensions](commands/extensions.md) — 管理第三方扩展（list 探测 / lock 钉 hash；027 信任硬化）

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

### 跨命令契约

- [支持的对象类型](object-types.md) — 9 个类型 × 命令 × 路由（ADT / ICF）总览；SICF 节点对应类型码 `HTTP`
- [output path contract](commands/path-output.md) — `--json` 路径字段统一 POSIX，跨平台 Agent 消费稳定

## Notes

- [SAP 层统一 JSON 生成（/ui2/cl_json）](json-generation.md) — 全 SAP 层唯一 JSON 生成方式（017）
- [外部 CLI 项目学习点](cli-benchmark-learning.md)
- [abap CLI 建议汇总](roadmap.md)
- [abap-file-format 导出与兼容](abap-file-format-export.md)
- [ADT 前台控制器与发现矩阵 — SAP S/4HANA 2023 SP02](adt-front-controller-s4h-2023.md) — `CL_ADT_WB_RES_APP` 职责、本系统 `/sap/bc/adt/discovery` 暴露的 80 个 workspace / 763 个 collection 矩阵与 CLI 覆盖度映射；姊妹页（ECC 等）按版本后缀追加

### ADT 发现矩阵的姊妹页（待补）

按版本族后缀追加，命名规则 `adt-front-controller-<version>.md`：

| 占位文件名 | 目标版本族 | 触发条件 |
|---|---|---|
| `adt-front-controller-s4h-2023.md` | S/4HANA 2023 SP02（kernel 793 / NW 7.58） | ✅ 已落版 |
| `adt-front-controller-ecc-ehp7.md` | ECC 6.0 EHP7（NW 7.40） | 当有 on-prem ECC 沙盒（URL ≠ 当前 s4h）时拉一次 discovery 即落 |
| `adt-front-controller-ecc-ehp8.md` | ECC 6.0 EHP8（NW 7.50） | 同上 |

ECC 版落版时预期差异（参考，待实际核对）：
- 缺 CDS 整族（`ABAP DDL Sources` / `ABAP DCL Sources` / `CDS Annotation*` / `Service Definitions / Bindings`）
- 缺 HANA-only 集（`HDI Namespace` / `HANA-Integration` / `DB Procedure Proxies`）
- CTS 路径走 `/sap/bc/adt/wb/transport/...`，与 S/4HANA 的 `/sap/bc/adt/cts/...` 不同
- Debugger / Profiler collection 数略少（无 AMDP 调试、无 CDS 测试代码生成）

新增时需同步：
1. 在本节 Notes 上方添加新链接
2. 在 [`.gitignore`](../../.gitignore) `wiki/*` 白名单补一行 `!wiki/adt-front-controller-<version>.md`
3. 在新页 frontmatter `title` 字段补版本号；正文 § 适用 SAP 版本 表格填实际探测值

# references
