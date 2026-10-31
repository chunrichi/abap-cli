---
type: command
title: abap validate:aff
description: 用本地镜像的官方 abap-file-format JSON Schema 校验 AFF canonical JSON；统一信封 / exit 0-2-7 / cwd-relative POSIX 路径，作为 create / push --file 的写盘前 gate
tags: [abap-cli, command, validate:aff, validate, abap-file-format, schema, validator, ajv, canonical, doma, dtel, docu, tabl, stru, fugr, clas, intf, prog, http, tran]
created at: 2026-09-03 00:00:00
changed at: 2026-11-01 00:25:00
---

# abap validate:aff

校验一个或一组 JSON 文件是否满足 **官方 abap-file-format**（AFF）规范。10 个支持类型（CLAS / INTF / PROG / FUGR / TABL / STRU / DOMA / DTEL / HTTP / TRAN）共享同一套校验层（`ajv@^8`，Draft 2020-12）；schema 来自仓库内 vendored 只读副本 `src/abap_cli/schema/`（`<type>/<type>-v1.json`；STRU 共享 `tabl-v1.json`，TABL/STRU `.settings.json` 走 `tabt-v1.json`），离线即可跑、不联网。DOMA / DTEL 的长文本伴生文件（`<name>.doma.docu.json` / `<name>.dtel.docu.json`）按 `docu-v1.json` 校验——它是 companion schema，不占对象类型。

## Usage

```bash
abap validate:aff <file-or-dir> [--wire <wire-dir>] [--json | --pretty-json]
```

## Options

- `<file-or-dir>`: **必填**。单个 JSON 文件或目录（递归扫 `.json`）；缺参 / 路径不存在 / 文件不是 `.json` 都返回 `USAGE`（exit 2）。
- `--wire <wire-dir>`: 额外递归扫一个 wire payload 目录（与 fixtures 路径并列校验）；目录不存在同样 `USAGE`。
- `--json`: 紧凑单行信封（成功 stdout、失败 stderr）。
- `--pretty-json`: 同一信封，2 空格缩进。
- `--schema`: 打印本命令参数 schema（unified envelope，无 SAP 调用）。

## Exit codes

| Code | Category | Meaning |
|------|----------|---------|
| `0`  | — | 全部 PASS（含 WARN） |
| `2`  | `USAGE` | 缺位置参数 / 路径不存在 / 目标不是 `.json` / `--wire` 目录不存在 |
| `7`  | `VALIDATION_ERROR` | 至少一个文件 schema 校验失败或缺少必需 companion；schema 装载失败（`AFF_SCHEMA_MISSING` / `AFF_SCHEMA_INVALID` / `AFF_SCHEMA_COMPILE_ERROR`）同样是 7 |

校验失败走统一输出层：失败信封含 `error.code` / `error.category` / `error.details`，不再有"自带形状"的 `{status, summary, files}`。

## Expected Output

成功（`--json` 紧凑单行）：

```json
{
  "status": "success",
  "meta": { "command": "abap validate:aff", "version": "1.2.0", "timestamp": "2026-11-01T00:00:00.000Z", "durationMs": 34, "warnings": [] },
  "data": {
    "summary": { "pass": 2, "warn": 0, "fail": 0 },
    "files": [
      { "status": "pass", "path": "test/fixtures/zmy_basic.tabl.json", "type": "TABL" },
      { "status": "pass", "path": "test/fixtures/zdmy_single_fixed.doma.json", "type": "DOMA" }
    ]
  }
}
```

失败（stderr，stdout 为空）：

```json
{
  "status": "error",
  "meta": { "command": "abap validate:aff", "version": "1.2.0", "timestamp": "2026-11-01T00:00:00.000Z", "durationMs": 35, "warnings": [] },
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "VALIDATION_ERROR",
    "message": "1 of 2 file(s) failed AFF validation.",
    "details": {
      "summary": { "pass": 1, "warn": 0, "fail": 1 },
      "files": [
        { "status": "fail", "path": "test/fixtures/zbroken.doma.json", "type": "DOMA", "errors": [ { "path": "", "keyword": "required", "message": "must have required property 'formatVersion'" } ] },
        { "status": "pass", "path": "test/fixtures/zmy_basic.tabl.json", "type": "TABL" }
      ]
    },
    "nextSteps": ["Inspect error.details.files[] where status is \"fail\" (schema instance paths and missing companions), fix the files, then re-run."]
  }
}
```

