---
type: command
title: abap types
description: "Print the canonical CLI type ↔ TADIR PGMID/OBJECT ↔ DDIC tabclass mapping. Pure local — no SAP call. Surfaces the non-obvious mappings that cost real time when joining CLI write paths to TADIR queries (CLI HTTP ↔ TADIR SICF, CLI STRU ↔ TADIR TABL + DD02L-TABCLASS=INTTAB, etc.)."
tags: [command, types]
created at: 2026-10-29 14:30:14
changed at: 2026-10-29 14:30:14
---

# `abap types`

Print the canonical CLI type ↔ TADIR PGMID/OBJECT ↔ DDIC tabclass mapping. Pure local — no SAP call. Surfaces the non-obvious mappings that cost real time when joining CLI write paths to TADIR queries (CLI HTTP ↔ TADIR SICF, CLI STRU ↔ TADIR TABL + DD02L-TABCLASS=INTTAB, etc.).

## Usage

```bash
abap types [--json] | abap types <type> [--json]
```

## Arguments

| Argument | Required | Values | Description |
| --- | --- | --- | --- |
| `type` | no |  | Optional CLI type code to look up (e.g., STRU, HTTP, PROG). |

## Options

| Option | Required | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `--tadir-object` | no |  |  | With a single type, print only the TADIR OBJECT value (one line, no table). |
| `--json` | no |  |  | Emit a single JSON envelope (global flag). |

## Examples

- Print the full type catalog

  ```bash
  abap types
  ```
- Look up a single type

  ```bash
  abap types HTTP
  ```
- Print only the TADIR object for STRU (for use in scripts)

  ```bash
  abap types STRU --tadir-object
  ```

## Expected Output

`--json` returns the standard envelope; success on stdout, errors on stderr with a categorized exit code. See [agent-integration](../../docs/agent-integration.md).

# More

_Add real-system observations (prerequisites, gotchas, evidence) here; this page is generated once as a stub and then owned by maintainers._

# references

- [docs/commands.md](../../docs/commands.md) — generated parameter reference
- [agent-integration.md](../../docs/agent-integration.md) — `--json` contract
