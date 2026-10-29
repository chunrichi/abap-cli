---
type: command
title: abap list
description: "List ABAP objects in a package (read-only, ADT quickSearch-backed). Useful for cleaning up scratch objects or auditing a package before mass pull/push."
tags: [command, list]
created at: 2026-10-29 14:30:14
changed at: 2026-10-29 14:30:14
---

# `abap list`

List ABAP objects in a package (read-only, ADT quickSearch-backed). Useful for cleaning up scratch objects or auditing a package before mass pull/push.

## Usage

```bash
abap list --package <pkg> [--type <type>] [--limit <n>]
```

## Options

| Option | Required | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `--package` `<package>` | yes |  |  | Filter by package (e.g., $TMP). Required. |
| `--type` `<type>` | no |  |  | Filter by object type (CLAS, PROG, INTF, ...). |
| `--limit` `<n>` | no |  |  | Max results (default 20). |

## Examples

- List everything in $TMP

  ```bash
  abap list --package $TMP
  ```
- List every local scratch class

  ```bash
  abap list --package $TMP --type CLAS
  ```
- Limit the result set

  ```bash
  abap list --package $TMP --type CLAS --limit 50
  ```

## Expected Output

`--json` returns the standard envelope; success on stdout, errors on stderr with a categorized exit code. See [agent-integration](../../docs/agent-integration.md).

# More

_Add real-system observations (prerequisites, gotchas, evidence) here; this page is generated once as a stub and then owned by maintainers._

# references

- [docs/commands.md](../../docs/commands.md) — generated parameter reference
- [agent-integration.md](../../docs/agent-integration.md) — `--json` contract
