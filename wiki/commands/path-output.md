---
type: contract
title: output path contract (POSIX across platforms)
description: CLI 在所有 --json 输出与 human 文本中统一使用 POSIX 相对路径（`/`），与 host OS（Windows / Linux / macOS）解耦
tags: [abap-cli, contract, output, paths, windows, cross-platform, json, agent]
created at: 2026-08-26 21:00:00
changed at: 2026-08-26 21:00:00
---

# output path contract

所有进入 `--json` envelope 的路径字段（`data.file`、`data.localFile`、`data.entries[].file`、`data.written`、`data.skipped`、`data.failed`、`data.files[].file`、`data.issues[].file` 等）以及对应的 human 文本与错误消息中的 `file` 字段，统一使用 **POSIX 相对路径**（`/` 作为分隔符），不随运行平台变化。

Agent 在 Windows / Linux / macOS 下消费同一份结构化输出时，看到的字段值完全一致。

## Why

- Node 内置 `path.join` / `path.relative` 在 Windows 上返回 `\`、POSIX 上返回 `/`。这对 `fs.readFile` / `fs.writeFile` 是正确的，但对 **Agent 解析的字符串** 是反模式：上游 JSON 在 Windows CI 上的输出形如 `src\clas\zcl_demo\zcl_demo.clas.abap`，与 abap-file-format 参考布局（`/`）不一致，测试与下游消费者都要做平台分支处理。
- abap-file-format 把所有路径都定义为 POSIX 相对路径（[abap-file-format-export.md](../abap-file-format-export.md)）。CLI 输出应与之一致。
- 历史上 Windows 上 54/756 单元测试失败即源于此：`path.join('src', 'clas', ...)` 在 Windows 写盘后 `data.file` 也带 `\`，断言里写的是 `/`。

## Boundary

新增单一来源 `src/abap_cli/core/path-output.ts`：

| Helper | Purpose |
|---|---|
| `toOutputPath(p)` | 字符串级规范化：`\` → `/`，strip leading `./`，保留 `..`，空值返回 `''`。 |
| `toRelativeOutputPath(absPath, cwd?)` | 绝对 host 路径 → cwd-relative POSIX 路径（`path.relative(cwd, p)` 后 POSIX 化；`relative()` 为空时回退绝对 POSIX）。`cwd` 默认 `process.cwd()`，flow 内部使用自身 cwd 时显式传入。用于 `push` / `check` / `status` / `diff` 这类输入是 `path.resolve` 绝对路径的命令。 |
| `normalizePullData(data)` | 范围化 helper：只动 `file` / `entries[].file` / `entries[].files` / `written` / `skipped` / `failed`，其它字段（`object` / `code` / `detail` 等）原样返回。`pull` flow 全部 6 条路径（单对象、textpool、DDIC 单文件、TABL/STRU three-piece、HTTP、remote、package 批量、transport 批量）都走它。 |
| `isPathLike(p)` | 判别字符串是否为路径形态（避免把 `code: "FAILED"` 之类误转换）。 |

### Boundary rule

- **fs I/O（`fs.readFile` / `fs.writeFile` / `path.resolve` / `path.isAbsolute`）**：继续用 Node 原生 `path` 模块——OS 只认 host-native 分隔符。
- **输出边界（`printResult` 的 `data` / `human`、错误 `details` / `message` / `nextSteps` / `example`）**：所有路径字段必须经过 `toOutputPath` / `toRelativeOutputPath` / `normalizePullData` 之一。
- **绝对路径 → 相对**：若内部字段来自 `path.resolve`（绝对路径），输出前必须用 `toRelativeOutputPath` 转成 cwd-relative POSIX——否则 Windows 上 `C:/...` 与 POSIX `/...` 前缀仍不一致。内部要消费该相对路径时（如 `diff` 读 detail 里的文件），用 `path.resolve(cwd, rel)` 转回绝对再 fs 读。

## 受影响的命令与字段

| Command | Path fields in JSON `data` / `error.details` / `human` |
|---|---|
| `create local` | `data.file`（草稿相对路径） |
| `create <CLAS\|INTF\|PROG\|FUGR>` | `data.localFile`（create-then-pull 写入路径） |
| `create <DDIC\|HTTP>` | `data.file`（`--file` 输入路径回显）、`error.details.file` |
| `pull`（所有子路径） | `data.file` / `data.entries[].file` / `data.entries[].files` / `data.written` / `data.skipped` / `data.failed` / `error.details.file` |
| `push` | `data.results[].file`（cwd-relative）、`--atomic` 失败 `details.failures[].file`、DDIC/HTTP 校验与 `FILE_PARSE_ERROR` 的 `details.file` / message |
| `extension deploy` | `data.files[].file` |
| `check` | `data.issues[].file`（cwd-relative）、`data.out`（默认相对 POSIX `.abap/atc/<variant>-<ts>.json`）、persisted ATC JSON 的 `files[].file`（cwd-relative） |
| `init --agent` | `data.written` / `data.skipped` |
| `init` | `data.configPath`（`--show-config` / `--unset-*`）、`CONFIG_ERROR` 的 `details.file` |
| `profile` | `profile export --file` 的 `data.file` + human、`PROFILE_MISMATCH` warning 中的相对路径 |
| `doctor` | `config.active` verbose 文本中的相对路径 |
| `status` / `diff` | `data.parts[].detail`（`local file: <cwd-relative POSIX>`） |

## 期望输出（任意平台下都形如）

```json
{
  "status": "success",
  "meta": { "command": "abap pull", "version": "0.2.2", "timestamp": "2026-08-26T21:00:00.000Z", "durationMs": 87, "warnings": [] },
  "data": {
    "object": "ZCL_DEMO",
    "type": "CLAS",
    "entries": [
      { "object": "ZCL_DEMO", "type": "CLAS", "status": "written", "file": "src/clas/zcl_demo/zcl_demo.clas.abap" },
      { "object": "ZCL_DEMO", "type": "CLAS", "status": "written", "file": "src/clas/zcl_demo/zcl_demo.clas.json" }
    ],
    "written": [
      "src/clas/zcl_demo/zcl_demo.clas.abap",
      "src/clas/zcl_demo/zcl_demo.clas.json"
    ],
    "skipped": [],
    "failed": []
  }
}
```

TABL three-piece：

```json
{
  "data": {
    "object": "ZAFF",
    "type": "TABL",
    "layout": "tabl-aff-three-piece",
    "entries": [
      { "status": "written", "file": "src/tabl/zaff.tabl.json" },
      { "status": "written", "file": "src/tabl/zaff.tabl.ddic" },
      { "status": "written", "file": "src/tabl/zaff.tabl.settings.json" }
    ],
    "written": [
      "src/tabl/zaff.tabl.json",
      "src/tabl/zaff.tabl.ddic",
      "src/tabl/zaff.tabl.settings.json"
    ]
  }
}
```

DDIC `abap create TABL/STRU` 走 ICF POST `/ddic/<type>`，data envelope 不展开三件套（ICF 端点是单字段 wire schema），仅返回 `{ object, type, action, file: <main> }`：

```json
{
  "data": {
    "object": "ZTODO",
    "type": "TABL",
    "action": "created",
    "file": "src/tabl/ztodo.tabl.json"
  }
}
```

如果 agent 需要明确三件套全部路径，自己用 `tablArtifactPaths(file)`（[`src/abap_cli/dictionary/tabl-artifact.ts`](https://github.com/chunrichi/abap-cli/blob/main/src/abap_cli/dictionary/tabl-artifact.ts)）算即可。CLI 内部创建路径已探测同目录 `.tabl.ddic` / `.tabl.settings.json`（`readDdicObjectForCreate`），所以三件套"在源端一致"是先决条件，不需要在 output 里重复。

## Examples

### Agent: parse the local file path on any host

```bash
# Same JSON on Windows / Linux / macOS:
abap pull ZCL_DEMO --type CLAS --json
# →
# data.written[0] == "src/clas/zcl_demo/zcl_demo.clas.abap"  (no platform branch)
```

### 在新 flow 中应用

```ts
import { toOutputPath, normalizePullData } from '../core/path-output.js';
import * as path from 'node:path';

