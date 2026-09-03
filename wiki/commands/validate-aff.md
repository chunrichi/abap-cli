---
type: command
title: abap validate:aff
description: 用本地镜像的官方 abap-file-format JSON Schema 校验 10 个支持类型的 canonical JSON 形态；作为写盘的强制 gate（pretest + CI）
tags: [abap-cli, command, validate, abap-file-format, schema, validator, ajv, canonical, doma, dtel, tabl, stru, fugr, clas, intf, prog, http, tran]
created at: 2026-09-03 00:00:00
changed at: 2026-09-03 00:00:00
---

# abap validate:aff

校验一个或一组 JSON 文件是否满足 **官方 abap-file-format**（AFF）规范。10 个支持类型（CLAS / INTF / PROG / FUGR / TABL / STRU / DOMA / DTEL / HTTP / TRAN）共享同一套校验层（`ajv@^8`，Draft 2020-12）；schema 来自本地只读镜像 `tmp/abap-file-formats/file-formats/<type>/<type>-v1.json`（STRU 共享 `tabl-v1.json`，TABL/STRU `.settings.json` 走 `tabt-v1.json`），离线即可跑、不联网。

## Usage

```bash
abap validate:aff [file-or-dir] [--wire <wire-dir>] [--json] [--schema]
```

## Options

- `[file-or-dir]`: 单个 JSON 文件或目录（递归扫 `.json`）。默认 `test/fixtures/`（用于 `pretest` gate）。
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
| `<name>.http.json` | `http-v1.json` |
| `<name>.tran.json` | `tran-v1.json` |

未知 JSON 文件不参与校验（输出 `UNKNOWN: PASS` 旁路）。

## Companion 探测

`companion-check.ts` 在校验 main JSON 时额外探测 companion 文件：

- **TABL**: `.tabl.ddic` + `.tabl.settings.json` 必需；settings.json 文件本身不触发自递归检查。
- **STRU**: `.tabl.ddic` 必需；`.tabl.settings.json` optional（仅 WARN）。
- **CLAS**: 4 个 `.clas.{definitions,implementations,macros,testclasses}.abap` 必需；`.clas.texts.<lang>.properties` optional。
- **FUGR**: companion `*.reps.*` / `*.func.*` 动态从 main JSON 推断；缺件报告「missing companion」。

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

- **离线**：runtime 不调用 npm registry / 不联网；AFF schema 全从本地镜像装载。镜像缺失时抛 `AFF_SCHEMA_MISSING`（`NOT_FOUND`/exit 2），提示「run scripts/sync-aff-mirror.sh」（占位脚本未实现，留接口位）。
- **跨版本**：当前 spec 锁定 `<type>-v1.json`。未来 AFF 上游升级到 `v2` 时，本 spec 范围内仍校验 `v1`；跨版本迁移在新 spec 中处理。
- **`ABAP_CLI_AFF_MIRROR` 环境变量**：可覆盖镜像根目录路径（默认 `<repo>/tmp/abap-file-formats/file-formats`），用于 CI / sandbox 环境指定不同副本。

## CI 集成（pretest gate）

`package.json#scripts.pretest` 自动跑 `validate:aff`：

```jsonc
"pretest": "npm run validate:aff",
"validate:aff": "vitest run test/unit/_validate-aff-cli.test.ts",
```

任何 schema 违规在 vitest 启动前阻断。开发者本地 `npm test` 自动看到错误；CI 同源。

## Examples

```bash
# 校验一个 fixture
abap validate:aff test/fixtures/tabl/zmy_basic.tabl.json

# 校验整个 fixtures 目录（含 STRU/TABL settings.json 走 tabt-v1.json）
abap validate:aff test/fixtures/

# 校验一个 wire payload 目录
abap validate:aff --wire tmp/s4h/260903001/wire/

# JSON 信封输出（Agent 友好）
abap validate:aff --json test/fixtures/

# 打印命令参数 schema（无 SAP 调用）
abap validate:aff --schema
```

## 已知限制 /- 

- **PROG / HTTP fixture 是 handcrafted**：上游 AFF `prog/examples/` 与 `http/examples/` 缺失；fixture 由 spec 033 US8 / US9 落地、`validate:aff` 校验通过。CI 注释提示「upstream example now available, consider replacing」。
- **STRU `settings.json` optional**：schema 不强制；validator 只发 WARN（`optionalCompanions: [...]`）。SAP 透明表持久化 `.tabl.settings.json`，结构体则不。
- **`additionalProperties: true` schema**：TABL `.tabl.settings.json` / CLAS 文本元素等多 key schema 对额外字段发 WARN 不阻断。
- **wire ↔ local 双层**：本命令只校验 local canonical JSON（落盘形态）；ICF wire payload 由 mock + 真实 SAP 端到端 round-trip 单测覆盖（`test/unit/wire-aff-roundtrip.test.ts`）。

## 相关文件

- 校验层：`src/abap_cli/aff/schema-validator.ts`（ajv v8 + 缓存）
- 路由：`src/abap_cli/aff/router.ts` + `schema-paths.ts`（type → schema 映射）
- Companion 探测：`src/abap_cli/aff/companion-check.ts`
- 命令实现：`src/abap_cli/commands/validate-aff.ts`
- 命令 schema：`src/abap_cli/flows/setup/command-schemas.ts#validateAffSchema`
- 套件：`test/unit/schema-compliance/<type>.test.ts`（10 个 type × ≥1 fixture）
- 端到端 wire round-trip：`test/unit/wire-aff-roundtrip.test.ts`