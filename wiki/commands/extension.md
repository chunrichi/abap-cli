---
type: command
title: abap extension
description: 管理内置 ICF ABAP 扩展 — deploy（部署/更新，原 abap deploy）/ status（只读探测安装与版本匹配）
tags: [abap-cli, command, extension, icf, deploy, status, steampunk, btp]
created at: 2026-08-17 00:00:00
changed at: 2026-08-25 00:00:00
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

`deploy`（on-prem / netweaver740+）：

```json
{
  "status": "success",
  "meta": { "command": "abap extension deploy", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 8400, "warnings": [] },
  "data": {
    "objects": [ { "object": "ZCL_ABAP_VIBE_ICF", "type": "CLAS", "status": "updated" } ],
    "files": [ { "file": "abap/src/clas/zcl_abap_vibe_icf.clas.abap", "status": "written" } ],
    "icfNode": { "status": "success", "action": "already_active", "url": "/sap/zabap_vibe", "active": true, "handler": "ZCL_ABAP_VIBE_ICF" },
    "runtime": "netweaver750",
    "deployKind": "full"
  }
}
```

`status`：

```json
{
  "status": "success",
  "meta": { "command": "abap extension status", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 300, "warnings": [] },
  "data": { "installed": true, "status": "current", "remoteVersion": "0.4.0", "expectedVersion": "0.4.0", "match": true, "runtime": "netweaver750", "icfSetupBlocked": false }
}
```

## <a id="steampunk"></a>BTP / Steampunk (030 runtime detection)

`abap extension status` 与 `abap extension deploy` 自动探测目标 SAP 系统的 ADT runtime 层，结果写进 JSON 的 `data.runtime` 字段：

| `runtime`        | 系统形态                                       | `icfSetupBlocked` | `extension deploy` 行为                        |
|------------------|------------------------------------------------|-------------------|------------------------------------------------|
| `netweaver740`   | NETWEAVER 7.40–7.49 on-prem                   | `false`           | full — 调 `ZCL_ABAP_VIBE_ICF_SETUP` 建 SICF 节点 |
| `netweaver750`   | NETWEAVER 7.50+ / S/4HANA on-prem             | `false`           | full — `cl_icf_tree` 路径（同上）               |
| `steampunk`      | BTP ABAP environment（Cloud Foundry）          | `true`            | source-only — CLAS/PROG 照常 deploy；ICF 节点**不**自动注册 |
| `unknown`        | 探测失败 / 端点不可达                          | `false`           | 默认走 on-prem `cl_icf_tree`（保守 fallback）   |

探测来源：

1. `GET /sap/bc/adt/repository/informationsystem`（Atom XML）读 `sap-component` / `sap:rel`
2. 备用 `GET /sap/bc/adt/discovery` 看 workspace 是否声明 `/sap/bc/adt/icf/*` collection

### 为什么 Steampunk 不能自动注册 ICF 节点

BTP ABAP environment 受 SAP Steampunk Released APIs 白名单限制：
- `CL_ICF_TREE`
- `CX_FOR_ICF_TREE`
- `ICFHOSTNUM`

上述 API 在 trial / 生产 Steampunk 上编译时一律 `LA(020)` 拒绝。`ZCL_ABAP_VIBE_ICF_SETUP` 是为 on-prem ECC 设计的（用 `cl_icf_tree` 写 SICF），无法在 Steampunk 激活。

### Steampunk 下的 deploy 输出

```json
{
  "status": "success",
  "data": {
    "objects": [ { "object": "ZCL_ABAP_VIBE_ICF", "type": "CLAS", "status": "updated" } ],
    "files": [ { "file": "abap/src/clas/zcl_abap_vibe_icf.clas.abap", "status": "written" } ],
    "icfNode": { "status": "planned" },
    "runtime": "steampunk",
    "deployKind": "source-only"
  },
  "meta": {
    "warnings": [{
      "code": "STEAMPUNK_ICF_MANUAL",
      "message": "ICF service node cannot be registered automatically on this BTP system; expose the handler via a Cloud Foundry destination.",
      "details": { "runtime": "steampunk" }
    }]
  }
}
```

`deployKind: "source-only"` + `meta.warnings[].code: "STEAMPUNK_ICF_MANUAL"` 表示 **sources 已成功部署，ICF 服务节点需手工暴露**。CLI 不抛错（与 on-prem `cl_icf_tree` 失败行为不同）。

### 把 ICF handler 暴露成 Cloud Foundry destination

Steampunk 下，handler `ZCL_ABAP_VIBE_ICF` 已经被 deploy 到 ABAP 系统上，但要让它对外可达，需要在 SAP BTP Cockpit 里登记一个 destination：

1. **SAP BTP Cockpit** → Cloud Foundry → 你的 space → 你的 ABAP trial
2. **Connectivity → Destinations → New Destination**：
   - `Name`: `zabap_vibe`
   - `Type`: `HTTP`
   - `URL`: `<trial-url>/sap/zabap_vibe`（无尾斜杠）
   - `ProxyType`: `Internet`
   - `Authentication`: `NoAuthentication`（或按你的安全策略）
3. 验证：`curl <trial-url>/sap/zabap_vibe/` → `{"service":"zabap_vibe","version":"<x.y.z>",…}`
4. （可选）绑 route：`cf map-route <app> <domain> --path zabap_vibe`

CLI 也会在 human 输出（不传 `--json`）末尾打印上述步骤的精简版本。

# More

## 关联命令

- [abap init](init.md) — 初始化时信息性 ICF 检查（`data.icf`）
- [abap profile](profile.md) — `profile test` 的 icf 层探测
- [abap doctor](doctor.md) — 本地诊断（报告安装版本）

## references

- 实现: [src/abap_cli/commands/extension.ts](../../src/abap_cli/commands/extension.ts) · [src/abap_cli/icf/service-version.ts](../../src/abap_cli/icf/service-version.ts)
- 文档: [docs/commands.md](../../docs/commands.md)