字段契约：

- `data.summary { pass, warn, fail }` 与 `data.files[]` 始终存在（没有匹配文件时 `files: []` 也保留）。
- `data.files[].path`（以及 human 文本里的路径）是 **cwd-relative POSIX**（`test/fixtures/x.doma.json`），不是绝对路径——见 [path-output](path-output.md)。
- `files[].status`: `pass` / `warn`（开放 schema 的额外字段）/ `fail`（schema 校验失败**或**缺必需 companion）；`files[].errors[]` 为 ajv 的 `instancePath / keyword / message`。
- `files[].missingCompanions[]` / `optionalCompanions[]` 是相对主 JSON 同目录的文件名（basename）。
- 未知（非 AFF）JSON 文件不参与校验、不计数——`package.json` 之类不会伪装成 PASS。

## Per-file routing

`router.ts` 按文件名前缀路由 schema：

| 文件名前缀 | 路由 schema |
|------------|-------------|
| `<name>.clas.json` | `clas-v1.json` |
| `<name>.intf.json` | `intf-v1.json` |
| `<name>.prog.json` | `prog-v1.json` |
| `<name>.fugr.json` / `*.fugr.*.reps.json` / `*.fugr.*.func.json` | `fugr-v1.json` |
| `<name>.tabl.json` | `tabl-v1.json` |
| `<name>.tabl.settings.json` | `tabt-v1.json`（技术设置） |
| `<name>.tabl.ddic` | TABL（DDL 源，不走 schema 校验） |
| `<name>.stru.json` | `tabl-v1.json`（schema 共享） |
| `<name>.stru.settings.json` | `tabt-v1.json` |
| `<name>.doma.json` | `doma-v1.json` |
| `<name>.dtel.json` | `dtel-v1.json` |
| `<name>.doma.docu.json` | `docu-v1.json`（DOMA 长文本伴生，0..1） |
| `<name>.dtel.docu.json` | `docu-v1.json`（DTEL 长文本伴生，0..1） |
| `<name>.http.json` | `http-v1.json` |
| `<name>.tran.json` | `tran-v1.json` |

## Companion 探测

`companion-check.ts` 在校验 main JSON 时额外探测 companion 文件：

- **TABL / STRU**: `.tabl.ddic` 必需；`.tabl.settings.json` **optional**（只有对象带技术设置时才落盘，STRU 从不会有）——缺失只进 `optionalCompanions[]`，不导致 fail。settings.json 文件本身不触发自递归检查。
- **CLAS**: `.clas.abap` 主源必需；`.clas.{definitions,implementations,macros,testclasses}.abap` 与 `.clas.texts.<lang>.properties` 仅在对象具备时存在，归 optional。
- **FUGR**: companion `*.reps.*` / `*.func.*` 动态从 main JSON 推断；缺件报告「missing companion」。
- **XSLT**: `.xml` 源必需。
- **DOMA / DTEL**: 长文本伴生 `.doma.docu.json` / `.dtel.docu.json` 是 **0..1 optional**，缺失不报错；存在时由路由直接按 `docu-v1.json` 校验（`line` ≤72、`format` ≤2、`formatVersion: "1"`）。

必需 companion（TABL/STRU 的 `.ddic`、CLAS 的 `.clas.abap`、XSLT 的 `.xml`）缺失时该文件 `status: "fail"`、错误信封 `details.files[]` 里带 `missingCompanions[]`，退出码 7；optional 缺失只出现在 `optionalCompanions[]`。"单文件本身合法但缺必需 companion"与 companion 规则解耦：本命令只消费 `companion-check` 返回的 `missing` 列表。

## WARN 路径

