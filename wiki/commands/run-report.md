---
type: command
title: abap run-report
description: "执行一个已激活的可执行报表并返回其经典 list 输出（只读，经 bundled ICF 的 /run/report），支持 variant 与客户端 raw/tsv/csv 格式化。"
tags: [abap-cli, command, run-report, report, submit, icf, read-only]
created at: 2026-10-29 14:30:14
changed at: 2026-10-31 13:24:09
---

# abap run-report

执行一个已激活的**可执行报表**（SE38 的 REPORT，`TRDIR-SUBC = '1'`）并返回它写入列表的输出。ADT 没有 report 版的 classrun，所以命令走 bundled ICF 的 `POST /run/report`：SAP 端用 `SUBMIT ... EXPORTING LIST TO MEMORY AND RETURN` 跑报表，再把捕获到的经典 list 转成文本返回。

因此它有两个硬边界：**用默认选择参数执行**（不会弹选择屏），**只捕获经典 list 输出**（ALV / 容器控件报表拿不到内容）。`--format tsv|csv` 是纯客户端转换，`output` 字段始终保留 SAP 原始 list。

## Usage

```bash
abap run-report <report> [--variant <name>] [--format raw|tsv|csv] [--param NAME=VALUE]... [--json]
abap run-report --schema --json
```

## Options

- `<report>`: 可执行程序名（`ZR_MY_REPORT`），自动转大写；正则 `^[A-Z][A-Z0-9_]{0,39}$`。
- `--variant <name>`: 用 `SUBMIT ... USING SELECTION-SET` 指定选择变式（自动转大写），替代默认选择值。
- `--format <raw|tsv|csv>`: 输出格式，默认 `raw`。`tsv` / `csv` 在客户端按 `|` 拆列并丢掉 `-----` 分隔条。
- `--param <NAME=VALUE>`: 可重复。名字转大写、值非空；**只转发并回显，不改变报表选择值**（见 gotcha）。
- `--schema`: 打印参数 schema 并退出，不调用 SAP。
- `--json` / `--pretty-json`: 全局输出模式，见 [agent-integration](../../docs/agent-integration.md)。

## 前置条件

- 已绑定 profile，SAP 可达；bundled ICF 服务已部署且版本匹配（当前 `1.0.0` 含 `/run/report`）。旧服务会以 `SAP_ERROR` / `QUERY_FAILED` 类错误暴露，先 `abap deploy --yes`。
- 目标报表存在、已激活，且 `TRDIR-SUBC = '1'`；include、module pool、class pool、function group 都不可执行。
- 报表在**默认选择参数**下能跑完；需要必填参数的报表要先建选择变式，用 `--variant` 指定。
- 报表输出经典 list（`WRITE` / `WRITE:/` 或 ALV 渲染到 list）；纯 GUI 容器控件的报表无法捕获。

## Examples

```bash
# 用默认选择参数跑报表，打印原始 list
abap run-report ZR_MY_REPORT
# 指定选择变式，取 JSON
abap run-report ZR_MY_REPORT --variant VAR1 --json
# 客户端转成 TSV（不重跑报表）
abap run-report ZR_MY_REPORT --format tsv
# --param 只做转发/回显，不会覆盖报表默认值
abap run-report ZR_MY_REPORT --param P_USERNAME=DEVELOPER --param P_MAX=10 --json
```

## Expected Output

`--json`（`output` 是原始 list，`formatted` 是请求格式的渲染；`truncated` 表示命中服务端上限）：

```json
{
  "status": "success",
  "meta": { "command": "abap run-report", "version": "1.0.0", "timestamp": "2026-10-31T05:40:18.204Z", "durationMs": 2317, "warnings": [] },
  "data": {
    "report": "ZR_MY_REPORT", "params": [ { "name": "P_MAX", "value": "10" } ],
    "lines": ["|------|--------|", "|USER  |COUNT   |", "|DEV   |42      |", "|------|--------|"],
    "output": "|------|--------|\n|USER  |COUNT   |\n|DEV   |42      |\n|------|--------|",
    "formatted": "USER\tCOUNT\nDEV\t42",
    "format": "tsv", "lineCount": 4, "truncated": false, "durationMs": 2317
  }
}
```

## 关键错误码

| 错误码 | 类别 / exit | 触发场景 | 恢复 |
|---|---|---|---|
| `REPORT_NOT_FOUND` | NOT_FOUND / 8 | 报表在 `TRDIR` 中不存在 | `abap search <name> --exact` 核对 |
| `REPORT_NOT_EXECUTABLE` | VALIDATION_ERROR / 7 | `TRDIR-SUBC != '1'`（include / module pool / class pool 等） | 只能跑可执行程序；类逻辑改用 `abap run` |
| `REPORT_NO_LIST_OUTPUT` | SAP_ERROR / 6 | 报表没有经典 list 输出（ALV / 容器控件 / 不写 list） | 改用 `abap run` 把逻辑包成类 |
| `REPORT_RUN_FAILED` | SAP_ERROR / 6 | `SUBMIT` 抛异常，或 list 转文本失败 | 检查报表默认参数；需要必填参数的先建 variant |
| `INVALID_ARGUMENT` | USAGE / 2 | 报表名非法、`--format` 不是 raw/tsv/csv、`--param` 不是 `NAME=VALUE` / 名字非法 / 值为空 | 按 `error.example` 修正 |

未知的服务端错误码会降级为 `SAP_ERROR`（exit 6），原码保留在 `error.details.sapCode`。

## 真机证据

- **部分验证**：`TRDIR-SUBC = '1'` 作为可执行报表判定，在 vhcala4hci（A4H）上对生成报表和 SE38 创建的报表都验证过（见 `abap/src/zcl_abap_vibe_icf_run.clas.abap` 注释）。
- **未验证**：`--format` / `--param` 的端到端行为与 ALV 类报表的 `REPORT_NO_LIST_OUTPUT` 未记录真机结果；`--param` 不生效是源码层面的静态 SUBMIT 限制。

# More

## gotcha

- **`--param` 不改变选择值**：SAP 端 `SUBMIT` 是静态解析，无法接受动态 `WITH` 子句；handler 只把参数回显在 `data.params` 供核对。要真正改选择值，改报表默认值或用 `--variant`。
- **输出有上限**：SAP 端最多捕获 5000 行 / 200000 字符，超出即 `truncated: true` 并截断。
- **`--format` 是客户端转换**：`output` 永远保留原始 SAP list；`tsv` / `csv` 只是按 `|` 拆列并丢分隔条，嵌套 list 或混合宽度表格会失真，只能退回 `raw`。
- **`--variant` 必须已存在**：变式名不存在时表现为 `REPORT_RUN_FAILED`；先在 SE38 里建好变式。
- **只读**：不锁对象、不产生 transport、不修改报表源码。

# references

- 实现：`src/abap_cli/commands/run-report.ts`、`src/abap_cli/flows/data/run-report.ts`；SAP 端 `abap/src/zcl_abap_vibe_icf_run.clas.abap`
- 生成参数表：[docs/commands.md](../../docs/commands.md)；`--json` 契约：[agent-integration.md](../../docs/agent-integration.md)
- 所属 skill：[skills/abap-cli-data/SKILL.md](../../skills/abap-cli-data/SKILL.md)
