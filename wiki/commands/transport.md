---
type: command
title: abap transport
description: 管理 SAP 传输请求（CTS）— list 列当前用户请求 / create 新建（写操作）/ show 查看请求元数据 / resolve 解析对象所属请求 / assign 把对象挂到请求（写操作，已挂则 no-op）/ check 写前预检查询将记录到哪个请求 / release 释放请求（不可逆）；create / assign / release 在非 TTY 需 --yes 或 --dry-run
tags: [abap-cli, command, transport, cts, trkorr, list, create, show, resolve, assign, check, release, dry-run]
created at: 2026-08-07 00:39:21
changed at: 2026-11-01 00:27:00
---

# abap transport

管理 SAP 传输请求（CTS）。七个子命令：`list`（当前用户请求）、`create`（新建）、`show`（请求详情）、`resolve`（对象 → 请求）、`assign`（对象 → 挂请求）、`check`（写前预检查询会记录到哪个请求）、`release`（释放请求，不可逆）。`list` / `show` / `resolve` / `check` 为只读；`create` / `assign` / `release` 为写操作，非 TTY 模式必须 `--yes` 或 `--dry-run` 确认。`create` + `check` + `release` 与 `push` / `create` / `deploy` 的 `--tr` 解析形成完整环：无请求可创建 → 写前确认 → 推送 → 释放。

## Usage

```bash
abap transport list [--open] [--json]
abap transport create <description> [--package <pkg>] [--dry-run] [--yes] [--json]
abap transport show <req> [--json]
abap transport resolve <object> [--json]
abap transport check <object> [--package <pkg>] [--json]
abap transport assign <object> --tr <transport> [--dry-run] [--yes] [--json]
abap transport release <transport> [--ignore-locks] [--ignore-atc] [--dry-run] [--yes] [--json]
abap transport --schema                              # 参数自省（unified envelope，无 SAP 调用）
abap transport --help                                # 唯一的 help 入口
abap transport check --schema                        # 子命令级参数自省
```

裸 `abap transport`（无子命令）是 `USAGE` 失败（exit 2）：`--json` 下 stdout 为空、stderr 单条错误信封（`error.details.help` 指向 `abap transport --help`）。子命令缺必填参数（如 `transport create` 缺 `<description>`、`transport assign` 缺 `--tr`）同样是 `USAGE`，不拼接 help 文本。

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

### `abap transport check <object>`

- `<object>`: 对象名（自动解析 main part，调用 ADT `/cts/transportchecks`）
- `--package <pkg>`: 目标包（缺省由 SAP 从对象推导）
- 只读；输出 `{ object, ok, recording, korrflag, transports[], messages[] }`
- **阻塞不是退出码**：SAP 用 E/A/X 消息拦截时，库会抛异常——CLI 捕获后输出 `ok: false` + `messages[]`，进程仍 exit 0（agent 按 `ok` 分支即可，不需要解析 stderr）
- `recording: "X"` 表示该变更需要记录到请求；`transports[]` 是候选请求

### `abap transport release <transport>`

- `<transport>`: 请求号（如 `DEVK900001`）；空值 → `INVALID_ARGUMENT`（exit 2）
- `--ignore-locks`: 忽略他人锁（SAP override）
- `--ignore-atc`: 忽略 ATC 发现（SAP override）
- `--dry-run`: 只输出计划，零 SAP 调用
- `--yes`: 非交互模式确认；非 TTY 且无 `--yes`/`--dry-run` → `VALIDATION_ERROR`（exit 7）
- **不可逆**：释放后的请求不能再修改；成功输出 `{ transport, released: true, reports[] }`（逐对象 reporter/status/statusText/messages）
- 任一对象 `abortrelapifail` → `SAP_ERROR`（exit 6），`error.details.reports` 带逐条报告；服务端 404 → `NOT_FOUND`（exit 8）、403 → `LOCKED`（exit 9）

## 行为规则

- **写保护（P0.3）**：`create` / `assign` / `release` 与 `push` / `deploy` / `doctor --fix` 同契约 — 非 TTY 拒绝并给 `nextSteps` 指向 `--yes` 或 `--dry-run`；`--dry-run` 零 SAP 调用；TTY 模式无交互 prompt（直接执行）
- **`check` 只读且不因阻塞而失败**：transport-checks 端点对 E/A/X 消息抛异常；CLI 把异常折叠为 `ok: false` + `messages[]`（仍 exit 0），这样 agent 在 `push` 前可以 `check` → 按 `ok` 决定是否继续，而不用解析错误文体
- **`release` 不可逆**：没有 undo；成功只表示 SAP 接受了释放，逐对象结果在 `reports[]`；出现 `abortrelapifail` 时整体以 `SAP_ERROR`（exit 6）失败并把 `reports` 放进 `error.details`，便于 agent 分支重试或修对象
- **`list` 桶结构**：返回 `workbench` + `customizing` 两个桶；每项含 number / description / status / owner。`--open` 只保留 `modifiable`（open）请求，否则 `modifiable + released` 合并
- **`show` 元数据**：请求号 / 描述 / 状态 / owner / 请求内对象列表（name / type / status）。额外含 `tasks: TransportTaskInfo[]`（嵌套 task 列表，每项含 number / description / status / owner / `objects[]`）与 `deduplicated: number`（所有引用数 - 直接对象数；嵌套任务贡献的对象数）；用于 `abap pull --tr <request>` 的去重决策（T4.2）
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

# 写前检查：该变更会记录到哪个请求
abap transport check ZCL_DEMO --json