当 schema 是 `additionalProperties: true`（开放 schema），额外字段会发 WARN（非 FAIL）：

```
WARN <path>: extra fields: <comma-separated-keys>
```

WARN 不影响退出码（exit 0 仍然视为通过），`--json` 模式下计入 `summary.warn`。

## 离线 / 跨版本

- **离线**：runtime 不调用 npm registry / 不联网；AFF schema 从仓库内 vendored 副本 `src/abap_cli/schema/`（发布包内随 dist 提供）装载。
- **跨版本**：当前锁定 `<type>-v1.json`。AFF 上游升级到 `v2` 时另行迁移（新版本 schema 需重新 vendor 并经校验器回归）。
- **`ABAP_CLI_AFF_MIRROR` 环境变量**：可覆盖 schema 根目录（优先级高于 bundled 副本），用于本地/CI 指定不同镜像；默认解析顺序见 `src/abap_cli/aff/schema-paths.ts`。

## 校验时机

`abap validate:aff` 是**写盘前的强制 gate**：`create` / `push` 的 `--file` 路径在本地先校验 AFF canonical JSON，失败即中止（不连 SAP）。CLI 行为由 `test/unit/validate-aff-contract.test.ts` + `test/unit/validate-aff-command.test.ts` 覆盖。

## Gotchas

- 不传位置参数**不会**退化成"收集 0 个文件并 exit 0"：直接 `USAGE` exit 2（旧行为会假绿）。
- 路径拼错同样 exit 2；只有"路径存在且目录里没有 AFF JSON"才会 success + 空 `files`（那是合法但空的结果）。
- FAIL 行的可读文本只在 human 模式出现（stderr）；`--json` 失败时 stdout 严格为空，错误细节在 `error.details.files[]`。

## Examples

```bash
# 校验单个 AFF 文件
abap validate:aff src/zmy_basic.tabl.json

# 校验目录下全部 AFF 文件（含 STRU/TABL settings.json 走 tabt-v1.json）
abap validate:aff src/

# 单独校验 DOMA/DTEL 长文本伴生文件（docu-v1.json）
abap validate:aff src/zmy_doma.doma.docu.json

# 同时校验一个 wire payload 目录
abap validate:aff src/zt_x.tabl.json --wire path/to/wire

# JSON 信封输出（Agent 友好，紧凑）
abap validate:aff src/ --json

# 打印命令参数 schema（无 SAP 调用）
abap validate:aff --schema
```

# More

## fixme

- [ ] WARN 只列出 `extraFields` 的键名，不解释这些字段为何出现（`additionalProperties: true` 的开放 schema 与真正未知键混在一起）。

## todo

- [ ] 上游 AFF 发布 `prog/examples/` 与 `http/examples/` 后，替换 handcrafted fixture
- [ ] 校验 `.tabl.ddic` / `.stru.ddic` DDL 源本身（当前只做 companion 存在性检查，DDL 走 `TABL_DDL_INVALID` 解析路径）
- [ ] 真机证据待补：`--wire` 目录校验在真实 ICF payload 上的回归记录

# references

- 校验层: [src/abap_cli/aff/schema-validator.ts](../../src/abap_cli/aff/schema-validator.ts)（ajv v8 + 缓存）
- 路由: [src/abap_cli/aff/router.ts](../../src/abap_cli/aff/router.ts) · [src/abap_cli/aff/schema-paths.ts](../../src/abap_cli/aff/schema-paths.ts)（type → schema 映射）
- Companion 探测: [src/abap_cli/aff/companion-check.ts](../../src/abap_cli/aff/companion-check.ts)
- 命令实现与 schema: [src/abap_cli/commands/validate-aff.ts](../../src/abap_cli/commands/validate-aff.ts)（命令模块自持 `--schema`）
- 输出契约: [path-output.md](path-output.md) · [docs/commands.md](../../docs/commands.md)
- 套件: `test/unit/schema-compliance/<type>.test.ts`（10 个 type × ≥1 fixture）
- 端到端 wire round-trip: `test/unit/wire-aff-roundtrip.test.ts`
