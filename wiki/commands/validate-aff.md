---
type: command
title: abap validate:aff
description: 用本地镜像的官方 abap-file-format JSON Schema 校验 10 个支持类型的 canonical JSON 形态；作为 create / push --file 的写盘前 gate
tags: [abap-cli, command, validate:aff, validate, abap-file-format, schema, validator, ajv, canonical, doma, dtel, docu, tabl, stru, fugr, clas, intf, prog, http, tran]
created at: 2026-09-03 00:00:00
changed at: 2026-10-31 17:05:00
---

# abap validate:aff

校验一个或一组 JSON 文件是否满足 **官方 abap-file-format**（AFF）规范。10 个支持类型（CLAS / INTF / PROG / FUGR / TABL / STRU / DOMA / DTEL / HTTP / TRAN）共享同一套校验层（`ajv@^8`，Draft 2020-12）；schema 来自仓库内 vendored 只读副本 `src/abap_cli/schema/`（`<type>/<type>-v1.json`；STRU 共享 `tabl-v1.json`，TABL/STRU `.settings.json` 走 `tabt-v1.json`），离线即可跑、不联网。DOMA / DTEL 的长文本伴生文件（`<name>.doma.docu.json` / `<name>.dtel.docu.json`）按 `docu-v1.json` 校验——它是 companion schema，不占对象类型。

## Usage

```bash
abap validate:aff [file-or-dir] [--wire <wire-dir>] [--json] [--schema]
```

## Options

- `[file-or-dir]`: 单个 JSON 文件或目录（递归扫 `.json`）。不传时收集到 0 个文件并以 `success` 退出，不会回退到 `test/fixtures/`。
- `--wire <wire-dir>`: 额外递归扫一个 wire payload 目录（与 fixtures 路径并列校验）。
- `--json`: 输出单条 JSON envelope（`{ status, summary: { pass, warn, fail }, files: [...] }`）；token-efficient 仅保留 Agent 必需字段。
- `--schema`: 打印本命令参数 schema（unified envelope，无 SAP 调用）。

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | 全部 PASS（含 WARN） |
| `1`  | 至少一个文件 FAIL 或 companion 缺失 |
| `2`  | 系统错误（schema 缺失 / 读盘失败 / ajv 编译失败） |

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

未知 JSON 文件不参与校验（输出 `UNKNOWN: PASS` 旁路）。

## Companion 探测

`companion-check.ts` 在校验 main JSON 时额外探测 companion 文件：

- **TABL**: `.tabl.ddic` + `.tabl.settings.json` 必需；settings.json 文件本身不触发自递归检查。
- **STRU**: `.tabl.ddic` 必需；`.tabl.settings.json` optional（仅 WARN）。
- **CLAS**: 4 个 `.clas.{definitions,implementations,macros,testclasses}.abap` 必需；`.clas.texts.<lang>.properties` optional。
- **FUGR**: companion `*.reps.*` / `*.func.*` 动态从 main JSON 推断；缺件报告「missing companion」。
- **DOMA / DTEL**: 长文本伴生 `.doma.docu.json` / `.dtel.docu.json` 是 **0..1 optional**，缺失不报错；存在时由路由直接按 `docu-v1.json` 校验（`line` ≤72、`format` ≤2、`formatVersion: "1"`）。

companion 缺失 = exit 1。

## WARN 路径

当 schema 是 `additionalProperties: true`（开放 schema），额外字段会发 WARN（非 FAIL）：

```
WARN <path>: extra fields: <comma-separated-keys>
```

WARN 不影响退出码（exit 0 仍然视为通过）。`--json` 模式下 WARN 计入 `summary.warn` 计数。

## 与 `--json` 信封的字段

```typescript
{
  status: 'success' | 'error',
  summary: { pass: number, warn: number, fail: number },
  files: Array<{
    status: 'pass' | 'warn' | 'fail',
    path: string,
    type?: string,
    errors?: Array<{ path: string, keyword: string, message: string }>,
    extraFields?: string[],
    missingCompanions?: string[],
    optionalCompanions?: string[],
  }>,
}
```

`errors[]` 每项 `path/line/column + reason`（ajv `instancePath` + `keyword` + `message`）。Agent 拿到 fail 时可直接定位修复点。

## 离线 / 跨版本

- **离线**：runtime 不调用 npm registry / 不联网；AFF schema 从仓库内 vendored 副本 `src/abap_cli/schema/`（发布包内随 dist 提供）装载。缺失时抛 `AFF_SCHEMA_MISSING`（`NOT_FOUND`/exit 2）；升级上游 schema 用 `scripts/sync-aff-schema.sh`（联网、手工执行）。
- **跨版本**：当前锁定 `<type>-v1.json`。AFF 上游升级到 `v2` 时另行迁移（新版本 schema 需重新 vendor 并经校验器回归）。
- **`ABAP_CLI_AFF_MIRROR` 环境变量**：可覆盖 schema 根目录（优先级高于 bundled 副本），用于本地/CI 指定不同镜像；默认解析顺序见 `src/abap_cli/aff/schema-paths.ts`。

