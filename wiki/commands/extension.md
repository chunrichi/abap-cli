---
type: command
title: abap extension
description: 管理内置 ICF ABAP 扩展 — deploy（部署/更新，原 abap deploy）/ status（只读探测安装与版本匹配）
tags: [abap-cli, command, extension, icf, deploy, status]
created at: 2026-08-17 00:00:00
changed at: 2026-08-17 00:00:00
---

# abap extension

管理内置 ICF ABAP 扩展（021 — 原 `abap deploy` 迁入 `extension deploy`，新增 `extension status`）。

## Usage

```bash
abap extension deploy [options]   # 部署 / 更新 /sap/zabap_vibe ICF 服务
abap extension status [options]   # 只读探测：已安装？版本匹配？
```

## `abap extension deploy`

把捆绑的源码对象（`abap/src/`）推送到 SAP，然后触发 ICF 设置类（`ZCL_ABAP_VIBE_ICF_SETUP`，ADT classrun）创建/绑定/激活 `/sap/zabap_vibe` SICF 节点（幂等）。

### Options

- `--tr <transport>`: transport 号（`--package` 非 `$TMP` 时必填）
- `--package <package>`: 目标包（默认 `$TMP`——本地对象，无需 transport）
- `--dry-run`: 仅计划，零 SAP 变更调用
- `--diff`: 逐文件差异摘要
- `--force`: 绕过安全检查（结果 `forced: true`）
- `--yes`: 非交互确认

### 行为规则

- `--package` 非 `$TMP` 且无 `--tr` → `NO_TRANSPORT`（exit 7 类）
- transport 解析链：`--tr` > 项目配置 > 用户可改请求
- 自动创建 SAP 上不存在的捆绑对象（`objects` 数组：`created | updated | unchanged | failed`）
- 设置失败 → 结构化 `SAP_ERROR`（exit 6）
- `--dry-run` 报 `icfNode.status: "planned"` 而不触发设置

## `abap extension status`

只读探测 SAP 侧 ICF 服务：读 `/sap/zabap_vibe` 根端点的 `version` 字段，与捆绑版本（`ICF_SERVICE_VERSION`）比对。永不修改 SAP。

### 行为规则

- 结果 `{ installed, status, remoteVersion, expectedVersion, match }`
- `status` ∈ `not_deployed`（404）| `current` | `outdated` | `unreachable`（非 404 异常）
- `not_deployed` / `outdated` → hint `abap extension deploy`
- `unreachable` → 降级为 `meta.warnings` 条目，不崩溃
- **边界**：`extension status` 查 SAP 侧；`abap doctor` 查本地（环境 / 配置 / profile 可达性）

## Examples

```bash
# 部署（$TMP，无需 transport）
abap extension deploy --yes

# 预览 + 差异
abap extension deploy --dry-run --diff

# 部署到正式包
abap extension deploy --package ZABAP_VIBE --tr DEVK900001 --yes

# 探测状态
abap extension status --json
```

## Expected Output

`deploy`：

```json
{
  "status": "success",
  "meta": { "command": "abap extension deploy", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 8400, "warnings": [] },
  "data": {
    "objects": [ { "object": "ZCL_ABAP_VIBE_ICF", "type": "CLAS", "status": "updated" } ],
    "files": [ { "file": "abap/src/clas/zcl_abap_vibe_icf.clas.abap", "status": "written" } ],
    "icfNode": { "status": "success", "action": "already_active", "url": "/sap/zabap_vibe", "active": true, "handler": "ZCL_ABAP_VIBE_ICF" }
  }
}
```

`status`：

```json
{
  "status": "success",
  "meta": { "command": "abap extension status", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 300, "warnings": [] },
  "data": { "installed": true, "status": "current", "remoteVersion": "0.4.0", "expectedVersion": "0.4.0", "match": true }
}
```

# More

## 关联命令

- [abap init](init.md) — 初始化时信息性 ICF 检查（`data.icf`）
- [abap profile](profile.md) — `profile test` 的 icf 层探测
- [abap doctor](doctor.md) — 本地诊断（报告安装版本）

## references

- 实现: [src/abap_cli/commands/extension.ts](../../src/abap_cli/commands/extension.ts) · [src/abap_cli/icf/service-version.ts](../../src/abap_cli/icf/service-version.ts)
- 文档: [docs/commands.md](../../docs/commands.md)
