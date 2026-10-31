---
type: command
title: abap test
description: 通过 ADT ABAP Unit API 跑类/程序单测，输出 summary 与失败用例；失败 exit 7
tags: [abap-cli, command, test, abap-unit, adt, read-only]
created at: 2026-10-31 14:36:00
changed at: 2026-10-31 14:36:00
---

# abap test

对 SAP 上**已激活**的类或程序运行 ABAP Unit 测试。命令通过 ADT ABAP Unit 端点（`POST /sap/bc/adt/abapunit/testruns`）提交一次 run configuration，然后把原始结果投影成 Agent 友好的形状：只给 summary 和失败用例，通过用例不逐条列出。ABAP Unit 运行本身只读——不加锁、不写 transport、不修改对象。

## Usage

```bash
abap test [options] <object>
abap test --schema [--json]
```

## Options

- `<object>`: 要测试的对象名（类/程序，如 `ZCL_MY_THING`），先经对象解析（`resolveObject`）换成 ADT 对象 URL。
- `--type <tadir>`: 对象类型过滤器，透传给对象解析（`CLAS`、`PROG` 等）；仅在同名对象存在多种类型时需要。
- `--risk <levels>`: 逗号分隔的风险等级，取值 `harmless` / `dangerous` / `critical`，默认 `harmless`。ABAP Unit 默认只跑 harmless 用例，dangerous/critical 需显式指定。
- `--duration <levels>`: 逗号分隔的时长等级，取值 `short` / `medium` / `long`，默认 `short`。
- `--all`: 等价于全选 risk + duration 等级（`--all` 与 `--risk` / `--duration` 互斥）。
- `--strict`: 把 warning alert 也视为失败（默认 warning 不影响退出码）。
- `--json`: 输出统一 JSON 信封，供 Agent 消费；`--pretty-json` 缩进。
- `--schema`: 输出机器可读的参数 schema，不访问 SAP。

## 行为规则

- **默认等级**：只跑 `harmless` + `short`；其余等级被静默跳过，需要时用 `--risk` / `--duration` / `--all` 显式打开。
- **失败判定**：任一测试方法带 `failedAssertion` 或 `exception` alert → 失败；`--strict` 时 `warning` 也算失败。失败抛 `CliError('TEST_FAILED')`，JSON 模式下错误信封进 stderr、exit 7，与 `abap check` 的失败语义一致。
- **类级 alert**：没有归属测试方法的 alert 归到该类，`failures[].method` 为空字符串，并在 summary 里按 1 个 failed / errored 计数。
- **summary 口径**：`classes` 是返回的测试类数，`methods` 是被执行的测试方法数；`passed + failed + errored` 与 `methods` 一一对应（类级 alert 会额外各计 1）；`durationMs` 是各方法 `executionTime` 的合计并换算成毫秒。
- **退出码**：`TEST_FAILED` = 7；`OBJECT_NOT_FOUND` / `AMBIGUOUS_OBJECT` = 8；`INVALID_ARGUMENT` / `USAGE` = 2；`CONFIG_ERROR` = 3；`AUTH_ERROR` = 5；`SAP_ERROR` = 6。
- **本地未推送的改动不参与**：命令跑的是 SAP 上的激活版本，改完单测要先 `abap push` 再 `abap test`。
- **ADT 端点依赖**：老 release 或受限系统可能不暴露 ABAP Unit 端点，此时返回 `SAP_ERROR` 并给出 `nextSteps`（`abap doctor` 排查连接）。

## Examples

```bash
# 默认（harmless + short）跑一个类的单测
abap test ZCL_MY_THING

# 跑全部 risk + duration 等级
abap test ZCL_MY_THING --all

# 只跑 dangerous 用例、把 warning 当失败
abap test ZCL_MY_THING --risk dangerous --strict --json

# 同名多类型时显式指定类型
abap test Z_MY_PROGRAM --type PROG --json

# Agent 自省：当前命令的参数契约
abap test --schema
```

## Expected Output

成功（JSON；`failures` 为空数组时被 token 经济性裁剪掉）：

```json
{
  "status": "success",
  "meta": { "command": "abap test", "version": "1.1.0", "timestamp": "2026-10-31T06:30:00.000Z", "durationMs": 431, "warnings": [] },
  "data": {
    "object": { "name": "ZCL_MY_THING", "type": "CLAS/OC" },
    "riskLevels": ["harmless"],
    "durations": ["short"],
    "summary": { "classes": 1, "methods": 2, "passed": 2, "failed": 0, "errored": 0, "durationMs": 4 }
  }
}
```

失败（`TEST_FAILED`，stderr，exit 7）：

