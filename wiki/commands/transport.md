---
type: command
title: abap transport
description: 管理 SAP 传输请求（CTS）— list 列当前用户请求 / create 新建（写操作）/ show 查看请求元数据 / resolve 解析对象所属请求 / assign 把对象挂到请求（写操作，已挂则 no-op）；create 与 assign 在非 TTY 需 --yes 或 --dry-run
tags: [abap-cli, command, transport, cts, trkorr, list, create, show, resolve, assign, dry-run]
created at: 2026-08-07 00:39:21
changed at: 2026-08-07 00:39:21
---

# abap transport

管理 SAP 传输请求（CTS）。五个子命令：`list`（当前用户请求）、`create`（新建）、`show`（请求详情）、`resolve`（对象 → 请求）、`assign`（对象 → 挂请求）。`list` / `show` / `resolve` 为只读；`create` / `assign` 为写操作，非 TTY 模式必须 `--yes` 或 `--dry-run` 确认。`create` 与 `push` / `create` / `deploy` 的 `--tr` 解析形成闭环：无请求可创建，创建后即可用 `--tr` 推送。

## Usage

```bash
abap transport list [--open] [--json]
abap transport create <description> [--package <pkg>] [--dry-run] [--yes] [--json]
abap transport show <req> [--json]
abap transport resolve <object> [--json]
abap transport assign <object> --tr <transport> [--dry-run] [--yes] [--json]
```

## Options

### `abap transport list`

- `--open`: 只显示 open（未释放 / modifiable）请求；缺省同时包含 released
- 空结果仍为 success（exit 0）

### `abap transport create`

- `<description>`: 请求描述（必填，空白 → `INVALID_ARGUMENT`，exit 2）
- `--package <package>`: 目标 SAP 包（默认 `$TMP`，即本地请求）
- `--dry-run`: 只输出计划，不做任何 SAP 调用（`{ transport: null, package, ref, dryRun: true }`）
- `--yes`: 非交互模式确认写操作；非 TTY 且无 `--yes`/`--dry-run` → `VALIDATION_ERROR`（exit 7）
- 失败 → `TRANSPORT_CREATE_FAILED`（exit 7）

### `abap transport show <req>`

- `<req>`: 请求号（如 `NDK123456`）
- 404 → `NOT_FOUND`（exit 8）；403 → `LOCKED`（exit 9）

### `abap transport resolve <object>`

- `<object>`: 对象名（自动解析 main part，读 `transportInfo`）

### `abap transport assign <object>`

- `<object>`: 对象名
- `--tr <transport>`: 目标请求号（必填）
- `--dry-run`: 只输出计划，不写 SAP（`{ object, transport, assigned: false, dryRun: true }`）
- `--yes`: 非交互模式确认；非 TTY 且无 `--yes`/`--dry-run` → `VALIDATION_ERROR`（exit 7）
- 403 → `LOCKED`（exit 9）

## 行为规则

- **写保护（P0.3）**：`create` / `assign` 与 `push` / `deploy` / `sync` / `doctor --fix` 同契约 — 非 TTY 拒绝并给 `nextSteps` 指向 `--yes` 或 `--dry-run`；`--dry-run` 零 SAP 调用；TTY 模式无交互 prompt（直接执行）
- **`list` 桶结构**：返回 `workbench` + `customizing` 两个桶；每项含 number / description / status / owner。`--open` 只保留 `modifiable`（open）请求，否则 `modifiable + released` 合并
- **`show` 元数据**：请求号 / 描述 / 状态 / owner / 请求内对象列表（name / type / status）
- **`resolve` 只读**：`resolveObject` → `getObjectParts` 取 main part 的 `transportInfo`，返回该对象当前所属的全部请求（可能多个）
- **`assign` 机制**：把对象当前源码以目标请求作 `corrNr` 写回（lock → `setObjectSource` → unlock）；已挂到目标请求 → no-op（`assigned: false`）。unlock 失败仅告警不失败
- **解析顺序（其他命令共用）**：`--tr` > `.abap.json` transport > 用户第一个 modifiable 请求 > `NO_TRANSPORT`（exit 7）；`$TMP` 下对象免 transport（transport-free）
- **闭环**：`create` 返回的请求号可直接用于 `push` / `create` / `deploy` 的 `--tr`，无需 SAP GUI

## Examples

