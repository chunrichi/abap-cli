---
type: command
title: abap run
description: 在 SAP 端执行 ABAP 类（classrun）或静态方法（runner wrapper），返回 stdout、业务退出码与耗时 — Agent 的 push → run → 验证闭环
tags: [abap-cli, command, run, classrun, execute, verification, runner, agent-loop]
created at: 2026-08-07 22:30:00
changed at: 2026-08-07 22:44:00
---

# abap run

在 SAP 端**真正执行**一个 ABAP 类并捕获其 stdout，让 Agent 从"只能编译（check / ATC / inspect）"跨到"运行验证"。两条路由：

1. **classrun**（无 `--method`）：触发目标类的 `if_oo_adt_classrun~main`（ADT classrun 端点 `/sap/bc/adt/oo/classrun/<name>`），stdout 原样返回。
2. **wrapper**（`--method <name>`）：运行 bundled 的 `ZCL_ABAP_VIBE_RUNNER`，经 RTTS 反射调用目标类的 PUBLIC STATIC 方法（IMPORTING + RETURNING），返回值经 `/ui2/cl_json` JSON 化输出。

`abap run` 是**严格只读**命令——不获取锁、不触发 transport、不激活、不写文件。wrapper 类由 `abap deploy` 安装（缺失时报 `WRAPPER_NOT_DEPLOYED`）。

## Usage

```bash
abap run [options] <class-name>
abap run --schema [--json]
```

## Options

- `<class-name>`: 目标 ABAP 全局类名（regex `^[A-Za-z][A-Za-z0-9_~]{0,29}$`；含 `~` 的本地类运行时被拒绝为 `LOCAL_CLASS_NOT_RUNNABLE`）
- `--method <name>`: PUBLIC STATIC 方法名（regex `^[A-Za-z_][A-Za-z0-9_]*$`）。省略则走直接 classrun。
- `--args <json>`: JSON 对象，按字段名映射到方法 IMPORTING 参数（大小写不敏感）。默认 `{}`。
- `--timeout <ms>`: 执行超时（100–600000，默认 30000）。wrapper 路径由 SAP 端 `cl_abap_runtime` deltas 主动检查；classrun 路径依赖 ADT 端点服务端超时，CLI 侧 `AbortController` 兜底 `--timeout + 5000ms`。
- `--dry-run`: 仅打印请求信封（`wouldRun: true`），零 ADT classrun 调用。
- `--schema`: 打印机器可读命令 schema（arguments/options/exclusive/examples/errors）为 JSON 并 exit 0——零 SAP 调用。
- `--json`: 全局 flag——输出 012 统一 JSON 信封（失败时 stdout 严格为空，P1.7）。

## 路由与布局

| 条件 | 路由 | 行为 |
|------|------|------|
| 无 `--method` | classrun | `AdtClientWrapper.runClass(className)` → stdout 原样返回 |
| 有 `--method` | wrapper | `runClass('ZCL_ABAP_VIBE_RUNNER', params)` → SAP 端反射调用目标方法 |

本地类（类名含 `~`）在任何路由前被 CLI 拒绝（`LOCAL_CLASS_NOT_RUNNABLE`）。v1 仅支持 `CLAS`；PROG/INTF/FUGR/TABL 延后到 P2 子特性（无 `--type` 选项）。

## 输出契约

成功信封 `{ status: 'success', meta, data }`：

| 字段 | 说明 |
|------|------|
| `data.route` | `classrun` \| `wrapper` —— 本次执行路径（Agent 可分支处理） |
| `data.output` | classrun stdout 原文（trim） |
| `data.parsed` | `output` 的 JSON 解析结果；非 JSON 文本时为 `null` |
| `data.exitCode` | classrun JSON 内嵌的业务退出码（默认 0）；**不等于** CLI 进程退出码 |
| `data.durationMs` | 请求耗时（ms） |
| `data.wouldRun` | 仅 `--dry-run` 时为 `true` |

失败信封 `{ status: 'error', meta, error }`；`--json` 模式下 stdout 严格为空（P1.7），错误信封在 stderr，人类模式 `Error:` + `nextSteps` 也在 stderr。

## 错误码（015 新增）

| Code | Category / exit | 触发 |
|------|-----------------|------|
| `METHOD_FAILED` | VALIDATION_ERROR / 7 | 目标方法在 SAP 端抛 `cx_root` |
| `METHOD_NOT_SUPPORTED` | VALIDATION_ERROR / 7 | 方法签名不适配（CHANGING/TABLES/instance/private/deep） |
| `CLASS_NOT_RUNNABLE` | VALIDATION_ERROR / 7 | 类未实现 `if_oo_adt_classrun~main`（含 SAP 纯文本 `does not implement`） |
| `OBJECT_NOT_ACTIVE` | SAP_ERROR / 6 | 类未激活 → `abap activate <class>`（含 SAP 纯文本 `is inactive`） |
| `LOCAL_CLASS_NOT_RUNNABLE` | SAP_ERROR / 6 | 类名含 `~`（本地类） |
| `TIMEOUT` | SAP_ERROR / 6 | 超过 `--timeout` → 检查 SM51 |
| `WRAPPER_NOT_DEPLOYED` | NOT_FOUND / 8 | `ZCL_ABAP_VIBE_RUNNER` 缺失 → `abap deploy` |
| `WRAPPER_INPUT_UNAVAILABLE` | SAP_ERROR / 6 | SAP classrun 端点不注入 `--method` 参数（系统限制）→ 改用直接 classrun |