const abs = path.resolve(process.cwd(), relPath); // ← fs-side, host-native
const fsOut = await fs.writeFile(abs, content);

printResult(mode,
  {
    object: name,
    file: toOutputPath(relPath),          // ← output-side, always POSIX
    written: [toOutputPath(relPath)],
  },
  `Wrote ${toOutputPath(relPath)} (POSIX even on Windows)`,
);
```

## Tests

- `test/unit/path-output.test.ts` (19 cases) — `toOutputPath` / `toRelativeOutputPath` / `normalizePullData` / `isPathLike` 的单元覆盖，包括 Windows 模拟输入（`'src\\clas\\...'` → `'src/clas/...'`）与显式 `cwd` 参数。
- `test/unit/pull-layout.test.ts` — `data.written` / `data.skipped` 改为字面量 POSIX 断言（之前用 `path.join` 写死 `/`，在 Windows CI 不会失败但在 Linux 上是冗余的隐式约束）。
- 全部 787 单元测试在 macOS / Linux 上通过；同代码在 Windows CI 上同样通过。

## Anti-patterns

```ts
// ❌ Wrong: 在 printResult 里直接放 path.join 的结果
printResult(mode, { file: path.join('src', 'clas', name) });

// ✅ Right: 边界上 normalize
printResult(mode, { file: toOutputPath(path.join('src', 'clas', name)) });

// ❌ Wrong: 用 toOutputPath 去做 fs.writeFile（输出 helper 只用于输出边界）
await fs.writeFile(toOutputPath(path.join('src', name)), content); // Windows 上永远写不进去
const abs = path.resolve(process.cwd(), 'src', name);
await fs.writeFile(abs, content);

// ✅ Right: fs 用 host-native，输出用 POSIX
await fs.writeFile(abs, content);
printResult(mode, { file: toOutputPath(path.join('src', name)) });
```

## references

- [abap-file-format-export.md](../abap-file-format-export.md) — 路径布局的规范来源
- `src/abap_cli/core/path-output.ts` — 边界 helper 实现
- JSON 输出契约：见 wiki 顶层 `unify-json-generation` 历史回顾（POSIX 路径是该契约的一部分）
