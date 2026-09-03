---
type: command
title: abap extensions lock
description: Compute or refresh extensions.lock.json (npm extensions only). Required for first-run bootstrap with --allow-unsigned.
tags: [abap-cli, command, extensions, lockfile, security]
created at: 2026-08-28 00:00:00
changed at: 2026-08-28 00:00:00
---

# abap extensions lock

Recompute `extensions.lock.json` from `.abap.json`'s `extensions[]` array.
Each `sourceType: 'npm'` extension is resolved via `createRequire(import.meta.url).resolve(...)` and pinned by `sha512-<base64>` of the resolved entry file's bytes.

`sourceType: 'path'` extensions are lockfile-exempt; they only re-validate the existing `path_escapes_allowlist` / `path_contains_parent_ref` checks at load time.

## Usage

```bash
abap extensions lock [--allow-unsigned] [--json|--pretty-json]
```

## Options

- `--allow-unsigned`: Required to create a brand-new `extensions.lock.json`. Without it the command exits with `CONFIG_ERROR` (exit 3) on a fresh repo so a hostile `.abap.json` cannot quietly pin itself into the lockfile on first run.
- `--json`: Emit the standard envelope (`{status, meta, data}`) with `data.{lockfile, lastResolved, added, updated, removed, unresolved}`.
- `--pretty-json`: Pretty-printed JSON envelope (overrides `--json`).

## Examples

```bash
# First-time bootstrap (REQUIRED after installing CLI on a project with npm extensions)
abap extensions lock --allow-unsigned

# Re-run after .abap.json changes — diff is reported in `data.added` / `data.updated` / `data.removed`
abap extensions lock

# Agent mode
abap extensions lock --json
```

## Expected Output

### `--json`

```json
{
  "status": "success",
  "meta": {
    "command": "abap extensions lock",
    "version": "0.2.1",
    "timestamp": "2026-08-28T12:00:00.000Z",
    "durationMs": 14,
    "warnings": []
  },
  "data": {
    "lockfile": "/abs/path/to/extensions.lock.json",
    "lastResolved": "2026-08-28T12:00:00.000Z",
    "added": ["@myorg/abap-ext"],
    "updated": [],
    "removed": [],
    "unresolved": []
  }
}
```

### Human

```
Lockfile written: /abs/path/to/extensions.lock.json
  added:   @myorg/abap-ext
  updated: (none)
  removed: (none)
```

## Trust Model

| Source type | Lockfile | Path allowlist | Package-name regex | Hash pinned |
|-------------|----------|----------------|--------------------|-------------|
| `npm`       | required | n/a            | yes | yes (sha512) |
| `path`      | exempt   | required (cwd or ~/.abap-cli/extensions/) | n/a | no |

## Error codes

| Code | Category / exit | Trigger | Recovery |
|------|-----------------|---------|----------|
| `CONFIG_ERROR` | CONFIG_ERROR / 3 | First-run without `--allow-unsigned` | Re-run with `--allow-unsigned` |
| `CONFIG_ERROR` | CONFIG_ERROR / 3 | No `.abap.json` in cwd or any ancestor | `cd` into a workspace or run `abap init` |

## More

### fixme

- [ ] (none)

### todo

- [ ] Add `--dry-run` to print the diff without writing (currently every run writes atomically; harmless but adds a `.tmp` mtime)

## references

- 信任硬化设计：见 wiki 顶层 `extension-trust` 历史回顾
- sibling: [`wiki/commands/extension.md`](extension.md) (the ICF ABAP extension manager — unrelated)