**纯文本 SAP 错误识别（真实 SAP 验证）**：SAP 对部分失败模式返回纯文本而非 JSON 信封，CLI 会识别并映射为结构化错误：
- `Object X does not exist.` → `OBJECT_NOT_FOUND`（NOT_FOUND/8）
- `Error: Class does not implement if_oo_adt_classrun~main method!` → `CLASS_NOT_RUNNABLE`
- `is inactive` → `OBJECT_NOT_ACTIVE`
- `locked by / currently editing` → `LOCKED`

## Examples

```bash
# 直接 classrun（目标类须实现 if_oo_adt_classrun~main）
abap run ZCL_MY_THING

# 静态方法反射调用（走 ZCL_ABAP_VIBE_RUNNER）
abap run ZCL_MY_HELPER --method compute --args '{"x":3,"y":5}'

# Dry-run：零 SAP 调用，仅打印请求信封
abap run ZCL_LONG_RUN --timeout 60000 --dry-run

# Agent 集成：机器可解析信封
abap run ZCL_FOO --method bar --args '{}' --json

# 命令 schema 自省（零 SAP）
abap run --schema --json
```

## Expected Output

```json
{
  "status": "success",
  "meta": {
    "command": "abap run",
    "version": "0.1.0",
    "timestamp": "2026-08-07T14:30:39.705Z",
    "durationMs": 93,
    "warnings": []
  },
  "data": {
    "className": "ZCL_MY_HELPER",
    "method": "compute",
    "args": { "x": 3, "y": 5 },
    "timeout": 30000,
    "dryRun": false,
    "route": "wrapper",
    "output": "{\"status\":\"ok\",\"method\":\"compute\",\"exitCode\":0,\"result\":8}",
    "parsed": { "status": "ok", "method": "compute", "exitCode": 0, "result": 8 },
    "exitCode": 0,
    "durationMs": 1234
  }
}
```

失败时错误信封（`--json` 下 stdout 严格为空）：

```json
{
  "status": "error",
  "meta": { "command": "abap run", "version": "0.1.0", "durationMs": 93, "warnings": [] },
  "error": {
    "code": "METHOD_NOT_SUPPORTED",
    "category": "VALIDATION_ERROR",
    "message": "method signature contains CHANGING/TABLES",
    "details": { "class": "ZCL_FOO", "method": "compute" },
    "nextSteps": [
      "Use `abap run <class>` (classrun) instead of --method",
      "Or rewrite the method signature to IMPORTING + RETURNING only"
    ]
  }
}
```

# More

## fixme

- [x] **B（已修复）** — `--method` 反射路径在部分 SAP 系统不可用：ADT classrun 端点（实测 vhcala4hci）不注入请求体参数，`--method` 请求返回 `WRAPPER_INPUT_UNAVAILABLE`（exit 6）——CLI 已明确报错并给 `nextSteps`；跨版本能力探测见下方 todo。
- [x] **B（已修复 2026-08-07）** — 真实 SAP 对不存在的类 / 未实现 classrun 的类返回**纯文本错误**，CLI 原先误报为业务成功（exit 0）；现 `detectPlainTextError` 识别 `does not exist` / `does not implement` / `is inactive` / `locked by` 并映射为结构化错误（回归测试 `run-flow-plain-error.test.ts`）。
- [ ] **C** — classrun 路径的 `--timeout` 实际由 ADT 端点服务端超时（约 5 分钟）决定，CLI 侧 `AbortController` 兜底为 `--timeout + 5000ms`；当用户 `--timeout` 大于服务端超时时，实际生效的是服务端值——帮助文案应说明这一差异（已部分体现在 Option 描述，`--help` 简版可补充）。

## todo

- [ ] **P2 — PROG（report）执行** — 通过 ADT SUBMIT 或独立入口支持 `abap run <prog> --type PROG`（roadmap 差异能力）；report 输出回 SP01 的捕获方式需先验证。
- [ ] **`--method` 参数注入的跨版本探测** — 在 `connection add/set` 或 `abap init` 时一次性探测 SAP classrun 是否支持参数注入并持久化到 profile（类似 014 的 `adtTextpool` 能力探测），`--method` 在支持的系统上正常走 wrapper、不支持的直接提示，避免每次运行 `WRAPPER_INPUT_UNAVAILABLE`。
- [ ] **`--no-wait` 异步执行** — spec FR-002 曾规划"只入队不等待返回"，v1 未实现（`--method` 参数注入可用后再评估）。
- [ ] **真实 SAP 端到端 fixture** — `ZCL_ABAP_VIBE_RUNNER_FIXTURE_OK/BAD/FAIL` 测试类目前仅在 mock 覆盖；如需在真实 SAP 上回归 `--method` 反射，需先确认目标系统支持参数注入。

# references

- 实现：`src/abap_cli/commands/run.ts`（`registerRunCommand` + `--schema`）、`src/abap_cli/flows/run-flow.ts`（`runRun`/`interpret`/`withTimeout`）、`src/abap_cli/core/classrun-output.ts`（`parseClassrunOutput` 共享 helper）
- 客户端：`src/abap_cli/clients/adt-client.ts`（`runClass(name, params?)`，params 经 `AdtHTTP.request` JSON body 传递）
- SAP 后端：`abap/src/clas/zcl_abap_vibe_runner.clas.abap`（IF_OO_ADT_CLASSRUN + 动态调用 + 超时检查）
- 错误码：`src/abap_cli/output/error-codes.ts`（8 个 015 新错码 + `WRAPPER_INPUT_UNAVAILABLE`）
- 测试：`test/unit/run-*.test.ts`（26 文件 83 用例）、`test/mock-adt/server.js`（`ZCL_ABAP_VIBE_RUNNER` fixture）
- 文档：`docs/commands.md`（`abap run` 一节）、`CHANGELOG.md`（[Unreleased] ### Added 015-abap-run）
