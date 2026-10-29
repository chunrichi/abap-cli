---
type: command
title: abap delete
description: "Delete an ABAP object from SAP (lock → delete → unlock). Type is required to avoid ambiguity; --yes is required for non-interactive confirmation; a transport request is required for non-$TMP objects (matching `abap push` semantics)."
tags: [abap-cli, command, delete]
created at: 2026-10-29 14:30:14
changed at: 2026-10-29 14:30:14
---

# `abap delete`

Delete an ABAP object from SAP (lock → delete → unlock). Type is required to avoid ambiguity; --yes is required for non-interactive confirmation; a transport request is required for non-$TMP objects (matching `abap push` semantics).

## Usage

```bash
abap delete <object> --type <type> [--tr <request>] --yes
```

## Arguments

| Argument | Required | Values | Description |
| --- | --- | --- | --- |
| `object` | yes |  | Object name (e.g., ZCL_MY_CLASS, ZR_USER_CHANGES). |

## Options

| Option | Required | Default | Values | Description |
| --- | --- | --- | --- | --- |
| `--type` `<type>` | yes |  |  | Object type code (CLAS, PROG, INTF, FUGR, TABL, ...). |
| `--tr` `<request>` | no |  |  | Transport request number (required for non-$TMP packages). |
| `--yes` | yes |  |  | Confirm the deletion. Required — there is no implicit confirmation. |

## Examples

- Delete a local $TMP class

  ```bash
  abap delete ZCL_ZR_CHK9 --type CLAS --yes
  ```
- Delete a transport-bound object

  ```bash
  abap delete ZR_OLD --type PROG --tr NDK900123 --yes
  ```

## Expected Output

`--json` returns the standard envelope; success on stdout, errors on stderr with a categorized exit code. See [agent-integration](../../docs/agent-integration.md).

# More

_Add real-system observations (prerequisites, gotchas, evidence) here; this page is generated once as a stub and then owned by maintainers._

# references

- [docs/commands.md](../../docs/commands.md) — generated parameter reference
- [agent-integration.md](../../docs/agent-integration.md) — `--json` contract