## 校验时机

`abap validate:aff` 是**写盘前的强制 gate**：`create` / `push` 的 `--file` 路径在本地先校验 AFF canonical JSON，失败即中止（不连 SAP）。CLI 行为由 `test/unit/validate-aff-command.test.ts` 覆盖；本地改动 fixture 后可直接跑命令核对。

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

# JSON 信封输出（Agent 友好）
abap validate:aff --json src/

# 打印命令参数 schema（无 SAP 调用）
abap validate:aff --schema
```

## Expected Output

`--json` 输出不是统一 012 信封（没有 `meta` / `data`），而是单条报告对象；`status` 由退出码推导：

```json
{
  "status": "success",
  "summary": { "pass": 2, "warn": 0, "fail": 0 },
  "files": [
    { "status": "pass", "path": "/Users/lei/proj/test/fixtures/zmy_basic.tabl.json", "type": "TABL" },
    { "status": "pass", "path": "/Users/lei/proj/test/fixtures/zdmy_single_fixed.doma.json", "type": "DOMA" }
  ]
}
```

有 WARN（额外字段）时 `status` 仍为 `success`、退出码 0：

```json
{
  "status": "success",
  "summary": { "pass": 1, "warn": 1, "fail": 0 },
  "files": [
    { "status": "pass", "path": "/Users/lei/proj/test/fixtures/z_aff_example_clas.clas.json", "type": "CLAS" },
    { "status": "warn", "path": "/Users/lei/proj/test/fixtures/zmy_basic.tabl.settings.json", "type": "TABL", "extraFields": ["customKey"] }
  ]
}
```

有 FAIL（或 companion 缺失）时 `status: "error"`、退出码 1（长文本伴生校验失败也走这里，`type: "DOCU"`）：

```json
{
  "status": "error",
  "summary": { "pass": 0, "warn": 0, "fail": 1 },
  "files": [
    {
      "status": "fail",
      "path": "/Users/lei/proj/test/fixtures/zbroken.doma.json",
      "type": "DOMA",
      "errors": [
        { "path": "/typeInformation/dataType", "keyword": "enum", "message": "must be equal to one of the allowed values" }
      ]
    }
  ]
}
```

## 已知限制

- **PROG / HTTP fixture 是 handcrafted**：上游 AFF `prog/examples/` 与 `http/examples/` 缺失；fixture 为手写 minimal-but-valid 样本，`validate:aff` 校验通过。CI 注释提示「upstream example now available, consider replacing」。
- **STRU `settings.json` optional**：schema 不强制；validator 只发 WARN（`optionalCompanions: [...]`）。SAP 透明表持久化 `.tabl.settings.json`，结构体则不。
- **`additionalProperties: true` schema**：TABL `.tabl.settings.json` / CLAS 文本元素等多 key schema 对额外字段发 WARN 不阻断。
- **wire ↔ local 双层**：本命令只校验 local canonical JSON（落盘形态）；ICF wire payload 由 mock + 真实 SAP 端到端 round-trip 单测覆盖（`test/unit/wire-aff-roundtrip.test.ts`）。

# More

## fixme

- [ ] 无位置参数时收集到 0 个文件并以 `status: "success"` 退出，不会回退到 `test/fixtures/`；Agent 误用会得到假绿
- [ ] `--json` 不是统一信封：没有 `meta` / `data`，`status` 由退出码推导，与其他命令的 `--json` 形状不一致
- [ ] WARN 只列出 `extraFields` 的键名，不解释这些字段为何出现（`additionalProperties: true` 的开放 schema 与真正未知键混在一起）

## todo

- [ ] 上游 AFF 发布 `prog/examples/` 与 `http/examples/` 后，替换 handcrafted fixture
- [ ] 校验 `.tabl.ddic` / `.stru.ddic` DDL 源本身（当前只做 companion 存在性检查，DDL 走 `TABL_DDL_INVALID` 解析路径）
- [ ] 真机证据待补：`--wire` 目录校验在真实 ICF payload 上的回归记录

# references

- 校验层: [src/abap_cli/aff/schema-validator.ts](../../src/abap_cli/aff/schema-validator.ts)（ajv v8 + 缓存）
- 路由: [src/abap_cli/aff/router.ts](../../src/abap_cli/aff/router.ts) · [src/abap_cli/aff/schema-paths.ts](../../src/abap_cli/aff/schema-paths.ts)（type → schema 映射）
- Companion 探测: [src/abap_cli/aff/companion-check.ts](../../src/abap_cli/aff/companion-check.ts)
- 命令实现与 schema: [src/abap_cli/commands/validate-aff.ts](../../src/abap_cli/commands/validate-aff.ts)（命令模块自持 `--schema`）
- 文档: [docs/commands.md](../../docs/commands.md)
- 套件: `test/unit/schema-compliance/<type>.test.ts`（10 个 type × ≥1 fixture）
- 端到端 wire round-trip: `test/unit/wire-aff-roundtrip.test.ts`、`test/unit/validate-aff-command.test.ts`
