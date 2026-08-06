---
type: command
title: abap check
description: 校验本地 ABAP 文件 — --syntax（默认，SAP 语法检查）/ --content（本地校验，零 SAP 调用）/ --atc（ATC 检查）；--out 可将原始 ATC worklist 持久化到本地
tags: [abap-cli, command, check, syntax, atc, validation, worklist]
created at: 2026-08-07 00:00:00
changed at: 2026-08-07 00:00:00
---

# abap check

校验本地 ABAP 文件。三种模式互斥，`--syntax` 为默认；统一产出 `CheckIssue { file, line, severity, code, message }`（syntax/content/atc 共用）。有 error（或 `--strict` 时含 warning）即失败退出。

## Usage

```bash
abap check [options] [files...]
```

## Options

- `[files...]`: 要检查的本地 `.abap` 文件路径（一个或多个）
- `--syntax`: 对 SAP 做内容级语法检查（默认模式；对象须已存在于 SAP）
- `--content`: 仅本地校验，零 SAP 调用（文件解析、DDIC 类型白名单、空文件告警）
- `--atc`: 对 SAP 跑 ATC（ABAP Test Cockpit）检查
- `--variant <variant>`: ATC 检查 variant（仅 `--atc`，必填）
- `--all`: 检查当前目录下所有 `.abap` 文件
- `--changed`: 仅检查本地 mtime 比 SAP 对象 `changedAt` 新（允许 1s 时钟偏差）的文件；变更集为空则快速失败
- `--strict`: 把 warning 也视为失败
- `--out [file]`: 把原始 ATC worklist 持久化到本地文件（仅 `--atc`）；无值默认写 `.abap/atc/<variant>-<timestamp>.json`，有值写指定路径

## 行为规则

- **模式互斥**：`--syntax` / `--content` / `--atc` 同时给 → `INVALID_ARGUMENT`（exit 2）
- **范围互斥**：`[files...]` / `--all` / `--changed` 混用 → `INVALID_ARGUMENT`（exit 2）
- **`--atc` 必须配 `--variant`**，缺省 → `INVALID_ARGUMENT`（exit 2）
- **`--out` 仅限 `--atc`**，其他模式传 → `INVALID_ARGUMENT`（exit 2）
- **失败判定**：有 error，或 `--strict` 时有 warning → 失败。`--syntax` 模式退出码 7（`SYNTAX_ERROR`）；`--content`/`--atc` 模式退出码 7（`VALIDATION_ERROR`），`issues` 放 `error.details`
- **全部通过**：exit 0，`printResult` 输出 `{ issues, failure: false }`；human 摘要逐条列出 `file:line [severity] code — message`
- **空源文件**直接视为通过（abap-adt-api 拒绝空内容）
- **`--atc --out`**：stdout 输出不变（仍是映射后的 `CheckIssue[]`），JSON 信封新增 `out` 字段指向落盘文件；落盘内容为**原始 SAP worklist**（verbatim `AtcWorkList`），含 `variant` / `timestamp` / 逐文件 worklist——ATC 数据量大时避免塞满命令行输出
- 文件解析失败 / SAP 解析不到对象 → 生成 `FILE_PARSE_ERROR` / 对应错误码 issue（不中断其余文件）

## Examples

```bash
# 默认语法检查（对 SAP）
abap check src/zcl_demo.clas.abap

# 本地校验，不连 SAP
abap check src/zcl_demo.clas.abap --content

# ATC 检查并落盘原始 worklist（默认路径）
abap check src/zcl_demo.clas.abap --atc --variant Z_ATC_VAR --out

# ATC 检查并落盘到指定文件
abap check src/zcl_demo.clas.abap --atc --variant Z_ATC_VAR --out /tmp/atc.json

# 全量检查 + 把 warning 当失败
abap check --all --strict
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap check", "version": "0.7.0", "timestamp": "2026-08-07T00:00:00.000Z", "durationMs": 312, "warnings": [] },
  "data": {
    "issues": [],
    "failure": false,
    "out": "/Users/lei/proj/.abap/atc/Z_ATC_VAR-20260807T120000.json"
  }
}
```

失败时（含 `--atc --out`，`--strict`）：

```json
{
  "status": "error",
  "meta": { "command": "abap check", "version": "0.7.0", "timestamp": "2026-08-07T00:00:00.000Z", "durationMs": 501, "warnings": [] },
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "VALIDATION_ERROR",
    "message": "1 issue(s) found across 1 file(s)",
    "details": {
      "issues": [
        { "file": "src/zcl_demo.clas.abap", "line": 12, "severity": "warning", "code": "check_style", "message": "Method is too long" }
      ],
      "files": 1,
      "out": "/Users/lei/proj/.abap/atc/Z_ATC_VAR-20260807T120000.json"
    }
  }
}
```

# More

## fixme

- [ ] `--changed` 依赖 SAP 对象的 `changedAt` 做增量判定；`--all` 与 `--changed` 均不遵循 `.abapignore`

## todo

- [ ] 考虑 `--atc` 支持免落盘的汇总模式（只输出按 check 聚合的计数）供 Agent 快速消费

# references

- 实现：`src/abap_cli/commands/check.ts`、`src/abap_cli/flows/atc.ts`、`src/abap_cli/output/issues.ts`
- 文档：`docs/commands.md`、`test/unit/check-modes.test.ts`