```json
{
  "status": "error",
  "meta": { "command": "abap test", "version": "1.1.0", "timestamp": "2026-10-31T06:31:00.000Z", "durationMs": 398, "warnings": [] },
  "error": {
    "code": "TEST_FAILED",
    "category": "VALIDATION_ERROR",
    "message": "1 failing test(s) for ZCL_MY_THING (1 class(es), 2 method(s))",
    "details": {
      "object": { "name": "ZCL_MY_THING", "type": "CLAS/OC" },
      "riskLevels": ["harmless"],
      "durations": ["short"],
      "summary": { "classes": 1, "methods": 2, "passed": 1, "failed": 1, "errored": 0, "durationMs": 5 },
      "failures": [
        {
          "class": "LTC_MY_THING",
          "method": "TEST_ADD",
          "kind": "failedAssertion",
          "severity": "critical",
          "title": "Assertion failed",
          "details": ["Expected 3, actual 4"]
        }
      ]
    },
    "nextSteps": [
      "Read error.details.failures for the assertion / exception details.",
      "Run `abap test <object> --strict` to also treat warnings as failures."
    ],
    "example": "abap test ZCL_MY_THING --json"
  }
}
```

人类模式（成功与失败都走同一摘要）：

```
ABAP Unit ZCL_MY_THING (CLAS/OC): 1 class(es), 2 method(s), 1 passed, 1 failed, 0 errored; 5 ms
  LTC_MY_THING > TEST_ADD [failedAssertion/critical] Assertion failed: Expected 3, actual 4
```

## 关键错误码

| 错误 | 类别 / exit | 含义 | 恢复 |
|---|---|---|---|
| `TEST_FAILED` | VALIDATION_ERROR / 7 | 有 failedAssertion / exception（或 `--strict` 下的 warning） | 读 `error.details.failures`；`method` 为空是类级 alert |
| `OBJECT_NOT_FOUND` | NOT_FOUND / 8 | 对象名解析不到 | `abap search <name>` 校对 |
| `AMBIGUOUS_OBJECT` | NOT_FOUND / 8 | 同名多类型 | 补 `--type CLAS`（或 `PROG`） |
| `INVALID_ARGUMENT` | USAGE / 2 | `--risk` / `--duration` 等级非法，或 `--all` 与等级混用 | 看 `error.details.allowedValues` |
| `USAGE` | USAGE / 2 | 缺 `<object>` 位置参数 | 传对象名 |
| `SAP_ERROR` | SAP_ERROR / 6 | ADT ABAP Unit 端点不可用 / 传输失败 | `abap doctor` 排查连接，读 `error.nextSteps` |

## 关联命令

- **`abap check syntax`**: 语法检查；单测类编译不过时先做语法检查
- **`abap push`**: 把本地单测改动推到 SAP 并激活，`abap test` 跑的是激活版本
- **`abap activate`**: 对象有 inactive 版本时先激活，否则测的是旧版本
- **`abap run`**: 执行类/静态方法，看运行输出（不是单测断言）

## 实现要点

- `src/abap_cli/flows/core/unit-test.ts` 负责：等级解析与校验、`--all` 展开、`UnitTestRunFlags` 拼装、`resolveObject` 取对象 URL、结果聚合（summary + failures）、`TEST_FAILED` 抛错。
- `AdtClientWrapper.unitTestRun(url, flags)` 包装 `abap-adt-api` 的 `ADTClient.unitTestRun`（run configuration 里写 `<testRiskLevels>` / `<testDurations>`）。
- 输出契约见 schema：`abap test --schema --json`（`data.object` / `data.riskLevels` / `data.durations` / `data.summary` / `data.failures`）。

# More

## fixme

- [ ] `durationMs` 由 ADT 结果里的 `executionTime` 换算：按 AUnit XML 契约该值以**秒**为单位，代码按毫秒输出（×1000）。真机未验证，若 SAP 端实际给的是毫秒，该字段会放大 1000 倍
- [ ] 类级 alert 的计数口径：summary 里按 1 次 failed/errored 计入，但 `failures[].method` 为空字符串，Agent 需要自己识别（见 `## 行为规则`）

## todo

- [ ] 真机证据待补：`POST /sap/bc/adt/abapunit/testruns` 在 A4H / S/4HANA / BTP 上的可用性与返回形状（当前 A4H 离线，只有 mock 单测覆盖）
- [ ] `--risk` / `--duration` 在真实 SAP 上的过滤效果验证（dangerous / critical、medium / long 用例是否按预期被执行）

# references

- 实现: [src/abap_cli/commands/test.ts](../../src/abap_cli/commands/test.ts) · [src/abap_cli/flows/core/unit-test.ts](../../src/abap_cli/flows/core/unit-test.ts) · [src/abap_cli/clients/adt-client.ts](../../src/abap_cli/clients/adt-client.ts)
- 生成物: [docs/commands.md](../../docs/commands.md)
- 测试: `test/unit/unit-test-flow.test.ts` · `test/unit/test-command.test.ts`
- ADT 端点：`POST /sap/bc/adt/abapunit/testruns`（`abap-adt-api` 的 `UnitTestClass` / `UnitTestRunFlags` 类型）
