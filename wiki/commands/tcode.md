---
type: command
title: abap tcode
description: 只读解析事务码到其配置的 ABAP 入口程序与屏幕 — 走 ICF /tcode/<code> 端点（TSTC → TSTCT）
tags: [abap-cli, command, tcode, tstc, icf, read-only, agent-loop]
created at: 2026-08-19 23:00:00
changed at: 2026-08-19 23:00:00
---

# abap tcode

把事务码解析成它背后的 **ABAP 入口程序 + 屏幕号**，让 agent 在只有事务码线索时（用户截图、错误消息、需求描述里的 `SE38`）能直接拿到可读可改的程序名，接上 `pull` / `inspect` / `where-used`。

严格只读：不获取锁、不触发 transport、不激活、不修改任何 SAP 数据。走 013 自建 ICF 服务的 `GET /sap/zabap_vibe/tcode/<code>` 端点，SAP 端读 TSTC（事务定义）+ TSTCT（描述文本），并做 `S_TCODE` 权限检查。

## Usage

```bash
abap tcode <tcode> [--json]
abap tcode --schema [--json]
```

## Options

- `<tcode>`（必填）: SAP 事务码，≤ 20 字符（TCODE 域为 CHAR20）。自动 trim + 大写。命名空间事务码（含 `/`，如 `/ABC/MYTCODE`）合法。不传则打印 help。
- `--schema`: 打印机器可读命令 schema（arguments / options / errors）为 JSON 并 exit 0，**零 SAP 调用**。
- `--json`: 全局 flag——输出 012 统一 JSON 信封；失败时 stdout 严格为空。

本地校验（不发请求即拒绝）：空值 / 纯空白 / 含空格（如误传 `/nSE38` 之外的 `SE 38`）/ 超 20 字符 → `INVALID_ARGUMENT`。

## Examples

```bash
# 标准事务码
abap tcode SE38

# 自定义事务码，结构化输出给 agent 消费
abap tcode ZMY_TRANSACTION --json

# 自省参数契约，不连 SAP
abap tcode --schema --json
```

## Expected Output

成功信封：

```jsonc
{
  "status": "success",
  "meta": { "command": "abap tcode", "version": "0.2.0", "timestamp": "...", "durationMs": 42, "warnings": [] },
  "data": {
    "tcode": "SE38",
    "description": "ABAP Editor",
    "entry": { "program": "SAPMS38M", "screen": "0100" },
    "target": { "kind": "program", "name": "SAPMS38M", "resolved": true },
    "resolutionState": "entry_only",
    "resolutionChain": []
  }
}
```

人类模式（默认）：

```text
SE38: ABAP Editor
entry:      SAPMS38M screen 0100
target:     program SAPMS38M
resolution: entry_only
```

字段语义：

| 字段 | 含义 |
|---|---|
| `entry.program` / `entry.screen` | TSTC 中登记的入口程序与屏幕号 |
| `target.kind` / `target.name` | 归一化后的跳转目标；默认与 `entry.program` 一致 |
| `target.resolved` | 目标是否已完全解析；参数-事务等间接类型为 `false` |
| `resolutionState` | 本版本统一为 `entry_only`（见下方边界） |
| `resolutionChain` | 多跳解析链；本版本通常为空数组 |

> ⚠️ **耗时不在 data 里**：`durationMs` 只出现在 `meta` 中（022 token-efficient 信封约定）——早期分支实现曾在 `data` 里重复一份，已移除。

## 错误码

| 错码 | Category / exit | 触发 | 修复建议 |
|------|-----------------|------|----------|
| `TCODE_NOT_FOUND` | NOT_FOUND / 8 | TSTC 中无此事务码 | SE93 校对；确认在当前系统/client 有效 |
| `TCODE_NOT_AUTHORIZED` | AUTH_ERROR / 5 | `S_TCODE` 权限检查未通过 | 申请该事务码的查看授权；SU53 / PFCG 核对角色 |
| `INVALID_ARGUMENT` | USAGE / 2 | 空 / 含空白 / 超 20 字符 | 只传事务码本身，去掉 `/n` 等 GUI 前缀 |
| `SAP_ERROR` | SAP_ERROR / 6 | ICF 未知错码，或响应缺 `entry.program` | `abap deploy` 升级服务；`abap doctor` 查连接 |

## v1 边界

- **参数-事务 / 变式事务 / 报表事务不做多跳展开**：TSTC 只给出直接入口，间接类型统一报 `resolutionState: "entry_only"`，`resolutionChain` 不展开。需要完整链路时用 SE93 人工确认。
- 不解析事务码的授权对象、GUI 属性、启动参数。
- 不支持批量查询（一次一个事务码）。

## 关联命令与流程

典型 agent 闭环 —— 从"用户只给了一个事务码"到"定位并修改代码"：

```bash
abap tcode ZMY_TRANSACTION --json     # → entry.program = ZPROG_FOO
abap pull ZPROG_FOO --type PROG       # 拉到本地
abap where-used ZPROG_FOO --json      # 谁引用了它（影响面）
```

- [pull](pull.md) — 拿到 `entry.program` 后下载源码
- [where-used](where-used.md) — 对入口程序做影响分析
- [inspect](inspect.md) — 查该程序的元数据与激活状态
- [deploy](deploy.md) — `deploy` 部署含 `/tcode` 端点的 `ZCL_ABAP_VIBE_ICF`

## 版本与服务依赖

- **CLI 版本**: 0.2.0（含 `tcode` 命令）。
- **ICF 服务**: `ZCL_ABAP_VIBE_ICF` 的 `dispatch_tcode` / `read_tcode`（GET only）。`abap deploy` 部署后可用；`abap doctor` 探测版本匹配。
