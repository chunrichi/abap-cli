---
type: command
title: abap check
description: 校验本地 ABAP 文件 — 子命令 syntax（默认，SAP 语法检查）/ content（本地校验，零 SAP 调用）/ atc（ATC 检查）；--files 是 syntax 的父命令快捷方式；--out 可将原始 ATC worklist 持久化到本地
tags: [abap-cli, command, check, syntax, atc, validation, worklist]
created at: 2026-08-17 00:00:00
changed at: 2026-09-02 00:00:00
---

# abap check

校验本地 ABAP 文件（021：模式从 flag 改为子命令）。三个子命令互斥；统一产出 `CheckIssue { file, line, severity, code, message }`。有 error（或 `--strict` 时含 warning）即失败退出。

## Usage

```bash
abap check syntax [options] [files...]    # 语法检查（默认；对象须已存在于 SAP）
abap check content [options] [files...]   # 本地校验，零 SAP 调用
abap check atc [options] [files...]       # ATC 检查（--variant 必填）
abap check --files <f...>                 # 父命令快捷方式 = check syntax <f...>
```

## Options

- `[files...]`: 要检查的本地 `.abap` 文件路径（一个或多个）
- `--variant <variant>`: ATC 检查 variant（仅 `check atc`，必填）
- `--all`: 检查扫描根下所有 `.abap` 文件
- `--changed`: 仅检查本地 mtime 比 SAP 对象 `changedAt` 新（允许 1s 时钟偏差）的文件；变更集为空则快速失败
- `--strict`: 把 warning 也视为失败
- `--out [file]`: 把原始 ATC worklist 持久化到本地文件（仅 `check atc`）；无值默认写 `.abap/atc/<variant>-<timestamp>.json`，有值写指定路径
- `--files <files...>`: 父命令快捷方式 = `check syntax <files...>`
- `--schema`: 打印本命令参数 schema（unified envelope，无 SAP 调用）

## 行为规则

- **子命令互斥**：`syntax` / `content` / `atc` 只能选一个（各自独立注册）
- **范围互斥**：`[files...]` / `--all` / `--changed` 混用 → `INVALID_ARGUMENT`（exit 2）
- **`--all` / `--changed` 作用域**：扫描根为 `.abap.json::sourceDir`（配置了时，相对配置文件所在目录解析），否则为当前工作目录；不遵循 `<name>.<type>.abap|xml` 布局的杂散文件会被跳过；显式文件路径永不跳过
- **`check atc` 必须配 `--variant`**，缺省 → `INVALID_ARGUMENT`（exit 2）
- **`--out` 仅限 `check atc`**，其他子命令传 → commander 报 unknown option（USAGE 类错误）
- **裸 `abap check`**（无子命令、无 `--files`）打印 help（exit 0）
- **失败判定**：有 error，或 `--strict` 时有 warning → 失败。`syntax` 退出码 7（`SYNTAX_ERROR`）；`content`/`atc` 退出码 7（`VALIDATION_ERROR`），`issues` 放 `error.details`
- **全部通过**：exit 0，`printResult` 输出 `{ issues, failure: false }`；human 摘要逐条列出 `file:line [severity] code — message`
- **空源文件**直接视为通过（abap-adt-api 拒绝空内容）
- **`check atc --out`**：stdout 输出不变（仍是映射后的 `CheckIssue[]`），JSON 信封新增 `out` 字段指向落盘文件；落盘内容为**原始 SAP worklist**（verbatim `AtcWorkList`）
- 文件解析失败 / SAP 解析不到对象 → 生成 `FILE_PARSE_ERROR` / 对应错误码 issue（不中断其余文件）

## Examples

```bash
# 默认语法检查（对 SAP）— 子命令形式
abap check syntax src/clas/zcl_demo.clas.abap
# 快捷方式（父命令 --files）
abap check --files src/clas/zcl_demo.clas.abap

# 本地校验，不连 SAP
abap check content src/clas/zcl_demo.clas.abap

# ATC 检查并落盘原始 worklist（默认路径）
abap check atc src/clas/zcl_demo.clas.abap --variant Z_ATC_VAR --out

# 全量检查 + 把 warning 当失败
abap check syntax --all --strict
```

## Expected Output

```json
{
  "status": "success",
  "meta": { "command": "abap check syntax", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 312, "warnings": [] },
  "data": { "issues": [], "failure": false }
}
```

失败时（含 `check atc --out`，`--strict`）：

```json
{
  "status": "error",
  "meta": { "command": "abap check atc", "version": "0.2.0", "timestamp": "2026-08-17T00:00:00.000Z", "durationMs": 501, "warnings": [] },
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "VALIDATION_ERROR",
    "message": "1 issue(s) found across 1 file(s)",
    "details": {
      "issues": [
        { "file": "src/clas/zcl_demo.clas.abap", "line": 12, "severity": "warning", "code": "check_style", "message": "Method is too long" }
      ],
      "files": 1,
      "out": "/Users/lei/proj/.abap/atc/Z_ATC_VAR-20260817T120000.json"
    }
  }
}
```

# More

## fixme