```bash
# 列出当前用户全部请求（workbench + customizing）
abap transport list

# 只看未释放的请求
abap transport list --open

# 非交互创建请求（--yes 确认；默认 $TMP 本地请求）
abap transport create "My feature work" --yes

# 预演创建计划（不连 SAP）
abap transport create "My feature work" --package ZPKG --dry-run

# 查看某请求的详情与包含对象
abap transport show NDK123456

# 解析某对象当前属于哪些请求
abap transport resolve ZCL_DEMO

# 把对象挂到请求（已挂则 no-op）
abap transport assign ZCL_DEMO --tr NDK123456 --yes

# 预演挂载
abap transport assign ZCL_DEMO --tr NDK123456 --dry-run
```

## Expected Output

`transport list`（`--open` 过滤后可能为空数组，仍 success）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport list", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 300, "warnings": [] },
  "data": {
    "workbench": [
      { "number": "DEVK900001", "description": "My feature work", "status": "D", "owner": "DEV" }
    ],
    "customizing": []
  }
}
```

`transport create`（成功）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport create", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 500, "warnings": [] },
  "data": { "transport": "DEVK900123", "description": "My feature work", "package": "$TMP" }
}
```

`transport create`（dry-run，无 SAP 调用）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport create", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 20, "warnings": [] },
  "data": { "transport": null, "description": "My feature work", "package": "ZTMP", "dryRun": true, "ref": "/sap/bc/adt/packages/ZTMP" }
}
```

`transport show`：

```json
{
  "status": "success",
  "meta": { "command": "abap transport show", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 250, "warnings": [] },
  "data": {
    "number": "NDK123456",
    "description": "Mock request 1",
    "status": "D",
    "owner": "MOCKUSER",
    "objects": [
      { "name": "ZCL_DEMO", "type": "CLAS/OC", "status": "Active" },
      { "name": "ZPROG", "type": "PROG/P", "status": "Active" }
    ]
  }
}
```

`transport resolve`：

```json
{
  "status": "success",
  "meta": { "command": "abap transport resolve", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 200, "warnings": [] },
  "data": {
    "object": "ZCL_DEMO",
    "transports": [
      { "number": "NDK123456", "status": "D", "owner": "MOCKUSER", "text": "Mock request 1" }
    ]
  }
}
```

`transport assign`（成功 / no-op）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport assign", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 400, "warnings": [] },
  "data": { "object": "ZCL_DEMO", "transport": "NDK123456", "assigned": true }
}
```

```json
{
  "status": "success",
  "meta": { "command": "abap transport assign", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 300, "warnings": [] },
  "data": { "object": "ZCL_DEMO", "transport": "NDK123456", "assigned": false }
}
```

失败（非 TTY 写操作未确认）：

```json
{
  "status": "error",
  "meta": { "command": "abap transport create", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 10, "warnings": [] },
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "VALIDATION_ERROR",
    "message": "transport create is a write operation; confirm with --yes or pass --dry-run.",
    "details": { "nextSteps": ["Re-run with --yes to actually create the transport.", "Or pass --dry-run to preview the request without creating it."], "example": "abap transport create \"<description>\" --yes" }
  }
}
```

失败（请求不存在，`show`）：

```json
{
  "status": "error",
  "meta": { "command": "abap transport show", "version": "0.1.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 200, "warnings": [] },
  "error": {
    "code": "NOT_FOUND",
    "category": "NOT_FOUND",
    "message": "Transport request Z_NOPE not found",
    "details": { "nextSteps": ["List your requests: 'abap transport list'", "Create one: 'abap transport create <description>'"], "example": "abap transport show NDK123456" }
  }
}
```

# More

## fixme

- [ ] `transport list` 缺少 `--mine/--all` 过滤（roadmap §一 transport 行待补）

## todo

- [ ] 补充 `abap transport release <req>` 释放能力，闭合传输生命周期（roadmap §一 transport 行、§二 `abap release`）
- [ ] `transport list` 在真机上本地请求（`$TMP` create 所得）不出现于 workbench modifiable，但可经 `--tr` 直接使用 — 待文档化该差异

# references

- 实现：`src/abap_cli/commands/transport.ts`、`src/abap_cli/flows/transport-ops.ts`、`src/abap_cli/core/transport.ts`（`resolveTransport`，push/create/deploy 共用）
- 文档：`docs/commands.md`（`## abap transport` 章节）
- 测试：`test/unit/transport-metadata.test.ts`（show/resolve/assign 元数据 + 写保护 6 分支）
- 设计：`specs/006-transport-request-management/`