# 预演释放（不调 SAP）
abap transport release DEVK900001 --dry-run --json

# 释放请求（不可逆，--yes 确认）
abap transport release DEVK900001 --yes --json
```

## Expected Output

`transport list`（`--open` 过滤后可能为空数组，仍 success）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport list", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 300, "warnings": [] },
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
  "meta": { "command": "abap transport create", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 500, "warnings": [] },
  "data": { "transport": "DEVK900123", "description": "My feature work", "package": "$TMP" }
}
```

`transport create`（dry-run，无 SAP 调用）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport create", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 20, "warnings": [] },
  "data": { "transport": null, "description": "My feature work", "package": "ZTMP", "dryRun": true, "ref": "/sap/bc/adt/packages/ZTMP" }
}
```

`transport show`：

```json
{
  "status": "success",
  "meta": { "command": "abap transport show", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 250, "warnings": [] },
  "data": {
    "number": "NDK123456",
    "description": "Mock request 1",
    "status": "D",
    "owner": "MOCKUSER",
    "objects": [
      { "name": "ZCL_DEMO", "type": "CLAS/OC", "status": "Active" },
      { "name": "ZPROG", "type": "PROG/P", "status": "Active" }
    ],
    "tasks": [
      {
        "number": "NDK123457",
        "description": "Sub-task",
        "status": "D",
        "owner": "MOCKUSER",
        "objects": [
          { "name": "ZCL_SUB", "type": "CLAS/OC", "status": "Active" }
        ]
      }
    ],
    "deduplicated": 1
  }
}
```

`deduplicated` = 嵌套任务贡献的对象数（这里 1：ZCL_SUB 由 task 引入但不在请求直接 `objects` 中）；`tasks` 为空数组时 `deduplicated` 为 0。

`transport resolve`：

```json
{
  "status": "success",
  "meta": { "command": "abap transport resolve", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 200, "warnings": [] },
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
  "meta": { "command": "abap transport assign", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 400, "warnings": [] },
  "data": { "object": "ZCL_DEMO", "transport": "NDK123456", "assigned": true }
}
```

```json
{
  "status": "success",
  "meta": { "command": "abap transport assign", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 300, "warnings": [] },
  "data": { "object": "ZCL_DEMO", "transport": "NDK123456", "assigned": false }
}
```

`transport check`（可记录 / 被阻塞两种结果，均 exit 0）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport check", "version": "1.2.0", "timestamp": "2026-11-01T00:20:00.000Z", "durationMs": 220, "warnings": [] },
  "data": {
    "object": "ZCL_DEMO",
    "ok": true,
    "recording": "X",
    "korrflag": "",
    "transports": [
      { "number": "DEVK900001", "status": "D", "owner": "DEV", "text": "Demo request" }
    ]
  }
}
```

```json
{
  "status": "success",
  "meta": { "command": "abap transport check", "version": "1.2.0", "timestamp": "2026-11-01T00:20:00.000Z", "durationMs": 210, "warnings": [] },
  "data": {
    "object": "ZCL_DEMO",
    "ok": false,
    "recording": "",
    "korrflag": "",
    "messages": [{ "severity": "E", "text": "Object is locked by user OTHER" }]
  }
}
```

`transport release`（成功；`released: true` + 逐对象报告）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport release", "version": "1.2.0", "timestamp": "2026-11-01T00:20:00.000Z", "durationMs": 900, "warnings": [] },
  "data": {
    "transport": "DEVK900001",
    "released": true,
    "reports": [
      { "reporter": "ZCL_DEMO", "status": "released", "statusText": "Object released", "messages": [] }
    ]
  }
}
```

`transport release`（预演）：

```json
{
  "status": "success",
  "meta": { "command": "abap transport release", "version": "1.2.0", "timestamp": "2026-11-01T00:20:00.000Z", "durationMs": 15, "warnings": [] },
  "data": { "transport": "DEVK900001", "dryRun": true, "released": false }
}
```

失败（非 TTY 写操作未确认）：

```json
{
  "status": "error",
  "meta": { "command": "abap transport create", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 10, "warnings": [] },
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
  "meta": { "command": "abap transport show", "version": "0.2.0", "timestamp": "2026-08-07T00:39:21.000Z", "durationMs": 200, "warnings": [] },
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

- [ ] `transport list` 在真机上本地请求（`$TMP` create 所得）不出现于 workbench modifiable，但可经 `--tr` 直接使用 — 待文档化该差异
- [ ] `transport release` 的真机证据待补（S/4 测试系统上用一个一次性请求走 `release` → `show` 状态变 R）

# references

- 实现：`src/abap_cli/commands/transport.ts`（commander 声明 + 打印）、`src/abap_cli/flows/core/transport-ops.ts`（`runTransportList/Create/Show/Resolve/Assign/Check/Release` + `showTransport` 嵌套任务展开 + release report 映射）、`src/abap_cli/core/transport.ts`（`resolveTransport`，push/create/deploy 共用）、`src/abap_cli/core/confirmation.ts`
- 文档：`docs/commands.md`（`## abap transport` 章节）
- 测试：`test/unit/transport-metadata.test.ts`（show/resolve/assign 元数据 + 写保护 6 分支）、`test/unit/transport-check-release.test.ts`（check ok/blocked、release 写保护/dry-run/成功/abort 映射/flags 透传）、`test/unit/pull-tr.test.ts`（`--tr` 拉取 + 去重）
- 设计：见 wiki 顶层 `transport-request-management` 历史回顾
