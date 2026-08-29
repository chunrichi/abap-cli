---
type: command
title: abap extensions
description: 管理已安装的第三方扩展 — list（只读列出注册项 + 加载状态 + lockfile 状态）/ lock（重新生成 extensions.lock.json，027 信任硬化）
tags: [abap-cli, command, extensions, lockfile, security]
created at: 2026-08-28 00:00:00
changed at: 2026-08-28 00:00:00
---

# abap extensions

管理从 `.abap.json` 的 `extensions[]` 数组中声明的第三方扩展。包含两个子命令：

- `extensions list` — 只读列出所有已注册扩展，附带**加载状态**与（npm 扩展的）`extensions.lock.json` 状态。
- `extensions lock` — 重新生成 `extensions.lock.json`。

> **注意**：本命令与 [`abap extension`](extension.md) 是**不同命令**——后者管理内置的 SAP-side ICF ABAP 扩展（`/sap/zabap_vibe`）。本命令面向**第三方扩展加载机制**（023 + 027）。

## Usage

```bash
abap extensions list [--json|--pretty-json]            # 列出所有扩展 + 状态
abap extensions lock [--allow-unsigned] [--json|--pretty-json]   # 重新生成 lockfile
abap extensions --schema                                # 参数自省
```

## `abap extensions list`

只读探测。读取 `.abap.json` 中的 `extensions[]` 数组，对每条扩展报告：声明信息（`sourceType` / `packageName` 或 `path`）、加载结果（`loaded` / `failed` + reason）、lockfile 状态（仅 `sourceType: 'npm'`）。无 SAP 调用。

### Output（JSON）

```json
{
  "status": "success",
  "meta": {
    "command": "abap extensions list",
    "version": "0.2.2",
    "timestamp": "2026-08-28T12:00:00.000Z",
    "durationMs": 8,
    "warnings": [],
    "extensions": {
      "lockfile": { "status": "ok", "lastResolved": "2026-08-28T11:00:00.000Z" }
    }
  },
  "data": {
    "extensions": [
      {
        "sourceType": "npm",
        "packageName": "@myorg/abap-ext",
        "resolved": "/Users/.../node_modules/@myorg/abap-ext/dist/index.js",
        "status": "loaded",
        "lockfile": {
          "status": "match",
          "expected": "sha512-...",
          "actual":   "sha512-..."
        }
      },
      {
        "sourceType": "path",
        "path": "./extensions/zlocal.js",
        "status": "loaded",
        "lockfile": null
      }
    ],
    "summary": { "loaded": 2, "failed": 0 }
  }
}
```

字段说明：

- `lockfile.status: "match" | "mismatch" | "missing-entry" | "exempt"` — `exempt` 用于 `sourceType: 'path'`。
- 无任何 npm 扩展时 `meta.extensions` 字段**省略**（token-efficient，022 契约）。
- 加载失败（`failed`）的扩展 `data.extensions[i].status: "failed"` + `reason: 'LOCKFILE_INTEGRITY_MISMATCH' | 'LOCKFILE_MISSING_ENTRY' | 'INTEGRITY_UNRESOLVABLE' | 'INVALID_PACKAGE_NAME' | ...`，整体仍 `status: "success"`（list 本身不抛错）。

## `abap extensions lock`

从 `.abap.json` 的 `extensions[]` 重新计算 `extensions.lock.json`。每个 `sourceType: 'npm'` 扩展通过 `createRequire(import.meta.url).resolve(...)` 解析后，按解析入口文件的字节计算 `sha512-<base64>` 并钉到 lockfile。`sourceType: 'path'` 扩展**lockfile 豁免**（FR-006），仅在 load 时校验 `path_escapes_allowlist` / `path_contains_parent_ref`。

### Options

- `--allow-unsigned`: 首次创建 `extensions.lock.json` 必须显式传。无 flag 时若 lockfile 不存在 → `CONFIG_ERROR`（exit 3），避免敌意 `.abap.json` 在首次运行时静默自我钉入 lockfile（FR-007）。
- `--json`: 标准 envelope `{status, meta, data}`，`data = { lockfile, lastResolved, added, updated, removed, unresolved }`。
- `--pretty-json`: 同上，缩进。

### Examples

```bash
# 首次 bootstrap（项目含 npm 扩展时安装 CLI 后必跑一次）
abap extensions lock --allow-unsigned

# .abap.json 改后重跑 — diff 反映在 data.added / updated / removed
abap extensions lock

# Agent mode
abap extensions lock --json
abap extensions list --json
```

## Trust Model

| sourceType | lockfile | path allowlist | package-name regex | Hash pinned |
|------------|----------|----------------|--------------------|-------------|
| `npm`      | required | n/a            | yes       | yes (sha512) |
| `path`     | exempt   | required (cwd 或 `~/.abap-cli/extensions/`) | n/a | no |

`INVALID_PACKAGE_NAME` 在任何 `import()` / `createRequire().resolve()` 之前拒绝（覆盖 `..` / `\` / 空 scope / URL scheme / 绝对路径 / 非 npm 名字符集）。

## Error codes

| Code | Category / exit | Trigger | Recovery |
|------|-----------------|---------|----------|
| `EXTENSION_LOAD_FAILED` (lock 子命令本身不抛，由 `extensions list`/`run` 等其他命令报告) | CONFIG_ERROR / 3 | lockfile 缺失 / 篡改 / 不可解析 | `abap extensions lock --allow-unsigned` 重生成 |
| `CONFIG_ERROR` | CONFIG_ERROR / 3 | 首次 `lock` 无 `--allow-unsigned` | 重跑加 `--allow-unsigned` |
| `CONFIG_ERROR` | CONFIG_ERROR / 3 | cwd 无 `.abap.json` | `cd` 进工作区或 `abap init` |
| `USAGE` | USAGE / 2 | 未知子命令 / `--allow-unsigned` 拼写错 | `--help` |

## More

### fixme

- [ ] (none)

### todo

- [ ] `extensions list` 报告 `failureReason` 字段（当前 reason 在 JSON 中为 string，未归类 enum）
- [ ] `--dry-run` for `extensions lock`（当前每次都写盘，原子 tmp 落盘但仍 mtime 变化）

## references

- spec: [`specs/027-extension-trust/spec.md`](../../specs/027-extension-trust/spec.md) §FR-007 / §FR-008 / §FR-010
- contract: [`specs/027-extension-trust/contracts/extensions-lock-v1.md`](../../specs/027-extension-trust/contracts/extensions-lock-v1.md)
- data model: [`specs/027-extension-trust/data-model.md`](../../specs/027-extension-trust/data-model.md) §1 / §3
- subcommand detail: [`wiki/commands/extensions-lock.md`](extensions-lock.md)
- sibling: [`wiki/commands/extension.md`](extension.md) — 内置 ICF ABAP 扩展管理器（不相关）
- architecture: [`docs/architecture.md#extension-layer`](../../docs/architecture.md)
